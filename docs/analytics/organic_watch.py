#!/usr/bin/env python3
"""WIC-1358 watcher: has PostHog project 551963 seen its first ORGANIC event yet?

One HogQL round-trip. Exit code IS the answer, so a heartbeat can branch on it:

    0  -> no organic traffic. Nothing to do, do not comment, do not re-raise WIC-1024.
    10 -> CANDIDATE organic traffic. ADJUDICATE the printed rows, THEN decide. This is
          not by itself permission to re-raise WIC-1024 -- see "Fail-safe, not fail-open".
    1  -> the check itself failed (auth, network, HogQL error). Not evidence either way.

Usage:  POSTHOG_PERSONAL_API_KEY=... python3 docs/analytics/organic_watch.py [--verbose]
        [--registry PATH]   override the probe registry location
        [--audit]           print the registry integrity report and the built predicate

Why a predicate and not "count() > 5"
-------------------------------------
The naive trigger is "lifetime events > N". That false-fires the moment anyone runs
another QA probe, and it would have us re-raise WIC-1024 on synthetic traffic -- the
exact mistake the hold exists to prevent. It is also fragile in the other direction:
three of the original events (resume_upload_submitted/completed/failed) carry REAL
taxonomy names, so event name alone cannot separate organic from synthetic. A genuine
user's resume_upload_submitted is indistinguishable by name from the WIC-996 smoke test.

So we fingerprint the *actor and the run*, not the event name, and we anchor on time.

Two predicates, because neither alone is sufficient  (WIC-1389 / WIC-1392)
-------------------------------------------------------------------------
1. **Prefix fingerprints** -- `qa_` event names, `qa-`/`probe-`/`smoke-` distinct_ids,
   `wic<ticket>-` session ids. These catch a probe nobody remembered to register.
2. **The registry** -- `docs/analytics/probe-registry.json`, the version-controlled list
   of every known synthetic actor in 551963, consumed here as exact-match exclusion keys.

The registry exists because prefixes provably cannot cover one class of probe. An
*end-to-end* probe (a real authenticated request against prod) does not choose its own
`distinct_id`: the server sets it to the Supabase auth user id
(`packages/api/src/services/analytics.service.ts:131`), and the event name comes from the
WIC-814 server taxonomy, not the caller. Such a probe controls exactly one marker,
`session_id`. An opaque auth UUID can never be prefixed -- but it CAN be registered.
See `docs/analytics/prod-probe-labelling.md` for the full mechanism and both probe classes.

Keep both. The registry catches what prefixes cannot; prefixes catch what someone forgot
to register.

Fail-safe, not fail-open  (added 2026-08-26 after a live false positive)
-----------------------------------------------------------------------
The original design defined organic as NOT-synthetic. That formulation fails OPEN: any
probe whose author forgets the labelling convention is classified as a real user, and the
watcher escalates on fake data. That is not hypothetical -- it happened on the first
non-baseline event this watcher ever saw:

    2026-08-26T04:19:39.262Z  resume_upload_submitted
    distinct_id  fa21d5a4-2ac9-455e-b31f-3553a314792f   <- bare UUID, no `probe-`/`smoke-`/`qa-`
    $lib         wic-api                                <- server leg, same as a real upload
    session_id   wic967-devops-1787717978               <- THE TELL: a ticket-scoped probe run
    file_size_bytes 672, file_type pdf                  <- 672-byte "pdf" fixture

By actor fingerprint alone that event is indistinguishable from a genuine first user. It
was a DevOps WIC-967 probe. Three things keep the next one from costing a false escalation:

 1. `session_id` matching `^wic<digits>-` joins the synthetic fingerprint. Ticket-scoped
    session ids are a strong, already-observed convention and survive a bare-UUID actor.
 2. The probe registry supplies exact-match exclusions for actors that cannot be prefixed
    at all -- durable, reviewable, and shared with `prod_probe.sh`, which refuses to fire
    (exit 3) if a probe's auth user is not registered first.
 3. Exit 10 no longer asserts "organic". It asserts "unclassified -- look at this". The
    watcher PRINTS the identifying columns of every candidate so the heartbeat adjudicates
    from evidence instead of trusting a negation.

Note the failure directions are deliberately asymmetric. A missing or malformed registry
makes this watcher NOISIER (unexcluded probes surface as candidates for adjudication); it
never makes it quieter. Nothing here can silently suppress a real first user.

Rule of thumb when adjudicating: a real user's first session emits a *sequence* correlated
with a real file. A probe emits one or three events, from one session id naming a ticket,
with a fixture-sized payload, and never returns. When genuinely unsure, DO NOT re-raise --
say so on WIC-1358 and wait for the second session. Waiting costs nothing (insights query
events historically); a false release burns a human console session on empty dashboards.

Validated against live data 2026-08-26T07:4xZ (registry-backed build):
  - SYNTHETIC_PREDICATE matches 6 of 6 lifetime events (complete)
  - ORGANIC_PREDICATE  matches 0 of 6                 (no false positive)
The two are exact complements over the current dataset, which is the strongest check
available while organic traffic is still zero. `--audit` re-runs that partition check.

Maintenance contract
--------------------
Adjudicated a candidate as synthetic? Add it to `docs/analytics/probe-registry.json`
(both the `probes[]` entry and `exclusion_keys`) and commit -- do NOT hand-edit a
quarantine set in this file. The registry is the shared, version-controlled record; a
local set is one workspace reset away from being lost, which is the failure this file was
rewritten to remove.
"""

import contextlib
import http.client
import io
import json
import os
import re
import socket
import ssl
import sys
import urllib.error
import urllib.request

PROJECT = "551963"
HOST = "https://us.posthog.com"

# Unauthenticated prod liveness probe. `GET /health` at the ROOT (not `/api/health`,
# which is auth-guarded and 404s once authenticated) already dials the database and
# reports the underlying error, so it costs no credential to read -- see ADR-007 and
# the Architect's correction on WIC-1386.
#
# Why the watcher cares. "0 organic events" is only a demand signal if the app a
# visitor lands on actually works. It does not, today: every DB-touching endpoint
# fails with Workers subrequest exhaustion, pending the pooler-vs-Hyperdrive board
# decision on WIC-1473. That splits the WIC-814 taxonomy in two:
#
#   * CLIENT leg (`resume_upload_started` / `_validation_failed` / `_cta_clicked`)
#     goes browser -> us.i.posthog.com directly and is UNAFFECTED by the outage.
#     This is why 0 organic still validly means "nobody arrived".
#   * SERVER leg is emitted from the Worker (`resume.service.ts`). `_submitted` fires
#     BEFORE `getDb()` so it survives, but `_completed` sits after the DB writes and
#     is structurally UNREACHABLE while the DB is down -- the catch path emits
#     `_failed` instead. So the server funnel can only ever record 100% failure.
#
# Consequence for the WIC-1024 hold: a first organic visitor is necessary but NOT
# sufficient to release the dashboard build. Completion- and timing-keyed insights
# (and the C1-C3 person_id retention tiles) cannot be populated until this returns ok.
PROD_HEALTH_URL = "https://app.careerpin.app/health"

# Newest known-synthetic event at the time the baseline was struck. Organic traffic must
# postdate it, so a late-arriving duplicate of an old probe cannot trip the watch.
# Deliberately NOT advanced to the 2026-08-26 WIC-967 probe: a later baseline would
# suppress more, and suppression is the direction this watcher must never drift in.
BASELINE = "2026-08-19 05:00:40"

# The registry is the source of record for exact-match exclusions. Searched in order;
# first hit wins. Override with --registry or WIC_PROBE_REGISTRY.
REGISTRY_SEARCH_PATH = (
    os.environ.get("WIC_PROBE_REGISTRY"),
    # realpath, not abspath: a convenience symlink into a checkout must still resolve to
    # the registry sitting next to the real file.
    os.path.join(os.path.dirname(os.path.realpath(__file__)), "probe-registry.json"),
    "docs/analytics/probe-registry.json",
    "job-app-management/docs/analytics/probe-registry.json",
)

# Exclusion keys must be literal-safe before they are interpolated into HogQL. Every
# identifier the convention permits (uuids, auth uuids, `wic967-devops-1787717978`,
# `smoke-wic996-user-...`) matches this. Anything that does not is dropped WITH A WARNING
# rather than quoted -- dropping only ever makes the watcher noisier, never blinder.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9._:@+-]{1,200}$")


def load_registry(path_override=None):
    """Return (registry_dict_or_None, source_path_or_None, list_of_problem_strings)."""
    problems = []
    candidates = (path_override,) + REGISTRY_SEARCH_PATH if path_override else REGISTRY_SEARCH_PATH
    for candidate in candidates:
        if not candidate or not os.path.isfile(candidate):
            continue
        try:
            with open(candidate, encoding="utf-8") as fh:
                return json.load(fh), candidate, problems
        except (OSError, ValueError) as exc:
            problems.append(f"registry at {candidate} is unreadable ({exc})")
    problems.append(
        "no probe registry found (looked in: "
        + ", ".join(p for p in candidates if p)
        + ") -- falling back to prefix fingerprints only. Unregistered probes with "
        "unprefixable actors will surface as CANDIDATES for adjudication."
    )
    return None, None, problems


def registry_keys(registry):
    """Extract exclusion keys, and audit the registry for internal drift.

    `exclusion_keys` is what the queries consume; `probes[]` is what a human reads. They
    are maintained by hand in the same file and can disagree -- a probe added to `probes[]`
    whose ids never reach `exclusion_keys` is silently not excluded. Cross-check them.
    """
    problems = []
    keys = registry.get("exclusion_keys") or {}
    distinct_ids = set(keys.get("distinct_ids") or [])
    event_uuids = set(keys.get("event_uuids") or [])
    session_ids = set(keys.get("session_ids") or [])

    for probe in registry.get("probes") or []:
        ticket = probe.get("ticket") or probe.get("when") or "<unidentified probe>"
        for field, bucket in (
            ("distinct_ids", distinct_ids),
            ("event_uuids", event_uuids),
        ):
            for value in probe.get(field) or []:
                if value not in bucket:
                    problems.append(
                        f"registry drift: {ticket} lists {field[:-1]} {value!r} in probes[] "
                        f"but it is missing from exclusion_keys.{field} -- NOT excluded"
                    )
        # session_ids are optional in exclusion_keys; fold them in from probes[] so a
        # registered session that does not match the `wic<digits>-` shape is still caught.
        session_ids.update(probe.get("session_ids") or [])

    def sanitise(values, label):
        clean = set()
        for value in values:
            if isinstance(value, str) and _SAFE_KEY.match(value):
                clean.add(value)
            else:
                problems.append(
                    f"registry {label} entry {value!r} is not a safe literal -- dropped "
                    "(it will not be excluded; fix the registry)"
                )
        return clean

    return (
        sanitise(distinct_ids, "distinct_id"),
        sanitise(event_uuids, "event_uuid"),
        sanitise(session_ids, "session_id"),
        problems,
    )


def sql_in(column, values):
    """`column IN ('a','b')`, or None when there is nothing to match."""
    if not values:
        return None
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in sorted(values)) + ")"


def build_predicates(distinct_ids, event_uuids, session_ids):
    clauses = [
        # Use startsWith()/match(), not LIKE. HogQL rejects the `\_` escape outright
        # ("unrecognised escape"), and unescaped `'qa_%'` would silently treat the
        # underscore as a single-char wildcard. startsWith() has no wildcard semantics
        # to get wrong.
        "startsWith(event, 'qa_')",
        "startsWith(distinct_id, 'probe-')",
        "startsWith(distinct_id, 'smoke-')",
        "startsWith(distinct_id, 'qa-')",
        # Ticket-scoped probe sessions, e.g. 'wic967-devops-1787717978'. The only marker
        # an end-to-end probe is able to set.
        "match(toString(properties.session_id), '^wic[0-9]+-')",
    ]
    clauses += [
        c
        for c in (
            sql_in("distinct_id", distinct_ids),
            sql_in("toString(uuid)", event_uuids),
            sql_in("toString(properties.session_id)", session_ids),
        )
        if c
    ]
    synthetic = " OR ".join(clauses)
    organic = f"NOT ({synthetic}) AND timestamp > toDateTime('{BASELINE}')"
    return synthetic, organic


def aggregate_query(synthetic, organic):
    return f"""
SELECT
  countIf({organic})                        AS organic_events,
  uniqIf(distinct_id, {organic})            AS organic_people,
  maxIf(timestamp, {organic})               AS organic_newest,
  countIf({synthetic})                      AS synthetic_events,
  count()                                   AS lifetime_events,
  max(timestamp)                            AS lifetime_newest
FROM events
"""


def candidate_query(organic):
    """Exactly the columns needed to tell a probe from a person without a second trip."""
    return f"""
SELECT
  timestamp, event, distinct_id, uuid,
  properties.$lib                AS lib,
  properties.session_id          AS session_id,
  properties.file_size_bytes     AS file_size_bytes,
  properties.$current_url        AS current_url
FROM events
WHERE {organic}
ORDER BY timestamp DESC
LIMIT 25
"""


def run(query):
    key = os.environ.get("POSTHOG_PERSONAL_API_KEY")
    if not key:
        raise RuntimeError("POSTHOG_PERSONAL_API_KEY is not set")
    req = urllib.request.Request(
        f"{HOST}/api/projects/{PROJECT}/query/",
        data=json.dumps({"query": {"kind": "HogQLQuery", "query": query}}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


# Every fault class a `run()` round-trip can raise, as ONE named tuple used by BOTH call
# sites. It was two hand-written tuples that had drifted apart, and the drift is the bug
# (WIC-1680): the candidate-detail tuple named only (URLError, HTTPError, RuntimeError,
# KeyError), through which 12 of 16 measured fault classes escaped.
#
# The membership is not obvious, so state it rather than re-deriving it next time:
#   urllib.error.URLError   -- what urllib wraps most socket errors in. Subclasses OSError,
#                              so it is redundant with the OSError below; named anyway
#                              because it is the class a reader expects to see here.
#                              `urllib.error.HTTPError` is NOT named: it subclasses
#                              URLError, so listing it only implied the tuple was
#                              exhaustive when it was not.
#   http.client.HTTPException -- subclasses Exception, NOT OSError. This is the gap that
#                              bit prod_db_health() first (PR #207): IncompleteRead,
#                              BadStatusLine, LineTooLong, ResponseNotReady, InvalidURL.
#   OSError                 -- load-bearing, and the class the WIC-1680 write-up initially
#                              missed. ssl.SSLError, socket.gaierror, ConnectionResetError
#                              and TimeoutError are OSError subclasses and are NOT reached
#                              by HTTPException or ValueError; without OSError, 4 of the 12
#                              escapes stay open. Only relevant when urlopen raises them
#                              unwrapped, which is exactly what the selftest stub does.
#   ValueError              -- `json.load` raises JSONDecodeError, and a bad byte in the
#                              response raises UnicodeDecodeError. Both subclass ValueError.
#   RuntimeError            -- run() itself, on a missing POSTHOG_PERSONAL_API_KEY.
#   KeyError                -- a 200 whose JSON lacks "columns"/"results".
#
# Deliberately absent: MemoryError, and no `except Exception`. Resource exhaustion must
# stay uncaught -- see `test_query_fault_coverage` for the negative control that pins it.
# Caveat worth knowing: RecursionError IS caught, because it subclasses the RuntimeError we
# genuinely need for the missing-key path. That is incidental, pre-existing, and not
# removable without a re-raise; it is not a claim that recursion faults are handled.
QUERY_FAULTS = (
    urllib.error.URLError,
    http.client.HTTPException,
    OSError,
    ValueError,
    RuntimeError,
    KeyError,
)


def prod_db_health():
    """Read the unauthenticated prod health probe. Returns (state, detail).

    state is one of "ok" | "degraded" | "unknown". This is REPORTING ONLY and is
    deliberately incapable of changing the organic verdict or the exit code: a
    health probe that fails must never suppress a real first user, so every fault
    path collapses to "unknown" and the organic result stands on its own.
    """
    # An explicit UA is required, not cosmetic: Cloudflare answers urllib's default
    # `Python-urllib/3.x` with a 403 bot challenge, which read naively looks exactly
    # like a degraded app. Only a response that actually parses as the health payload
    # is authoritative; anything else is "unknown", never "degraded".
    headers = {"User-Agent": "wic-organic-watch/1.0 (+WIC-1358)", "Accept": "application/json"}
    try:
        req = urllib.request.Request(PROD_HEALTH_URL, method="GET", headers=headers)
        # 90s, not 30s. The probe's real ceiling is the API's Postgres `connect_timeout`:
        # `packages/api/src/db/client.ts:23` builds `postgres(DATABASE_URL, {prepare: false,
        # ssl: 'require'})` and sets NO connect_timeout, so postgres-js's default of 30s
        # applies (`postgres@3.4.9`, `src/index.js:453`) -- plus TLS and edge overhead.
        # 90s clears that with margin. Note the default is UNPINNED: package.json declares
        # `"postgres": "^3.4.4"`, so a bump that raises it silently re-opens this race.
        #
        # This is a budget over a known ceiling, not over an observation. Observed latency
        # varies widely on the same exhausted prod: 25.6-27.2s on 2026-08-27 03:4xZ (one
        # connect attempt expiring just under the 30s ceiling), ~4s at 08:2xZ. A 30s timeout
        # left only a ~3s margin over the former, so the probe intermittently raised "The read
        # operation timed out" and reported clause (b) as UNKNOWN when prod had in fact
        # answered a clean `degraded`. An UNKNOWN here is not harmless: it is indistinguishable
        # from "never measured", and it is the exact reading that would let a reader conclude
        # the outage had lifted.
        #
        # NOT the mechanism, though an earlier revision of this comment said so: the Worker's
        # Hyperdrive retry loop (`worker.ts:13-21`) is unreachable for this endpoint. `/health`
        # catches its own DB error (`app.ts:97-102`) and returns 503 itself (`app.ts:105`), so
        # nothing propagates out of `app.fetch` to retry on; the loop also needs a
        # Hyperdrive-specific message and prod
        # has no Hyperdrive binding, and its whole budget is 150ms regardless. Nor is
        # subrequest exhaustion the slow path -- once the invocation's budget is spent the
        # runtime refuses the connection immediately, which is the ~4s reading above.
        # Raising the timeout costs nothing on a healthy response: it bounds a hang, so a 4s
        # answer still returns in 4s.
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as exc:
        # 503 is the *expected* degraded response and carries the useful payload, so
        # read the error body rather than discarding it with the exception.
        try:
            body = json.loads(exc.read().decode("utf-8", "replace"))
        except (ValueError, OSError, http.client.HTTPException):
            return ("unknown", {"probe_error": describe_edge_failure(exc.code)})
    # `http.client.HTTPException` is load-bearing and easy to lose: it subclasses
    # Exception, NOT OSError, so `IncompleteRead` (truncated /health body),
    # `BadStatusLine` and `LineTooLong` all escape an (OSError, ValueError) tuple.
    # Escaping here propagates out of the prod_db_health() call at :533 -- which sits
    # *before* the organic branch -- so the process dies with exit 1 and the
    # CANDIDATE ORGANIC TRAFFIC block never prints. That is a probe fault suppressing
    # a real first user: the precise failure the docstring above forbids. Caught in
    # review of PR #207 (WIC-1636); `test_prod_db_health_faults` below pins it.
    except (urllib.error.URLError, http.client.HTTPException, ValueError, OSError) as exc:
        return ("unknown", {"probe_error": str(exc)})

    return classify_health(body)


# Cloudflare's own edge-generated 5xx codes. These never reach the Worker, so the body is
# plain text ("error code: 522") and carries no health payload -- the generic
# "HTTP <code>, unparseable body" that used to be printed here read as an ambiguous probe
# fault, when in fact each of these is a specific, actionable statement about prod.
# Naming them matters because the failure they describe is NOT the WIC-1386 subrequest
# exhaustion: exhaustion is the Worker *running* and answering 503 with a JSON body, while
# a 52x means the Worker/origin never answered at all. Confusing the two sends the next
# reader to the wrong card.
CF_EDGE_CODES = {
    520: "origin returned an empty/invalid response",
    521: "origin refused the connection (origin down)",
    522: "connection to origin timed out (origin unreachable)",
    523: "origin is unreachable (bad DNS/routing at the edge)",
    524: "origin accepted the connection but never sent a response in time",
    525: "SSL handshake with the origin failed",
    526: "origin presented an invalid SSL certificate",
}


def describe_edge_failure(code):
    """Pure. Render an unparseable HTTP failure into an actionable one-liner."""
    if code in CF_EDGE_CODES:
        return f"HTTP {code} from the Cloudflare edge -- {CF_EDGE_CODES[code]}; the app never ran"
    return f"HTTP {code}, unparseable body"


def classify_health(body):
    """Map a parsed /health payload to (state, detail).

    Pure -- no I/O. That is the point: the recovered-prod branch cannot be exercised
    against live prod while the outage is the reason this code exists (WIC-1580), so it
    is exercised against captured payloads instead. See `--selftest`.
    """
    if not isinstance(body, dict) or "status" not in body:
        return ("unknown", {"probe_error": f"unrecognised health payload: {str(body)[:120]}"})
    # The handler emits "ok", NOT "healthy" -- `packages/api/src/app.ts:98`:
    #     const status = db === 'ok' || db === 'not_applicable' ? 'ok' : 'degraded';
    # The literal "healthy" appears nowhere in packages/api/src. Matching on it would
    # misread a RECOVERED prod as degraded and pin "SECOND CLAUSE NOT MET" on forever --
    # the same release-on-a-false-premise failure this probe exists to prevent, inverted.
    # Accept both spellings, and let an unrecognised status fall to "unknown" rather
    # than silently to "degraded".
    status = body.get("status")
    db = body.get("db")
    if status in ("ok", "healthy"):
        # `status: ok` alone is NOT evidence the DB is reachable. The same line emits ok
        # when `db === 'not_applicable'`, which is what the handler returns when NEITHER
        # the HYPERDRIVE binding NOR DATABASE_URL is present -- the DB was never probed.
        # Production has no Hyperdrive binding and reaches Postgres purely through the
        # DATABASE_URL secret that `deploy.yml` pushes, so a dropped or failed secret push
        # answers 200 `{"status":"ok","hyperdrive":false,"db":"not_applicable"}` with no
        # database behind it at all. Reading that as "reachable" would release the WIC-1024
        # hold onto a prod that cannot serve one authenticated request -- the same
        # false-premise release, arrived at from the opposite direction.
        if db == "ok":
            return ("ok", body)
        return (
            "unknown",
            {"probe_error": f"status={status} but db={str(db)[:60]} -- DB not probed", "payload": body},
        )
    if status == "degraded":
        return ("degraded", body)
    return ("unknown", {"probe_error": f"unrecognised health status: {str(status)[:60]}"})


def describe_health(state, detail):
    if state == "ok":
        return "prod DB reachable (GET /health -> ok, db=ok)"
    if state == "degraded":
        db = (detail or {}).get("db")
        hyperdrive = (detail or {}).get("hyperdrive")
        return (
            f"prod DB UNREACHABLE (GET /health -> degraded, hyperdrive={hyperdrive}): "
            f"{str(db)[:120]}"
        )
    return f"prod DB health UNKNOWN ({(detail or {}).get('probe_error', 'n/a')})"


# Captured payloads, so the branch that only runs after the outage clears can be
# exercised while the outage is still the reason this code exists (WIC-1580). The
# degraded case is a verbatim capture from https://app.careerpin.app/health on
# 2026-08-27 00:53Z; the ok cases are constructed from `packages/api/src/app.ts:98`,
# which is the contract of record.
HEALTH_CASES = [
    # (label, payload, expected state)
    ("recovered prod", {"status": "ok", "hyperdrive": False, "db": "ok"}, "ok"),
    ("recovered prod, hyperdrive path", {"status": "ok", "hyperdrive": True, "db": "ok"}, "ok"),
    ("legacy spelling", {"status": "healthy", "hyperdrive": False, "db": "ok"}, "ok"),
    # 200 + status ok, but the DB was never probed -- must NOT read as reachable.
    ("no DB binding at all", {"status": "ok", "hyperdrive": False, "db": "not_applicable"}, "unknown"),
    ("status ok, db field absent", {"status": "ok", "hyperdrive": False}, "unknown"),
    (
        "live prod 2026-08-27",
        {
            "status": "degraded",
            "hyperdrive": False,
            "db": "Too many subrequests by single Worker invocation.",
        },
        "degraded",
    ),
    ("unrecognised status", {"status": "starting", "db": "ok"}, "unknown"),
    ("not a health payload", {"error": "cloudflare bot challenge"}, "unknown"),
    ("not a dict", "<!DOCTYPE html>", "unknown"),
]

# (label, code, substring that must appear in the rendered probe_error)
EDGE_CASES = [
    ("522 origin unreachable", 522, "connection to origin timed out"),
    ("521 origin down", 521, "refused the connection"),
    ("524 origin never responded", 524, "never sent a response"),
    # Not a CF edge code -- must keep the generic rendering rather than inventing a cause.
    ("502 is not a CF edge code", 502, "unparseable body"),
    ("403 bot challenge", 403, "unparseable body"),
]


# (label, exception the stubbed urlopen raises). Every one must collapse to "unknown"
# rather than escape prod_db_health().
#
# Why this table exists: HEALTH_CASES and EDGE_CASES cover `classify_health` and
# `describe_edge_failure`, which are pure -- but the safety invariant in the
# prod_db_health() docstring lives in the *except tuples*, and those had zero coverage.
# Review of PR #207 (WIC-1636) demonstrated the gap two ways: mutating the fault return
# from "unknown" to "degraded" left the suite at 14/14, and `http.client.HTTPException`
# was genuinely missing from the tuple, so a truncated /health body escaped, propagated
# out of the call at :533 -- before the organic branch -- and exited 1 instead of 10.
# A probe fault suppressed a real first user. Assert the collapse, not the rendering.
PROBE_FAULTS = [
    # HTTPException subclasses OSError NOWHERE. These are the ones that escaped.
    ("truncated /health body", http.client.IncompleteRead(b"", 5)),
    ("garbage status line", http.client.BadStatusLine("\x00\x00")),
    ("oversized header line", http.client.LineTooLong("header line")),
    # Caught before the fix too, but only incidentally -- it also inherits ConnectionResetError.
    ("peer hung up mid-response", http.client.RemoteDisconnected("closed")),
    ("socket read timeout", urllib.error.URLError("The read operation timed out")),
    ("bare timeout", TimeoutError("timed out")),
    ("DNS failure", OSError("Name or service not known")),
    ("unparseable 200 body", ValueError("Expecting value: line 1 column 1")),
]


class _UnreadableBody:
    """A response body that fails mid-read -- exercises the inner tuple at the HTTPError
    branch, where the 503 payload read can fail exactly as the outer call can."""

    def read(self, *_args):
        raise http.client.IncompleteRead(b"", 5)

    def close(self):
        pass


def probe_fault_cases():
    """(label, urlopen-stub) pairs covering both except tuples in prod_db_health."""
    cases = [(label, (lambda e: lambda *a, **k: _raise(e))(exc)) for label, exc in PROBE_FAULTS]

    def http_error_unreadable(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            PROD_HEALTH_URL, 522, "origin timeout", {}, _UnreadableBody()
        )

    cases.append(("522 whose body read fails", http_error_unreadable))
    return cases


def _raise(exc):
    raise exc


def selftest_probe_faults():
    """Stub urlopen and assert every fault path collapses to "unknown" without escaping."""
    failures = 0
    real_urlopen = urllib.request.urlopen
    try:
        for label, stub in probe_fault_cases():
            urllib.request.urlopen = stub
            try:
                state, detail = prod_db_health()
                ok = state == "unknown"
                got = f"{state!r}"
            except Exception as exc:  # noqa: BLE001 -- escaping IS the failure under test
                ok = False
                got = f"ESCAPED {type(exc).__name__}: {exc}"
                detail = None
            failures += 0 if ok else 1
            print(f"  [{'PASS' if ok else 'FAIL'}] probe fault, {label}: got {got}, want 'unknown'")
            if not ok and detail is not None:
                print(f"         detail: {detail}")
    finally:
        urllib.request.urlopen = real_urlopen
    return failures


# The `run()` leg (WIC-1680). PROBE_FAULTS above stops at prod_db_health; this table
# carries the same idea to the two `run()` call sites in main(). Every entry is a fault a
# real PostHog round-trip can produce, and every one of them must be absorbed by
# QUERY_FAULTS rather than escaping into a traceback.
#
# The last entry is a NEGATIVE control and the reason this is a table of (fault, expected)
# rather than a flat list: MemoryError must keep escaping. A tuple that swallowed it would
# pass a naive "nothing escapes" assertion while quietly becoming an `except Exception`.
QUERY_FAULT_CASES = [
    # http.client.HTTPException -- subclasses Exception, not OSError.
    ("truncated response body", http.client.IncompleteRead(b"", 5), True),
    ("garbage status line", http.client.BadStatusLine("\x00\x00"), True),
    ("oversized header line", http.client.LineTooLong("header line"), True),
    ("read before request sent", http.client.ResponseNotReady("Request-sent"), True),
    ("control chars in URL", http.client.InvalidURL("URL can't contain control characters"), True),
    # OSError subclasses -- NOT reachable via HTTPException or ValueError. These are the
    # four the WIC-1680 write-up's suggested two-class fix would have left escaping.
    ("TLS record failure", ssl.SSLError("record layer failure"), True),
    ("bad server certificate", ssl.SSLCertVerificationError("certificate verify failed"), True),
    ("DNS resolution failure", socket.gaierror(-2, "Name or service not known"), True),
    ("peer reset the connection", ConnectionResetError("Connection reset by peer"), True),
    ("socket read timeout", TimeoutError("timed out"), True),
    # ValueError subclasses -- json.load and the utf-8 decode under it.
    ("unparseable 200 body", json.JSONDecodeError("Expecting value", "", 0), True),
    ("undecodable response bytes",
     UnicodeDecodeError("utf-8", b"\xff", 0, 1, "bad start byte"), True),
    # Already caught before the fix; kept so a future tuple edit cannot silently drop them.
    ("wrapped socket error", urllib.error.URLError("The read operation timed out"), True),
    ("HTTP 500 from PostHog",
     urllib.error.HTTPError(HOST, 500, "Internal Server Error", {}, None), True),
    ("missing API key", RuntimeError("POSTHOG_PERSONAL_API_KEY is not set"), True),
    ("200 with no 'columns'", KeyError("columns"), True),
    # Negative control. See the note above: this MUST escape.
    ("memory exhaustion (must escape)", MemoryError(), False),
]

# The aggregate row main() needs before it reaches the candidate branch. organic_events > 0
# is what selects that branch; the rest only has to be printable.
_FAKE_AGGREGATE = {
    "columns": [
        "organic_events", "organic_people", "organic_newest",
        "synthetic_events", "lifetime_events", "lifetime_newest",
    ],
    "results": [[1, 1, "2026-08-29T00:00:00Z", 6, 7, "2026-08-29T00:00:00Z"]],
}


# Reachable only from the aggregate call: `body["results"][0]` on an empty result set.
# Nothing in the candidate-detail branch indexes a row, which is why QUERY_FAULTS does not
# name IndexError and the aggregate site adds it locally.
AGGREGATE_ONLY_FAULTS = [("empty results row", IndexError("list index out of range"), True)]


def _drive_query_fault(exc, fail_on_call):
    """Run main() with run() stubbed to raise `exc` on its `fail_on_call`-th invocation.

    Returns (exit_code, None) or (None, escaped_exception). prod_db_health is stubbed too,
    so the whole thing runs without opening a socket.
    """
    real_run, real_health, real_argv = run, prod_db_health, sys.argv
    calls = []

    def stub_run(_query):
        calls.append(1)
        if len(calls) == fail_on_call:
            raise exc
        return _FAKE_AGGREGATE

    globals()["run"] = stub_run
    globals()["prod_db_health"] = lambda: ("degraded", {"db": "down"})
    # main() re-reads sys.argv; leaving "--selftest" in it would recurse forever.
    sys.argv = ["organic_watch.py"]
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return (main(), None)
    # `Exception`, not `BaseException`: MemoryError subclasses Exception, so this catches
    # the negative control too, while a stray KeyboardInterrupt still aborts the suite.
    except Exception as escaped:  # noqa: BLE001 -- escaping is the behaviour under test
        return (None, escaped)
    finally:
        globals()["run"], globals()["prod_db_health"] = real_run, real_health
        sys.argv = real_argv


def selftest_query_faults():
    """Drive every fault into BOTH run() call sites and assert the exit code survives.

    This asserts the CONSEQUENCE, not the tuple. The bug WIC-1680 describes is an exit-code
    inversion -- 10 ("candidate organic traffic, adjudicate") degrading into a traceback
    exit 1 ("the check itself failed") -- so the test drives real main() control flow and
    checks the exit code, the thing a heartbeat actually branches on. Asserting
    `isinstance(exc, QUERY_FAULTS)` instead would be circular: it would pass against
    whatever tuple the handler happened to name, including the broken one.

    Both legs, because they now share QUERY_FAULTS and a single-site test would not notice
    the shared constant regressing the other:
      - candidate detail (main()'s 2nd run() call) must still return 10;
      - aggregate (main()'s 1st run() call) must return 1 having printed "CHECK FAILED"
        rather than dying in a traceback -- both exit 1, so only driving main() tells the
        handled path from the unhandled one.
    """
    failures = 0
    legs = [
        ("candidate detail", 2, 10, QUERY_FAULT_CASES),
        ("aggregate", 1, 1, QUERY_FAULT_CASES + AGGREGATE_ONLY_FAULTS),
    ]
    for leg, fail_on_call, want_code, cases in legs:
        for label, exc, want_caught in cases:
            code, escaped = _drive_query_fault(exc, fail_on_call)
            if escaped is not None:
                got, ok = f"ESCAPED {type(escaped).__name__}", not want_caught
            else:
                got, ok = f"exit {code}", want_caught and code == want_code
            failures += 0 if ok else 1
            want = f"exit {want_code}" if want_caught else "ESCAPED MemoryError"
            print(f"  [{'PASS' if ok else 'FAIL'}] {leg} fault, {label}: got {got}, want {want}")
    return failures


def selftest():
    """Exercise classify_health against captured/constructed payloads. Exit 0 = all pass."""
    failures = 0
    for label, payload, expected in HEALTH_CASES:
        state, detail = classify_health(payload)
        ok = state == expected
        failures += 0 if ok else 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {state!r}, want {expected!r}")
        if not ok:
            print(f"         detail: {detail}")
    for label, code, want in EDGE_CASES:
        rendered = describe_edge_failure(code)
        ok = want in rendered
        failures += 0 if ok else 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}: {rendered!r}")
        if not ok:
            print(f"         wanted substring: {want!r}")
    failures += selftest_probe_faults()
    failures += selftest_query_faults()
    total = (
        len(HEALTH_CASES)
        + len(EDGE_CASES)
        + len(probe_fault_cases())
        + 2 * len(QUERY_FAULT_CASES)
        + len(AGGREGATE_ONLY_FAULTS)
    )
    print(f"\n{total - failures}/{total} cases pass.")
    return 1 if failures else 0


def arg_value(flag):
    if flag in sys.argv:
        idx = sys.argv.index(flag)
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return None


def main():
    verbose = "--verbose" in sys.argv
    audit = "--audit" in sys.argv

    if "--selftest" in sys.argv:
        return selftest()

    registry, source, problems = load_registry(arg_value("--registry"))
    distinct_ids, event_uuids, session_ids = set(), set(), set()
    if registry is not None:
        distinct_ids, event_uuids, session_ids, more = registry_keys(registry)
        problems += more

    for problem in problems:
        print(f"WARNING: {problem}", file=sys.stderr)

    synthetic, organic = build_predicates(distinct_ids, event_uuids, session_ids)

    if audit or verbose:
        print(
            f"registry: {source or '<none>'} "
            f"({len(registry.get('probes') or []) if registry else 0} probes, "
            f"{len(distinct_ids)} distinct_id / {len(event_uuids)} uuid / "
            f"{len(session_ids)} session_id exclusion keys)"
        )
    if audit:
        print(f"\nSYNTHETIC_PREDICATE:\n  {synthetic}\n\nORGANIC_PREDICATE:\n  {organic}\n")

    try:
        body = run(aggregate_query(synthetic, organic))
        row = dict(zip(body["columns"], body["results"][0]))
    # IndexError is the one class this site needs and the candidate site does not: an empty
    # `results` makes `results[0]` raise. Both sites otherwise share QUERY_FAULTS so they
    # cannot drift apart again, which is how WIC-1680 happened.
    except QUERY_FAULTS + (IndexError,) as exc:
        print(f"CHECK FAILED (not evidence of anything): {exc}", file=sys.stderr)
        return 1

    if verbose or audit:
        print(json.dumps(row, indent=2, default=str))

    # Accounting self-check: every lifetime event should land in exactly one bucket.
    # organic + synthetic < lifetime is expected only for pre-baseline events, which are
    # by construction the original synthetic ones; any other shortfall is drift.
    classified = row["organic_events"] + row["synthetic_events"]
    if classified != row["lifetime_events"]:
        print(
            f"WARNING: {row['lifetime_events'] - classified} event(s) matched neither "
            "predicate -- the fingerprint convention has drifted, review before trusting "
            "this result.",
            file=sys.stderr,
        )

    health_state, health_detail = prod_db_health()
    health_line = describe_health(health_state, health_detail)

    if row["organic_events"] > 0:
        print(
            f"CANDIDATE ORGANIC TRAFFIC -- ADJUDICATE BEFORE RE-RAISING WIC-1024: "
            f"{row['organic_events']} event(s) from {row['organic_people']} actor(s), "
            f"newest {row['organic_newest']}."
        )
        print(f"COLLECTOR HEALTH: {health_line}")
        if health_state != "ok":
            print(
                "\nSECOND CLAUSE NOT MET -- organic traffic alone does NOT release the "
                "WIC-1024 hold while prod is degraded. `resume_upload_completed` sits "
                "after the DB writes and cannot fire, so completion/timing insights and "
                "the C1-C3 person_id tiles would render empty or 100%-failure. Report "
                "the traffic, but keep the dashboard build held on WIC-1473."
            )
        print(
            "\nThese events failed every synthetic fingerprint AND are absent from "
            "probe-registry.json. That is NOT proof they are real users -- an unregistered "
            "probe looks identical. Check session_id for a 'wic<ticket>-' run tag, $lib, "
            "and a fixture-sized file_size_bytes.\n"
        )
        try:
            detail = run(candidate_query(organic))
            print("\t".join(detail["columns"]))
            for r in detail["results"]:
                print("\t".join("" if c is None else str(c) for c in r))
        # This handler sits AFTER the CANDIDATE headline prints and BEFORE `return 10`, so
        # an escape here does not hide the candidate from a human reading stdout -- but it
        # does lose the detail rows (the adjudication evidence) and the registration
        # guidance below, and it turns the exit code 10 that a heartbeat branches on into a
        # traceback exit 1. Same exit-code inversion as WIC-1636, one branch later.
        # No IndexError: nothing here indexes a row, unlike the aggregate call above.
        except QUERY_FAULTS as exc:
            print(f"(candidate detail fetch failed: {exc})", file=sys.stderr)
        print(
            "\nIf synthetic: register the actor in docs/analytics/probe-registry.json "
            "(probes[] entry AND exclusion_keys) and commit -- the watch then goes quiet "
            "permanently, for every consumer, not just this script. If genuinely organic: "
            "comment on WIC-1358 + WIC-1024 with these rows and re-raise WIC-1024 to the "
            "Client Engagement Manager (cf6c7281)."
        )
        return 10

    print(
        f"No organic traffic. lifetime={row['lifetime_events']} "
        f"(all synthetic), newest={row['lifetime_newest']}. Hold WIC-1024, no comment."
    )
    print(f"COLLECTOR HEALTH: {health_line}")
    if health_state != "ok":
        print(
            "NOTE: the client capture leg is independent of the Worker DB, so 0 organic "
            "still means 0 arrivals -- but prod is broken for anyone who does arrive "
            "and signs in. Treat 0 organic as a demand reading taken under an outage, "
            "not as clean demand evidence. Unblock owner: WIC-1473 (board decision)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

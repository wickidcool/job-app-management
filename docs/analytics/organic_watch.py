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

import json
import os
import re
import sys
import urllib.error
import urllib.request

PROJECT = "551963"
HOST = "https://us.posthog.com"

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


def arg_value(flag):
    if flag in sys.argv:
        idx = sys.argv.index(flag)
        if idx + 1 < len(sys.argv):
            return sys.argv[idx + 1]
    return None


def main():
    verbose = "--verbose" in sys.argv
    audit = "--audit" in sys.argv

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
    except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, KeyError, IndexError) as exc:
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

    if row["organic_events"] > 0:
        print(
            f"CANDIDATE ORGANIC TRAFFIC -- ADJUDICATE BEFORE RE-RAISING WIC-1024: "
            f"{row['organic_events']} event(s) from {row['organic_people']} actor(s), "
            f"newest {row['organic_newest']}."
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
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, KeyError) as exc:
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
    return 0


if __name__ == "__main__":
    sys.exit(main())

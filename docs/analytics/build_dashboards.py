#!/usr/bin/env python3
"""Build the three Careerpin PostHog dashboards from insight-payloads.json (WIC-1024).

Turns `docs/analytics/dashboard-spec.md` v1.0 into live PostHog objects: 3 dashboards
(A - Upload Health, B - Export & Engagement, C - Retention & Repeat Usage) and the
17 insights A1-A9 / B1-B5 / C1-C3 attached to them.

Idempotent: dashboards and insights are matched by exact name, so a re-run updates
in place rather than creating duplicates. Safe to run repeatedly.

Every query is filtered against `probe-registry.json` at build time (WIC-1667) -- see
"Synthetic exclusion" below. The committed payloads stay unfiltered; the filter is
applied in memory on the way out.

Usage
-----
    export POSTHOG_PERSONAL_API_KEY=phx_...
    python3 docs/analytics/build_dashboards.py --dry-run   # validate only, no writes
    python3 docs/analytics/build_dashboards.py             # create/update for real

--dry-run needs only read scope (`query:read`) and re-executes every query node
against the live project -- HogQL tables and the native FunnelsQuery/RetentionQuery
insights alike -- so it proves the payloads before anything is written.
The real run additionally needs `insight:read`, `insight:write`, `dashboard:read`,
`dashboard:write` on project 551963.

Synthetic exclusion (WIC-1667)
------------------------------
Project 551963 holds permanent probe residue, so a tile built from the raw payloads
reads synthetic traffic as product usage. Route 3 of the console runbook handles this
by having a human paste `AND NOT ( <SYNTHETIC_PREDICATE> )` into all 17 queries; this
builder is Route 1, and nobody is pasting anything, so it does it itself:

  * the predicate is **derived** from `probe-registry.json` on every run, by importing
    the derivation `organic_watch.py` already owns -- never transcribed, so a probe
    registered tomorrow is excluded by tomorrow's build with no code edit;
  * `insight-payloads.json` and `dashboard-templates.json` stay unfiltered on disk.
    Baking a registry snapshot into a committed artifact is the WIC-1389/WIC-1392 bug
    one layer down, in the file that is hardest to notice;
  * injection is **fail-closed**. A payload whose shape this cannot filter aborts the
    build. Shipping one silently-unfiltered tile is the whole failure mode, and it is
    invisible afterwards -- the dashboard renders, and the numbers look plausible.

`--no-exclusion` reproduces the pre-WIC-1667 unfiltered build. It exists so the
difference stays measurable (`--dry-run` with and without it is the A/B); it is not a
build option, and it says so loudly on stderr.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from pathlib import Path

import requests

HOST = os.environ.get("POSTHOG_HOST", "https://us.posthog.com").rstrip("/")
PROJECT_ID = os.environ.get("POSTHOG_PROJECT_ID", "551963")
PAYLOADS = Path(__file__).with_name("insight-payloads.json")

# Descriptions for the three dashboards, keyed by the `_dashboard` field in the payloads.
DASHBOARD_DESCRIPTIONS = {
    "Dashboard A — Upload Health": (
        "Resume upload pipeline health: success rate, validation errors, funnel, "
        "processing time and parse quality. Spec: docs/analytics/dashboard-spec.md (A1-A9)."
    ),
    "Dashboard B — Export & Engagement": (
        "What users do after a successful upload: export views, resume manager visits, "
        "CTA split and export generation. Spec: docs/analytics/dashboard-spec.md (B1-B5)."
    ),
    "Dashboard C — Retention & Repeat Usage": (
        "Do uploaders come back: 30d return rate, uploads per active user, new vs "
        "returning cohorts. Spec: docs/analytics/dashboard-spec.md (C1-C3)."
    ),
}


class PostHog:
    def __init__(self, api_key: str) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        )

    def _url(self, path: str) -> str:
        return f"{HOST}/api/projects/{PROJECT_ID}/{path.lstrip('/')}"

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        return self.session.request(method, self._url(path), timeout=60, **kwargs)

    def list_all(self, path: str, params: dict | None = None) -> list[dict]:
        """Follow PostHog's cursor pagination and return every result."""
        out: list[dict] = []
        url = self._url(path)
        params = {"limit": 100, **(params or {})}
        while url:
            resp = self.session.get(url, params=params, timeout=60)
            resp.raise_for_status()
            body = resp.json()
            out.extend(body.get("results", []))
            url = body.get("next")
            params = None  # `next` is already fully-qualified
        return out


def fail(msg: str) -> None:
    print(f"FAIL  {msg}", file=sys.stderr)
    sys.exit(1)


# --------------------------------------------------------------------------------------
# Synthetic exclusion (WIC-1667)
# --------------------------------------------------------------------------------------

# Word tokens and the clause keywords that can terminate a WHERE condition inside its own
# scope. `AND`/`OR`/`NOT` are deliberately absent -- they continue the condition.
_SQL_WORD = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")
_WHERE_END = frozenset(
    {"GROUP", "ORDER", "LIMIT", "HAVING", "WINDOW", "OFFSET", "UNION", "INTERSECT",
     "EXCEPT", "SETTINGS", "FORMAT"}
)


def synthetic_predicate() -> tuple[str, str, dict[str, int]]:
    """Derive the HogQL synthetic-actor predicate from the committed probe registry.

    Imports `organic_watch.py` rather than reimplementing it. That module already owns
    registry discovery, the probes[]-vs-exclusion_keys drift audit and the predicate
    construction; a second copy here would be exactly the hand-transcription this ticket
    exists to remove.

    Returns (predicate, registry_path, key_counts). Any registry problem is fatal: every
    one of them means "some known probe is NOT excluded", which is the silent-wrong-number
    outcome this whole mechanism is for.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        import organic_watch
    except ImportError as exc:  # pragma: no cover - only if the file is deleted
        fail(f"cannot import organic_watch.py for the exclusion predicate ({exc})")

    registry, source, problems = organic_watch.load_registry()
    if registry is None:
        fail(
            "no probe-registry.json found, so no synthetic exclusion can be derived: "
            + "; ".join(problems)
        )
    distinct_ids, event_uuids, session_ids, key_problems = organic_watch.registry_keys(registry)
    problems = problems + key_problems
    if problems:
        print("FAIL  probe-registry.json is inconsistent; refusing to build:", file=sys.stderr)
        for problem in problems:
            print(f"        - {problem}", file=sys.stderr)
        print(
            f"\n      Every line above is a probe that would NOT be excluded. Fix {source}\n"
            "      (the probes[] entry and exclusion_keys must agree) and re-run.",
            file=sys.stderr,
        )
        sys.exit(1)

    # `build_predicates` also returns an `organic` form; that one carries organic_watch's
    # BASELINE timestamp cutoff, which is a watcher concern. A dashboard must not silently
    # inherit a "nothing before 2026-08-19" filter, so only the synthetic half is used.
    synthetic, _organic = organic_watch.build_predicates(distinct_ids, event_uuids, session_ids)
    counts = {
        "distinct_ids": len(distinct_ids),
        "event_uuids": len(event_uuids),
        "session_ids": len(session_ids),
    }
    return synthetic, source, counts


def _sql_tokens(sql: str):
    """Yield (start, end, token, depth) for word and parenthesis tokens outside literals.

    `token` is an upper-cased word, or "(" / ")". Depth is the nesting level of the scope
    the token sits in, so a ")" reports the depth of the scope it closes. String literals
    are skipped whole -- an event name like 'resume_upload_completed' must never be read
    as a keyword.

    Comments are skipped whole for the same reason (WIC-1664). A `)` inside `/* ... */`
    used to decrement `depth`, which desyncs every scope after it and lands the injected
    predicate *inside* the comment -- where it is silently discarded while this function
    still reports a filtered site. That is the silent-unfiltered-tile outcome the whole
    mechanism exists to prevent, so comments are masked rather than parsed.
    """
    depth = 0
    i = 0
    n = len(sql)
    while i < n:
        char = sql[i]
        if sql.startswith("--", i):
            newline = sql.find("\n", i)
            i = n if newline == -1 else newline
            continue
        if sql.startswith("/*", i):
            close = sql.find("*/", i + 2)
            i = n if close == -1 else close + 2
            continue
        if char in "'\"":
            quote = char
            i += 1
            while i < n:
                if sql[i] == "\\":
                    i += 2
                    continue
                if sql[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if char == "(":
            depth += 1
            yield i, i + 1, "(", depth
            i += 1
            continue
        if char == ")":
            yield i, i + 1, ")", depth
            depth -= 1
            i += 1
            continue
        match = _SQL_WORD.match(sql, i)
        if match:
            yield match.start(), match.end(), match.group(0).upper(), depth
            i = match.end()
            continue
        i += 1


def inject_hogql(sql: str, predicate: str) -> tuple[str, int]:
    """Add `AND NOT (<predicate>)` to the WHERE of every scope that scans `FROM events`.

    Scope-aware on purpose. `FROM (SELECT ... FROM events WHERE ...)` puts the only real
    events scan inside a subquery (C1's HogQL variant and C3 both do this), and the outer
    query has no WHERE at all -- so "insert after the first WHERE" would filter the wrong
    scope, or nothing. Scopes that read a derived table are skipped: `distinct_id` and
    `uuid` do not exist there.

    The existing condition is wrapped in parentheses before the `AND` is appended, so a
    top-level `OR` cannot silently rebind (`a OR b AND NOT p` is not what we mean).

    Returns (sql, sites_filtered).
    """
    tokens = list(_sql_tokens(sql))
    edits: list[tuple[int, int, str]] = []

    for index, (_start, _end, token, depth) in enumerate(tokens):
        if token != "FROM" or index + 1 >= len(tokens):
            continue
        next_start, next_end, next_token, next_depth = tokens[index + 1]
        if next_token != "EVENTS" or next_depth != depth:
            continue  # a derived table or a different source; not ours to filter

        where = None
        for j in range(index + 2, len(tokens)):
            _js, _je, jtoken, jdepth = tokens[j]
            if jdepth < depth or (jtoken == ")" and jdepth == depth):
                break  # scope closed without a WHERE
            if jdepth != depth:
                continue
            if jtoken == "WHERE":
                where = j
                break
            if jtoken in _WHERE_END or jtoken == "FROM":
                break

        if where is None:
            # `FROM events` with no WHERE in scope: the predicate becomes the whole clause.
            edits.append((next_end, next_end, f"\nWHERE NOT ({predicate})"))
            continue

        cond_start = tokens[where][1]
        cond_end = len(sql)
        for j in range(where + 1, len(tokens)):
            js, _je, jtoken, jdepth = tokens[j]
            if jtoken == ")" and jdepth == depth:
                cond_end = js
                break
            if jdepth == depth and jtoken in _WHERE_END:
                cond_end = js
                break
        condition = sql[cond_start:cond_end].strip()
        if not condition:
            fail("empty WHERE condition while injecting the synthetic exclusion")
        # The closing paren goes on its own line, not straight after `condition`. A WHERE
        # body ending in a `-- ...` comment would otherwise swallow it, leaving the paren
        # commented out and the SQL unbalanced (WIC-1664).
        edits.append((cond_start, cond_end, f" (\n{condition}\n)\n  AND NOT ({predicate})\n"))

    for start, end, text in reversed(edits):  # right-to-left keeps earlier offsets valid
        sql = sql[:start] + text + sql[end:]
    return sql, len(edits)


def inject_native(source: dict, predicate: str) -> int:
    """Attach the exclusion to a native FunnelsQuery / RetentionQuery as a HogQL filter.

    Native insight nodes carry no SQL to edit. PostHog's `hogql` property filter takes an
    arbitrary boolean expression over the event row, which is exactly what the predicate
    is, so the same derived string filters both query families.
    """
    existing = source.get("properties") or []
    if not isinstance(existing, list):
        # A PropertyGroupFilter (dict) would need different merge semantics; no payload
        # uses one, and guessing here would silently drop the exclusion.
        fail(
            f"{source.get('kind')} carries a non-list `properties` filter, which this "
            "builder cannot safely extend with the synthetic exclusion"
        )
    source["properties"] = list(existing) + [{"type": "hogql", "key": f"NOT ({predicate})"}]
    return 1


def apply_exclusion(payload: dict, predicate: str) -> int:
    """Filter one payload in place. Returns the number of sites filtered; 0 aborts."""
    source = payload["query"].get("source", payload["query"])
    kind = source.get("kind")

    if "query" in source:  # HogQLQuery -- edit the SQL
        filtered, sites = inject_hogql(source["query"], predicate)
        if sites == 0:
            fail(
                f"{payload['_key']}: found no `FROM events` scan to filter, so the tile "
                "would ship counting probe residue. Refusing to build it."
            )
        source["query"] = filtered
        return sites

    if kind in ("FunnelsQuery", "RetentionQuery", "TrendsQuery", "StickinessQuery", "PathsQuery"):
        return inject_native(source, predicate)

    fail(
        f"{payload['_key']}: query kind {kind!r} has no known synthetic-exclusion route. "
        "Add one before building this tile (WIC-1667) -- do not ship it unfiltered."
    )
    return 0  # unreachable; keeps the type checker honest


def preflight(ph: PostHog, need_write: bool) -> None:
    """Check scopes up front and name the exact missing ones rather than dying mid-loop."""
    checks = [("query", "query/", "POST")]
    if need_write:
        checks += [("insight", "insights/?limit=1", "GET"), ("dashboard", "dashboards/?limit=1", "GET")]

    missing = []
    for name, path, method in checks:
        if method == "POST":
            resp = ph.request("POST", path, json={"query": {"kind": "HogQLQuery", "query": "SELECT 1"}})
        else:
            resp = ph.request("GET", path)
        if resp.status_code == 403:
            missing.append(f"{name}: {resp.json().get('detail', resp.text)}")
        elif not resp.ok:
            fail(f"preflight {method} {path} -> {resp.status_code} {resp.text[:300]}")

    if missing:
        print("FAIL  PostHog personal API key is missing required scopes:", file=sys.stderr)
        for m in missing:
            print(f"        - {m}", file=sys.stderr)
        print(
            "\n      Fix: PostHog > Settings > Personal API keys > edit the Careerpin analytics key,\n"
            f"      add insight:read, insight:write, dashboard:read, dashboard:write on project {PROJECT_ID}.",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"OK    scopes present ({'read+write' if need_write else 'read'})")


def run_query(ph: PostHog, payload: dict) -> tuple[bool, str]:
    """Execute an insight's underlying query node, whatever its kind.

    Saved insights wrap their real query in a presentation node (`DataTableNode` for the
    HogQL tables, `InsightVizNode` for the native funnel/retention ones). `/query/` wants
    the inner node, so unwrap `source` before executing.
    """
    node = payload["query"]
    node = node.get("source", node)
    resp = ph.request("POST", "query/", json={"query": node})
    if not resp.ok:
        return False, f"HTTP {resp.status_code}: {resp.text[:300]}"
    body = resp.json()
    # Funnel/retention nodes report query-level problems in `error` rather than via HTTP.
    if body.get("error"):
        return False, f"{node['kind']} error: {body['error']}"
    rows = body.get("results", [])
    if not rows:
        return True, f"{node['kind']}: 0 row(s) — empty (no matching events yet)"
    return True, f"{node['kind']}: {len(rows)} row(s): {str(rows[:1])[:160]}"


def ensure_dashboard(ph: PostHog, name: str) -> int:
    existing = {d["name"]: d for d in ph.list_all("dashboards/") if not d.get("deleted")}
    if name in existing:
        dash = existing[name]
        print(f"SKIP  dashboard exists: {name} (id={dash['id']})")
        return dash["id"]
    resp = ph.request(
        "POST",
        "dashboards/",
        json={"name": name, "description": DASHBOARD_DESCRIPTIONS.get(name, ""), "pinned": True},
    )
    if not resp.ok:
        fail(f"create dashboard {name!r} -> {resp.status_code} {resp.text[:300]}")
    dash_id = resp.json()["id"]
    print(f"CREATE dashboard: {name} (id={dash_id})")
    return dash_id


def ensure_insight(ph: PostHog, payload: dict, dashboard_id: int, existing: dict[str, dict]) -> None:
    """Create the insight, or update it in place if one with the same name already exists."""
    body = {k: v for k, v in payload.items() if not k.startswith("_")}
    body["dashboards"] = [dashboard_id]

    current = existing.get(body["name"])
    if current:
        resp = ph.request("PATCH", f"insights/{current['id']}/", json=body)
        verb = "UPDATE"
    else:
        resp = ph.request("POST", "insights/", json=body)
        verb = "CREATE"
    if not resp.ok:
        fail(f"{verb.lower()} insight {body['name']!r} -> {resp.status_code} {resp.text[:300]}")
    print(f"{verb} insight: {body['name']} (id={resp.json()['id']})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate payloads and re-execute every query node; write nothing",
    )
    parser.add_argument(
        "--no-exclusion",
        action="store_true",
        help="build WITHOUT the probe-registry exclusion (pre-WIC-1667 behaviour; "
             "for A/B verification only -- tiles will count synthetic traffic)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("POSTHOG_PERSONAL_API_KEY")
    if not api_key:
        fail("POSTHOG_PERSONAL_API_KEY is not set")

    # deepcopy so the exclusion is applied to this run's objects only -- the payload file
    # on disk stays unfiltered, which is the point (see the module docstring).
    all_payloads = copy.deepcopy(json.loads(PAYLOADS.read_text()))
    # `_enabled: false` entries are authored and validated but deliberately not built yet
    # (see `_gated_on`). They stay in the file so enabling one is a one-line change.
    payloads = [p for p in all_payloads if p.get("_enabled", True)]
    gated = [p for p in all_payloads if not p.get("_enabled", True)]
    print(f"Loaded {len(all_payloads)} insight payloads from {PAYLOADS.name} "
          f"({len(payloads)} enabled, {len(gated)} gated)")
    for p in gated:
        print(f"GATED {p['_key']:<32} {p.get('_gated_on', 'no reason recorded')}")

    if args.no_exclusion:
        print(
            "WARN  --no-exclusion: building from the raw payloads. Every tile will count "
            "the probe residue in\n      project "
            f"{PROJECT_ID} as product usage (WIC-1667). This is an A/B switch, not a "
            "build option.",
            file=sys.stderr,
        )
    else:
        # Gated payloads are filtered too: they must stay correct while they wait, and
        # --dry-run executes them.
        predicate, registry_path, counts = synthetic_predicate()
        sites = sum(apply_exclusion(p, predicate) for p in payloads + gated)
        print(
            f"OK    synthetic exclusion derived from {registry_path} "
            f"({counts['distinct_ids']} distinct_id, {counts['event_uuids']} event_uuid, "
            f"{counts['session_ids']} session_id keys)\n"
            f"      applied to {sites} filter site(s) across {len(all_payloads)} payloads; "
            f"{PAYLOADS.name} on disk is unchanged"
        )

    ph = PostHog(api_key)
    preflight(ph, need_write=not args.dry_run)

    if args.dry_run:
        failures = 0
        # Validate gated payloads too — they must stay correct while they wait.
        for p in payloads + gated:
            ok, detail = run_query(ph, p)
            tag = "PASS" if ok else "FAIL"
            print(f"{tag}  {p['_key']:<32} {detail}")
            failures += 0 if ok else 1
        by_dash: dict[str, int] = {}
        for p in payloads:
            by_dash[p["_dashboard"]] = by_dash.get(p["_dashboard"], 0) + 1
        print("\nWould create/update:")
        for name, count in by_dash.items():
            print(f"  - {name}: {count} insights")
        total = len(payloads) + len(gated)
        print(f"\n{total - failures}/{total} queries executed green.")
        return 1 if failures else 0

    existing_insights = {i["name"]: i for i in ph.list_all("insights/", {"saved": "true"}) if not i.get("deleted")}
    dashboard_ids: dict[str, int] = {}
    for p in payloads:
        name = p["_dashboard"]
        if name not in dashboard_ids:
            dashboard_ids[name] = ensure_dashboard(ph, name)
        ensure_insight(ph, p, dashboard_ids[name], existing_insights)

    print(f"\nDone. {len(dashboard_ids)} dashboards, {len(payloads)} insights.")
    for name, dash_id in dashboard_ids.items():
        print(f"  {name}: {HOST}/project/{PROJECT_ID}/dashboard/{dash_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

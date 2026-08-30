#!/usr/bin/env python3
"""Apply the probe-registry synthetic-exclusion predicate to insight payloads (WIC-1664).

`insight-payloads.json` is deliberately unfiltered: the 17 queries were authored when
project 551963 held nothing but probes, and counting those probes is how each one proved
it ran. On build day that is exactly wrong -- you are building because organic traffic
arrived, and the probe residue is permanent. WIC-1389/WIC-1392 added the exclusion to
Route 3 as prose a human pastes; Routes 1 (API build) and 2 (JSON import) had no
exclusion at all, so both shipped 17 tiles that read probe residue as product usage.

This module closes that at **build time**. The predicate is derived from
`probe-registry.json` on every run via `organic_watch.build_predicates()` -- the same
function the watcher uses -- so there is exactly one implementation of "what is
synthetic". Nothing is baked into a committed artifact, which is the point: a snapshot
committed to `insight-payloads.json` would go stale the next time a probe fires, which is
the WIC-1389/WIC-1392 transcription bug one layer further down.

Two query shapes, two mechanisms, both verified live against 551963:

* **HogQL text** (15 tiles, plus the `_hogql_variant` forms of A1/C1) -- rewritten so
  every `FROM events` block gains `WHERE NOT (<predicate>) AND (<original body>)`.
* **Native `FunnelsQuery` / `RetentionQuery`** (Route 1's A1, C1, and the gated A3n) --
  carry no SQL, so they take a HogQL property filter instead:
  `properties: [{"type": "hogql", "key": "NOT (<predicate>)"}]`.

Everything here fails loud. A query whose shape this cannot rewrite raises
`ExclusionError` rather than passing through untouched: silently shipping one unfiltered
tile among 17 is the failure mode the module exists to prevent, and it is invisible in
the output.

Usage
-----
    python3 docs/analytics/synthetic_exclusion.py            # print the predicate
    python3 docs/analytics/synthetic_exclusion.py --show A9  # print one rewritten query
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import organic_watch as ow  # noqa: E402  (path shim above must run first)


class ExclusionError(Exception):
    """A payload could not be filtered. Always fatal -- never degrade to unfiltered."""


# Query kinds that accept a `properties` list of PostHog property filters. Native
# funnel/retention nodes have no SQL to rewrite, so this is the only lever on them.
PROPERTY_FILTER_KINDS = frozenset(
    {"FunnelsQuery", "RetentionQuery", "TrendsQuery", "PathsQuery", "StickinessQuery", "LifecycleQuery"}
)

# Presentation wrappers that carry the real query at `source`.
WRAPPER_KINDS = frozenset({"InsightVizNode", "DataTableNode", "DataVisualizationNode"})

# Keywords that end a WHERE body at its own paren depth. `WHERE` extends to the first one
# of these, to a closing paren that drops below the starting depth, or to end of query.
_CLAUSE_END = re.compile(
    r"\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|WINDOW|SETTINGS|FORMAT)\b",
    re.IGNORECASE,
)
_FROM_EVENTS = re.compile(r"\bFROM\s+events\b", re.IGNORECASE)
_WHERE = re.compile(r"\bWHERE\b", re.IGNORECASE)


def _mask(sql: str) -> str:
    """Same-length copy of `sql` with string literals and comments neutralised.

    All scanning below runs on the mask and all edits are applied to the original by
    index. Without this, an apostrophe or a bracket inside a literal (`'wic[0-9]+-'`
    appears in the predicate itself) would desynchronise the paren-depth count.

    Literals become `x` and comments become spaces, and the difference is load-bearing.
    Whitespace in the mask has to mean whitespace in the original, because the WHERE body
    is trimmed backwards over it -- blanking a literal to spaces walked that trim back
    across `'resume_upload_completed'` and closed the injected parenthesis in the middle
    of `event =`. Comments, conversely, *must* read as trimmable: a `)` appended after a
    trailing `-- note` would be commented out and the query would not parse.
    """
    out = list(sql)
    i, n = 0, len(sql)
    while i < n:
        if sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "\\":
                    j += 2
                    continue
                if sql[j] == "'":
                    break
                j += 1
            for k in range(i, min(j + 1, n)):
                out[k] = "x"
            i = j + 1
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def _where_body_end(mask: str, start: int) -> int:
    """Index at which the WHERE body beginning at `start` ends (exclusive)."""
    depth = 0
    i, n = start, len(mask)
    while i < n:
        ch = mask[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            if depth == 0:
                break
            depth -= 1
        elif depth == 0:
            m = _CLAUSE_END.match(mask, i)
            if m:
                break
        i += 1
    while i > start and mask[i - 1].isspace():
        i -= 1
    return i


def exclude_from_hogql(sql: str, not_predicate: str, *, label: str = "<query>") -> str:
    """Return `sql` with `not_predicate` ANDed into every `FROM events` WHERE clause.

    Applies to nested scopes too -- C1 and C3 read `events` only inside a subquery, so a
    rewrite that handled just the outer statement would leave both unfiltered while
    reporting success.

    The original body is wrapped in parentheses rather than appended to. `WHERE NOT (p)
    AND a OR b` would silently re-admit `b`; `WHERE NOT (p) AND (a OR b)` cannot.
    """
    mask = _mask(sql)
    edits: list[tuple[int, str]] = []
    for match in _FROM_EVENTS.finditer(mask):
        cursor = match.end()
        while cursor < len(mask) and mask[cursor].isspace():
            cursor += 1
        where = _WHERE.match(mask, cursor)
        if not where:
            following = mask[cursor : cursor + 40].strip().split("\n")[0]
            raise ExclusionError(
                f"{label}: `FROM events` at offset {match.start()} is not followed by a "
                f"WHERE clause (found {following!r}). This module can only filter an "
                "events scan through its own WHERE; add one, or exclude this payload "
                "explicitly. Refusing rather than emitting an unfiltered tile."
            )
        # Step over the whitespace separating `WHERE` from its body, so the rewrite reads
        # `AND (event = ...)` rather than `AND ( event = ...)`. Cosmetic, but this SQL is
        # pasted into a console by hand on build day.
        body_start = where.end()
        while body_start < len(mask) and mask[body_start].isspace():
            body_start += 1
        body_end = _where_body_end(mask, body_start)
        if body_end <= body_start:
            raise ExclusionError(f"{label}: empty WHERE body at offset {body_start}")
        # The whitespace after `WHERE` is still in the string ahead of the insertion
        # point, so only re-supply a separator when there wasn't one (`WHERE(a OR b)`).
        lead = "" if mask[where.end()].isspace() else " "
        edits.append((body_start, f"{lead}NOT ({not_predicate})\n  AND ("))
        edits.append((body_end, ")"))

    if not edits:
        raise ExclusionError(
            f"{label}: no `FROM events` scan found, so no exclusion could be applied. "
            "Every insight in this pack reads the events table; a payload that does not "
            "needs an explicit decision, not a silent pass-through."
        )

    out = sql
    for pos, text in sorted(edits, reverse=True):
        out = out[:pos] + text + out[pos:]
    return out


def exclude_from_node(node: dict, not_predicate: str, *, label: str = "<query>") -> dict:
    """Return a filtered deep copy of an insight query node, whatever its kind."""
    node = copy.deepcopy(node)
    _apply_to_node(node, not_predicate, label)
    return node


def _apply_to_node(node: dict, not_predicate: str, label: str) -> None:
    kind = node.get("kind")
    if kind in WRAPPER_KINDS and isinstance(node.get("source"), dict):
        _apply_to_node(node["source"], not_predicate, label)
        return
    if kind == "HogQLQuery":
        node["query"] = exclude_from_hogql(node["query"], not_predicate, label=label)
        return
    if kind in PROPERTY_FILTER_KINDS:
        # A HogQL property filter is evaluated per event, so it excludes probe events from
        # every step of a funnel and from both the target and returning entity of a
        # retention query -- which a step-level event filter would not.
        props = node.setdefault("properties", [])
        if not isinstance(props, list):
            raise ExclusionError(
                f"{label}: {kind}.properties is {type(props).__name__}, not a list; "
                "cannot append the exclusion filter without risking dropping filters."
            )
        props.append({"type": "hogql", "key": f"NOT ({not_predicate})"})
        return
    raise ExclusionError(
        f"{label}: don't know how to exclude synthetic traffic from a {kind!r} node. "
        "Add it to PROPERTY_FILTER_KINDS if it accepts a `properties` list, or give the "
        "payload a `_hogql_variant`. Refusing rather than emitting an unfiltered tile."
    )


def load_predicate(registry_path: str | None = None) -> tuple[str, str, list[str]]:
    """Return `(synthetic_predicate, registry_path, problems)` from the probe registry.

    Delegates to `organic_watch` so the watcher and the dashboard builds can never
    disagree about which actors are synthetic. A missing registry is fatal here, unlike
    in the watcher: the watcher degrades to prefix fingerprints and merely gets noisier,
    whereas a build that degraded would ship tiles counting the registered probes -- the
    exact defect this closes.
    """
    registry, path, problems = ow.load_registry(registry_path)
    if registry is None:
        raise ExclusionError(
            "probe-registry.json not found. " + " ".join(problems) + "\n"
            "Refusing to build: without the registry the exclusion would silently cover "
            "only the prefix-matchable probes, and WIC-967's bare-UUID distinct_id is "
            "specifically not prefix-matchable."
        )
    distinct_ids, event_uuids, session_ids, key_problems = ow.registry_keys(registry)
    synthetic, _organic = ow.build_predicates(distinct_ids, event_uuids, session_ids)
    return synthetic, path, problems + key_problems


def filtered_payload(payload: dict, not_predicate: str) -> dict:
    """Return a deep copy of an `insight-payloads.json` entry with both forms filtered.

    `_hogql_variant` is filtered alongside `query` because Routes 2 and 3 paste the
    variant for A1/C1 -- filtering only `query` would leave those two tiles unexcluded on
    exactly the routes that cannot see the difference.
    """
    out = copy.deepcopy(payload)
    label = payload.get("_key", payload.get("name", "<payload>"))
    out["query"] = exclude_from_node(payload["query"], not_predicate, label=label)
    variant = payload.get("_hogql_variant")
    if variant:
        out["_hogql_variant"] = dict(
            variant,
            query=exclude_from_node(variant["query"], not_predicate, label=f"{label}._hogql_variant"),
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--registry", help="override the probe-registry.json path")
    parser.add_argument("--show", metavar="KEY_PREFIX", help="print the rewritten query for one payload")
    args = parser.parse_args()

    predicate, path, problems = load_predicate(args.registry)
    for problem in problems:
        print(f"WARN  {problem}", file=sys.stderr)
    print(f"registry: {path}")

    if not args.show:
        print(f"\nNOT (\n  {predicate}\n)")
        return 0

    with open(os.path.join(HERE, "insight-payloads.json"), encoding="utf-8") as fh:
        payloads = json.load(fh)
    matches = [p for p in payloads if p["_key"].startswith(args.show)]
    if not matches:
        print(f"no payload key starts with {args.show!r}", file=sys.stderr)
        return 1
    for payload in matches:
        filtered = filtered_payload(payload, predicate)
        print(f"\n--- {payload['_key']} ---")
        print(json.dumps(filtered["query"], indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

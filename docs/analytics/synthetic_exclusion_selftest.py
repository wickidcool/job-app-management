#!/usr/bin/env python3
"""Self-test for synthetic_exclusion.py (WIC-1664).

Run offline, and wired into CI:

    python3 docs/analytics/synthetic_exclusion_selftest.py

The rewriter edits SQL by string index, which is the kind of code that fails silently and
plausibly -- it emits something that still looks like SQL, and the tile it produces still
renders, just against unfiltered data. So the cases below are mostly the specific ways
this went wrong or could go wrong, not a general grammar exercise. Every case that is
marked as a regression actually happened during WIC-1664.

The live check (`build_dashboards.py --dry-run`, which executes every rewritten query
against project 551963) is the other half and cannot run here -- it needs a PostHog key.
This half needs no credentials, so it runs on every PR.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import synthetic_exclusion as sx  # noqa: E402

PRED = "startsWith(event, 'qa_') OR distinct_id IN ('a-1', 'b-2')"


def balanced(sql: str) -> bool:
    """Paren balance outside string literals -- catches a `)` inserted at a wrong index."""
    depth = 0
    for ch in sx._mask(sql):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


class RewriteShape(unittest.TestCase):
    def test_predicate_lands_once_per_events_scan(self):
        sql = "SELECT count() FROM events WHERE event = 'x'"
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertEqual(out.count(PRED), 1)
        self.assertIn("WHERE NOT (", out)
        self.assertTrue(balanced(out))

    def test_nested_subquery_scan_is_also_filtered(self):
        """C1 and C3 read `events` only inside a subquery.

        A rewriter that handled just the outer statement would leave both tiles
        completely unfiltered while reporting success on all 17.
        """
        sql = (
            "SELECT cohort, count() FROM (\n"
            "  SELECT person_id, min(timestamp) AS first_upload\n"
            "  FROM events\n"
            "  WHERE event = 'resume_upload_completed'\n"
            "  GROUP BY person_id\n"
            ")\nGROUP BY cohort"
        )
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertEqual(out.count(PRED), 1)
        self.assertTrue(balanced(out))
        self.assertIn("GROUP BY person_id", out)

    def test_two_events_scans_both_filtered(self):
        sql = (
            "SELECT * FROM (SELECT 1 FROM events WHERE event = 'a') "
            "UNION ALL SELECT * FROM (SELECT 1 FROM events WHERE event = 'b')"
        )
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertEqual(out.count(PRED), 2)
        self.assertTrue(balanced(out))

    def test_closing_paren_lands_after_a_trailing_string_literal(self):
        """REGRESSION. Literals were masked to spaces, so the backwards trim over
        trailing whitespace walked across `'resume_upload_completed'` and closed the
        injected parenthesis inside the expression: `AND ( event =) 'resume_...'`.
        Still parses as far as a human skim goes; does not parse as HogQL."""
        sql = "SELECT 1\nFROM events\nWHERE event = 'resume_upload_completed'\nGROUP BY person_id"
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertIn("AND (event = 'resume_upload_completed')", out)
        self.assertNotIn("=)", out)
        self.assertTrue(balanced(out))

    def test_original_where_body_is_parenthesised(self):
        """`WHERE NOT (p) AND a OR b` re-admits every synthetic row matching `b`.

        Precedence, not a typo: `AND` binds tighter than `OR`, so the exclusion would
        apply to only the first disjunct. Wrapping the original body makes it impossible.
        """
        sql = "SELECT 1 FROM events WHERE event = 'a' OR event = 'b'"
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertIn("AND (event = 'a' OR event = 'b')", out)

    def test_clause_keywords_end_the_where_body(self):
        for tail in ("GROUP BY x", "ORDER BY x", "HAVING count() > 1", "LIMIT 10", "OFFSET 5"):
            with self.subTest(tail=tail):
                out = sx.exclude_from_hogql(f"SELECT 1 FROM events WHERE event = 'a' {tail}", PRED)
                self.assertIn(f"AND (event = 'a') {tail}", out)
                self.assertTrue(balanced(out))

    def test_parens_and_apostrophes_inside_literals_do_not_desync(self):
        """The predicate itself contains `'^wic[0-9]+-'`; payload literals may contain
        anything. Depth counting must ignore literal contents."""
        sql = "SELECT 1 FROM events WHERE properties.note = 'a ) ( b' AND event = 'x'"
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertIn("AND (properties.note = 'a ) ( b' AND event = 'x')", out)
        self.assertTrue(balanced(out))

    def test_trailing_comment_stays_outside_the_injected_paren(self):
        """A `)` appended after `-- note` would be commented out and never parse."""
        sql = "SELECT 1 FROM events WHERE event = 'a' -- why\nGROUP BY x"
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertIn("AND (event = 'a') -- why", out)
        self.assertTrue(balanced(out))

    def test_block_comment_parens_do_not_desync(self):
        """A `)` inside a `/* ... */` block comment must not be counted by the paren-depth
        walk -- otherwise the WHERE body would be closed early, inside the comment."""
        sql = "SELECT 1 FROM events WHERE event = 'a' /* note ) ( */ AND event = 'b'"
        out = sx.exclude_from_hogql(sql, PRED)
        self.assertIn("AND (event = 'a' /* note ) ( */ AND event = 'b')", out)
        self.assertTrue(balanced(out))

    def test_intersect_and_except_end_the_where_body(self):
        """INTERSECT/EXCEPT are the set-operator companions to UNION; a WHERE body
        followed by one must stop there, not over-run into the next SELECT."""
        for op in ("INTERSECT", "EXCEPT"):
            with self.subTest(op=op):
                sql = f"SELECT 1 FROM events WHERE event = 'a' {op} SELECT 1 FROM events WHERE event = 'b'"
                out = sx.exclude_from_hogql(sql, PRED)
                self.assertEqual(out.count(PRED), 2)
                self.assertIn(f"AND (event = 'a') {op}", out)
                self.assertTrue(balanced(out))


class RefusesRatherThanShippingUnfiltered(unittest.TestCase):
    """Every one of these must raise. Passing the query through untouched would ship a
    tile that reads probe residue as product usage, indistinguishably from a real one."""

    def test_events_scan_without_a_where(self):
        with self.assertRaises(sx.ExclusionError) as ctx:
            sx.exclude_from_hogql("SELECT count() FROM events", PRED)
        self.assertIn("not followed by a WHERE", str(ctx.exception))

    def test_events_scan_with_an_alias_instead_of_where(self):
        with self.assertRaises(sx.ExclusionError):
            sx.exclude_from_hogql("SELECT count() FROM events e WHERE e.event = 'a'", PRED)

    def test_query_that_never_reads_events(self):
        with self.assertRaises(sx.ExclusionError) as ctx:
            sx.exclude_from_hogql("SELECT 1", PRED)
        self.assertIn("no `FROM events` scan found", str(ctx.exception))

    def test_unknown_node_kind(self):
        with self.assertRaises(sx.ExclusionError) as ctx:
            sx.exclude_from_node({"kind": "WebOverviewQuery"}, PRED)
        self.assertIn("WebOverviewQuery", str(ctx.exception))

    def test_non_list_properties_is_not_clobbered(self):
        with self.assertRaises(sx.ExclusionError):
            sx.exclude_from_node({"kind": "FunnelsQuery", "properties": {"a": 1}}, PRED)


class NodeHandling(unittest.TestCase):
    def test_native_nodes_take_a_hogql_property_filter(self):
        for kind in ("FunnelsQuery", "RetentionQuery"):
            with self.subTest(kind=kind):
                out = sx.exclude_from_node({"kind": "InsightVizNode", "source": {"kind": kind}}, PRED)
                self.assertEqual(
                    out["source"]["properties"], [{"type": "hogql", "key": f"NOT ({PRED})"}]
                )

    def test_existing_property_filters_are_preserved(self):
        node = {"kind": "FunnelsQuery", "properties": [{"type": "event", "key": "source"}]}
        out = sx.exclude_from_node(node, PRED)
        self.assertEqual(len(out["properties"]), 2)
        self.assertEqual(out["properties"][0], {"type": "event", "key": "source"})

    def test_input_node_is_not_mutated(self):
        node = {"kind": "DataTableNode", "source": {"kind": "HogQLQuery",
                                                    "query": "SELECT 1 FROM events WHERE event = 'a'"}}
        before = json.dumps(node, sort_keys=True)
        sx.exclude_from_node(node, PRED)
        self.assertEqual(json.dumps(node, sort_keys=True), before)


class AgainstTheRealPayloads(unittest.TestCase):
    """The 18 committed payloads, structurally. No network, no credentials."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "insight-payloads.json"), encoding="utf-8") as fh:
            cls.payloads = json.load(fh)

    def test_registry_yields_a_predicate_with_no_integrity_problems(self):
        predicate, path, problems = sx.load_predicate()
        self.assertEqual(problems, [], f"probe-registry.json integrity problems: {problems}")
        self.assertTrue(os.path.isfile(path))
        # WIC-967's distinct_id is a bare Supabase UUID that no prefix rule can catch; it
        # is the reason the registry exists, so assert the predicate actually carries it.
        self.assertIn("fa21d5a4-2ac9-455e-b31f-3553a314792f", predicate)

    def test_every_payload_and_variant_is_filtered(self):
        predicate, _path, _problems = sx.load_predicate()
        seen_native = seen_variant = 0
        for payload in self.payloads:
            with self.subTest(key=payload["_key"]):
                out = sx.filtered_payload(payload, predicate)
                node = out["query"].get("source", out["query"])
                if node["kind"] == "HogQLQuery":
                    self.assertIn(predicate, node["query"])
                    self.assertTrue(balanced(node["query"]))
                else:
                    self.assertIn(
                        {"type": "hogql", "key": f"NOT ({predicate})"},
                        node.get("properties", []),
                    )
                    seen_native += 1
                variant = out.get("_hogql_variant")
                if variant:
                    seen_variant += 1
                    inner = variant["query"]["source"]
                    self.assertIn(predicate, inner["query"])
                    self.assertTrue(balanced(inner["query"]))
        # A1/C1 (native, with variants) and the gated A3n. If these drop to zero the two
        # non-SQL code paths have stopped being exercised and the suite is only testing
        # the easy half.
        self.assertEqual(seen_native, 3)
        self.assertEqual(seen_variant, 2)

    def test_committed_payloads_stay_unfiltered(self):
        """The build filters; the committed file must not.

        `insight-payloads.json` is the artifact humans read and Route 2 imports. Baking
        the predicate into it would commit a registry snapshot that goes stale on the
        next probe -- the WIC-1389/WIC-1392 transcription bug, one layer down.
        """
        raw = json.dumps(self.payloads)
        for marker in ("NOT IN", "distinct_id", "startsWith(event"):
            self.assertNotIn(marker, raw, f"{marker!r} found in committed insight-payloads.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)

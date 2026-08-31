#!/usr/bin/env python3
"""Self-test for the synthetic exclusion in build_dashboards.py (WIC-1664 / WIC-1667).

Run offline, and wired into CI:

    python3 docs/analytics/build_dashboards_selftest.py

`inject_hogql` edits SQL by string index, which is the kind of code that fails silently
and plausibly -- it emits something that still looks like SQL, and the tile it produces
still renders, just against unfiltered data. `apply_exclusion` only fails the build when
*zero* sites are filtered, so a rewrite that reports one site and produces a query the
predicate does not actually constrain sails straight through. So the cases below are
mostly the specific ways this went wrong or could go wrong, not a general grammar
exercise.

The live check (`build_dashboards.py --dry-run`, which executes every rewritten query
against project 551963) is the other half and cannot run here -- it needs a PostHog key.
This half needs no credentials, so it runs on every PR.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location(
    "build_dashboards", os.path.join(HERE, "build_dashboards.py")
)
bd = importlib.util.module_from_spec(_spec)
sys.modules["build_dashboards"] = bd
_spec.loader.exec_module(bd)

PRED = "startsWith(event, 'qa_') OR distinct_id IN ('a-1', 'b-2')"


def _scan(sql: str, keep_literals: bool) -> str:
    """Drop comments; keep or blank string literals.

    Deliberately a second, independent implementation rather than a call into
    `bd._sql_tokens`. Masking comments is the thing under test here, so a helper that
    borrowed the module's own tokenizer would be blind in exactly the way the bug is:
    against the pre-fix build_dashboards.py the line-comment case passed spuriously
    because the shared helper mis-parsed the output the same way the injector did.
    """
    out = []
    i = 0
    n = len(sql)
    while i < n:
        if sql.startswith("--", i):
            newline = sql.find("\n", i)
            i = n if newline == -1 else newline
            continue
        if sql.startswith("/*", i):
            close = sql.find("*/", i + 2)
            i = n if close == -1 else close + 2
            continue
        char = sql[i]
        if char in "'\"":
            quote = char
            start = i
            i += 1
            while i < n:
                if sql[i] == "\\":
                    i += 2
                    continue
                if sql[i] == quote:
                    i += 1
                    break
                i += 1
            out.append(sql[start:i] if keep_literals else "''")
            continue
        out.append(char)
        i += 1
    return "".join(out)


def uncommented(sql: str) -> str:
    """The SQL with comments removed and literals left intact."""
    return _scan(sql, keep_literals=True)


def balanced(sql: str) -> bool:
    """Paren balance outside literals and comments -- catches a `)` at a wrong index."""
    depth = 0
    for char in _scan(sql, keep_literals=False):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def tight(sql: str) -> str:
    """Collapse whitespace and close it up around parens, ignoring literals.

    Lets an assertion test *structure* -- "the original body is wrapped in parens" --
    without pinning the injector's line layout, which is free to change. Literals are
    blanked first so that whitespace or parens *inside* a literal are never rewritten.
    """
    return " ".join(_scan(sql, keep_literals=False).split()).replace("( ", "(").replace(" )", ")")


class InjectHogql(unittest.TestCase):
    def test_predicate_lands_once_per_events_scan(self):
        out, sites = bd.inject_hogql("SELECT count() FROM events WHERE event = 'a'", PRED)
        self.assertEqual(sites, 1)
        self.assertEqual(uncommented(out).count("AND NOT ("), 1)
        self.assertTrue(balanced(out))

    def test_original_where_body_is_parenthesised(self):
        # `NOT (p) AND a OR b` would silently re-admit b; the body must be wrapped.
        out, _ = bd.inject_hogql(
            "SELECT count() FROM events WHERE event = 'a' OR event = 'b'", PRED
        )
        self.assertIn("(event = '' OR event = '')", tight(out))  # `tight` blanks literals
        self.assertTrue(balanced(out))

    def test_nested_subquery_scan_is_also_filtered(self):
        # C1's HogQL variant and C3 scan events only inside a subquery; an outer-only
        # rewrite leaves both unfiltered while reporting success.
        sql = (
            "SELECT count() FROM (SELECT person_id FROM events "
            "WHERE event = 'a' GROUP BY person_id)"
        )
        out, sites = bd.inject_hogql(sql, PRED)
        self.assertEqual(sites, 1)
        self.assertIn("GROUP BY person_id", out)
        self.assertEqual(uncommented(out).count("AND NOT ("), 1)
        self.assertTrue(balanced(out))

    def test_two_events_scans_both_filtered(self):
        sql = (
            "SELECT (SELECT count() FROM events WHERE event = 'a') , "
            "(SELECT count() FROM events WHERE event = 'b')"
        )
        out, sites = bd.inject_hogql(sql, PRED)
        self.assertEqual(sites, 2)
        self.assertEqual(uncommented(out).count("AND NOT ("), 2)
        self.assertTrue(balanced(out))

    def test_clause_keywords_end_the_where_body(self):
        for tail in ("GROUP BY x", "ORDER BY x", "HAVING count() > 1", "LIMIT 10", "OFFSET 5"):
            with self.subTest(tail=tail):
                out, _ = bd.inject_hogql(
                    f"SELECT count() FROM events WHERE event = 'a' {tail}", PRED
                )
                self.assertTrue(out.rstrip().endswith(tail))
                self.assertTrue(balanced(out))

    def test_parens_and_apostrophes_inside_literals_do_not_desync(self):
        out, sites = bd.inject_hogql(
            "SELECT count() FROM events WHERE properties.note = 'a ) ( b' AND event = 'x'",
            PRED,
        )
        self.assertEqual(sites, 1)
        # The literal survives verbatim, and its parens did not desync the scan: the
        # whole body is wrapped exactly once. (`tight` blanks literals, hence the ''.)
        self.assertIn("'a ) ( b'", out)
        self.assertIn("(properties.note = '' AND event = '')", tight(out))
        self.assertTrue(balanced(out))

    def test_derived_table_scan_is_skipped(self):
        # `distinct_id` / `uuid` do not exist on a derived table, so that scope is not
        # ours to filter -- only the inner real events scan is.
        sql = "SELECT count() FROM (SELECT uuid FROM events WHERE event = 'a') AS t"
        out, sites = bd.inject_hogql(sql, PRED)
        self.assertEqual(sites, 1)
        self.assertTrue(balanced(out))

    # -- comment handling ---------------------------------------------------------------
    #
    # The first three are regressions caught on this branch. The last two pin the `--`
    # masking branch of `_sql_tokens`, which the first three left entirely unpinned: it
    # could be deleted outright without reddening any of them (WIC-1664 review). Each
    # `/* */` case below has a `--` twin, because the two comment syntaxes fail the same
    # two ways and only the block-comment half had cover.

    def test_trailing_line_comment_does_not_swallow_the_closing_paren(self):
        # Regression: the wrap used to emit `(cond -- why)`, commenting out the `)` and
        # leaving the SQL unbalanced.
        out, sites = bd.inject_hogql(
            "SELECT count() FROM events WHERE event = 'a' -- why\n", PRED
        )
        self.assertEqual(sites, 1)
        self.assertTrue(balanced(out), f"unbalanced parens: {out!r}")
        self.assertIn("AND NOT (", uncommented(out))

    def test_block_comment_parens_do_not_desync(self):
        # Regression, and the dangerous one: a `)` inside `/* ... */` decremented depth,
        # so the whole predicate was injected INSIDE the comment -- silently discarded
        # while inject_hogql still reported one filtered site and the tile ran green.
        out, sites = bd.inject_hogql(
            "SELECT count() FROM events WHERE event = 'a' /* note ) ( */ AND event = 'b'",
            PRED,
        )
        self.assertEqual(sites, 1)
        self.assertTrue(balanced(out), f"unbalanced parens: {out!r}")
        self.assertIn("AND NOT (", uncommented(out))

    def test_line_comment_parens_do_not_desync(self):
        # The `--` twin of test_block_comment_parens_do_not_desync. Without the line
        # comment masked in `_sql_tokens`, this `)` decrements depth and the wrap closes
        # at the wrong index, emitting unbalanced SQL.
        out, sites = bd.inject_hogql(
            "SELECT count() FROM events WHERE event = 'a' -- note )\nAND event = 'b'",
            PRED,
        )
        self.assertEqual(sites, 1)
        self.assertTrue(balanced(out), f"unbalanced parens: {out!r}")
        self.assertIn("AND NOT (", uncommented(out))

    def test_keyword_inside_a_comment_does_not_end_the_where_body(self):
        out, _ = bd.inject_hogql(
            "SELECT count() FROM events WHERE event = 'a' /* GROUP BY x */ AND event = 'b'",
            PRED,
        )
        self.assertIn("AND event = 'b'", uncommented(out))
        self.assertTrue(balanced(out))

    def test_keyword_inside_a_line_comment_does_not_end_the_where_body(self):
        # The `--` twin of the block-comment case, and the worse one: an unmasked
        # `-- GROUP BY x` ends the WHERE body early and *promotes the commented text
        # into executable SQL*, silently regrouping the tile. Paren balance and the
        # site count both still look correct, so only this assertion catches it.
        out, _ = bd.inject_hogql(
            "SELECT count() FROM events WHERE event = 'a' -- GROUP BY x\nAND event = 'b'",
            PRED,
        )
        self.assertIn("AND event = 'b'", uncommented(out))
        self.assertNotIn("GROUP BY", uncommented(out))
        self.assertTrue(balanced(out))

    # -- refusals ---------------------------------------------------------------------

    def test_events_scan_without_a_where_gets_a_whole_where_clause(self):
        out, sites = bd.inject_hogql("SELECT count() FROM events", PRED)
        self.assertEqual(sites, 1)
        self.assertIn("WHERE NOT (", uncommented(out))
        self.assertTrue(balanced(out))

    def test_query_that_never_reads_events_filters_nothing(self):
        # inject_hogql reports 0; apply_exclusion is what turns that into a hard failure.
        _out, sites = bd.inject_hogql("SELECT 1", PRED)
        self.assertEqual(sites, 0)

    def test_unterminated_block_comment_fails_closed(self):
        # `/* oops` with no `*/` masks to end-of-string: the predicate would land inside
        # the never-closed comment and the emitted SQL is unbalanced, yet inject_hogql
        # still reports one filtered site -- the silent-unfilter signature this whole
        # mechanism exists to kill (WIC-1844). Drop the `close == -1` guard in
        # `_sql_tokens` and this reds (it returns (sql, 1) instead of raising).
        with self.assertRaises(SystemExit):
            bd.inject_hogql("SELECT count() FROM events WHERE event = 'a' /* oops", PRED)

    def test_comment_only_where_body_fails_closed(self):
        # `WHERE -- all` is a non-empty substring but carries no tokens, so it would wrap
        # to `WHERE ()` -- empty parens, invalid SQL. The pre-fix `if not condition` guard
        # missed it because "-- all" is truthy; the fix counts tokens after comment
        # masking (WIC-1844). Revert that guard to `if not condition` and this reds.
        with self.assertRaises(SystemExit):
            bd.inject_hogql("SELECT count() FROM events WHERE -- all\n", PRED)


class ApplyExclusion(unittest.TestCase):
    def test_zero_sites_is_fatal(self):
        payload = {"_key": "A1", "query": {"kind": "HogQLQuery", "query": "SELECT 1"}}
        with self.assertRaises(SystemExit):
            bd.apply_exclusion(payload, PRED)

    def test_unknown_node_kind_is_fatal(self):
        payload = {"_key": "A1", "query": {"kind": "WebOverviewQuery"}}
        with self.assertRaises(SystemExit):
            bd.apply_exclusion(payload, PRED)

    def test_native_nodes_take_a_hogql_property_filter(self):
        for kind in ("FunnelsQuery", "RetentionQuery"):
            with self.subTest(kind=kind):
                payload = {"_key": "A1", "query": {"source": {"kind": kind}}}
                sites = bd.apply_exclusion(payload, PRED)
                self.assertEqual(sites, 1)
                props = payload["query"]["source"]["properties"]
                self.assertEqual(props[-1]["type"], "hogql")
                self.assertEqual(props[-1]["key"], f"NOT ({PRED})")

    def test_existing_property_filters_are_preserved(self):
        existing = {"type": "event", "key": "x"}
        payload = {
            "_key": "A1",
            "query": {"source": {"kind": "FunnelsQuery", "properties": [existing]}},
        }
        bd.apply_exclusion(payload, PRED)
        props = payload["query"]["source"]["properties"]
        self.assertEqual(len(props), 2)
        self.assertEqual(props[0], existing)

    def test_non_list_properties_is_not_clobbered(self):
        payload = {
            "_key": "A1",
            "query": {"source": {"kind": "FunnelsQuery", "properties": {"type": "AND"}}},
        }
        with self.assertRaises(SystemExit):
            bd.apply_exclusion(payload, PRED)


class CommittedPayloads(unittest.TestCase):
    """The committed payloads must stay filterable, and stay unfiltered on disk."""

    def setUp(self):
        import json

        with open(os.path.join(HERE, "insight-payloads.json")) as handle:
            data = json.load(handle)
        self.payloads = data if isinstance(data, list) else data.get("payloads", [])
        self.assertTrue(self.payloads, "no payloads loaded")

    def test_committed_payloads_carry_no_exclusion(self):
        # Baking a registry snapshot into the artifact a human imports is the
        # WIC-1389/WIC-1392 bug one layer down. The filter is applied in memory only.
        import json

        raw = json.dumps(self.payloads)
        self.assertNotIn("AND NOT (", raw)
        self.assertNotIn("distinct_id IN (", raw)

    def test_every_enabled_payload_is_filterable(self):
        import copy

        for payload in self.payloads:
            if payload.get("_enabled") is False:
                continue
            key = payload.get("_key", "?")
            with self.subTest(key=key):
                sites = bd.apply_exclusion(copy.deepcopy(payload), PRED)
                self.assertGreaterEqual(sites, 1)


class Predicate(unittest.TestCase):
    def test_registry_yields_a_predicate_with_no_integrity_problems(self):
        predicate, source, counts = bd.synthetic_predicate()
        self.assertTrue(predicate.strip())
        self.assertTrue(os.path.exists(source))
        self.assertGreater(sum(counts.values()), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

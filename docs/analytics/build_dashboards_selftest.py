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

# make_console_pack (Route 2) reuses build_dashboards' rewriter. Loading it after `bd` is in
# sys.modules means its own `import build_dashboards as bd` resolves to the same module here.
_mcp_spec = importlib.util.spec_from_file_location(
    "make_console_pack", os.path.join(HERE, "make_console_pack.py")
)
mcp = importlib.util.module_from_spec(_mcp_spec)
sys.modules["make_console_pack"] = mcp
_mcp_spec.loader.exec_module(mcp)

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

    def test_set_operators_end_the_where_body(self):
        # Folded from PR #267's synthetic_exclusion_selftest (WIC-1800): UNION's set-operator
        # companions must terminate the WHERE body too, or the injected `AND NOT (...)` runs
        # past the operator and rebinds the second SELECT. No current payload uses these, so
        # this guards the shape before one does -- the fix-it-once point of WIC-1664.
        for op in ("UNION ALL", "INTERSECT", "EXCEPT"):
            with self.subTest(op=op):
                out, _ = bd.inject_hogql(
                    f"SELECT count() FROM events WHERE event = 'a' "
                    f"{op} SELECT count() FROM events WHERE event = 'b'",
                    PRED,
                )
                # Two `FROM events` scans, so two injected predicates, one per SELECT.
                self.assertEqual(uncommented(out).count("AND NOT ("), 2)
                self.assertIn(f"{op.split()[0]} ", uncommented(out))
                # Each SELECT keeps its own wrapped WHERE body. Without the `_WHERE_END`
                # widening the set operator fails to terminate the first WHERE, the second
                # SELECT is swallowed into its parens, and only one `WHERE (` survives -- the
                # `AND NOT (` count and `balanced()` both stay green (two defects cancel), so
                # this is the assertion that actually pins the widening (WIC-1845 review).
                self.assertEqual(out.count("WHERE ("), 2)
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


class ConsolePackRoute2(unittest.TestCase):
    """Route 2 (make_console_pack.py) reuses build_dashboards' rewriter (WIC-1845).

    These fold in the CLI-surface cases from PR #267's synthetic_exclusion_selftest, but
    exercised against the single rewriter now shared with Route 1 -- no second copy.
    """

    @staticmethod
    def _run(argv):
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            mcp.main(argv)

    @staticmethod
    def _templates(out_dir):
        import json

        with open(os.path.join(out_dir, "dashboard-templates.json")) as fh:
            raw = fh.read()
        return raw, json.loads(raw)

    def test_default_output_is_unfiltered(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            self._run(["--out-dir", tmp])
            raw, templates = self._templates(tmp)
            self.assertNotIn("AND NOT (", raw)
            tiles = [t for tpl in templates for t in tpl["tiles"]]
            self.assertEqual(len(tiles), 17)

    def test_exclude_synthetic_filters_every_tile(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            self._run(["--exclude-synthetic", "--out-dir", tmp])
            raw, templates = self._templates(tmp)
            import json

            tiles = [t for tpl in templates for t in tpl["tiles"]]
            self.assertEqual(len(tiles), 17)
            # Every tile Route 2 imports -- including A1/C1, whose pasteable form is the
            # `_hogql_variant` and not the native node -- carries the predicate.
            for tile in tiles:
                self.assertIn("AND NOT (", json.dumps(tile))

    def test_exclude_synthetic_refuses_without_out_dir(self):
        # out-dir defaults to docs/analytics/, so a bare --exclude-synthetic is refused
        # for the same reason as an explicit --out-dir docs/analytics/.
        with self.assertRaises(SystemExit):
            self._run(["--exclude-synthetic"])

    def test_exclude_synthetic_refuses_writing_into_docs_analytics(self):
        with self.assertRaises(SystemExit):
            self._run(["--exclude-synthetic", "--out-dir", HERE])

    def test_exclude_synthetic_refuses_a_subdirectory_of_docs_analytics(self):
        # `docs/analytics/subdir` is still inside the tree the runbook promises a filtered
        # pack can never land in; refusing only the exact dir would let one be committed a
        # level down (WIC-1845 review).
        with self.assertRaises(SystemExit):
            self._run(["--exclude-synthetic", "--out-dir", os.path.join(HERE, "subdir")])

    def test_committed_templates_json_is_unfiltered(self):
        # The artifact a human imports is committed UNFILTERED on purpose: it proves it was
        # built against probe data, and baking today's registry into it is the
        # WIC-1389/WIC-1392 staleness bug one layer down. The filter is out-of-tree only.
        with open(os.path.join(HERE, "dashboard-templates.json")) as fh:
            committed = fh.read()
        self.assertNotIn("AND NOT (", committed)
        self.assertNotIn("distinct_id IN (", committed)

    def test_exactly_one_rewriter_lives_under_docs_analytics(self):
        # WIC-1845 dropped the synthetic_exclusion.py twin; a second rewriter reintroduces
        # the divergence WIC-1664 exists to prevent (both twins needed the comment-masking
        # fix independently). build_dashboards.py is the single source.
        self.assertFalse(
            os.path.exists(os.path.join(HERE, "synthetic_exclusion.py")),
            "synthetic_exclusion.py is back -- Route 2 must reuse build_dashboards.py, "
            "not a second rewriter",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

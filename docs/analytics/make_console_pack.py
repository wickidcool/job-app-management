#!/usr/bin/env python3
"""Generate the zero-scope console build pack from insight-payloads.json.

WIC-1024 has been blocked for >12h on a PostHog console scope grant that no agent
can perform. This produces the alternative path: everything a human needs to build
Dashboards A/B/C by hand in the PostHog UI, with no API scope change at all.

Outputs (next to this file):
  dashboard-templates.json  -- 3 PostHog dashboard-template objects for JSON import
  console-build-runbook.md  -- click-by-click runbook + per-insight HogQL to paste

Both routes here are paste-the-SQL routes, so every tile needs HogQL text. Most payloads carry
it inline at `query.source.query`. #81 re-expressed A1 and C1 as PostHog-native funnel/retention
queries, which carry no SQL -- those two keep their pasteable form under `_hogql_variant`
(description + full `DataTableNode`/`HogQLQuery` node), so `insight-payloads.json` remains the
single source of truth for all three routes. `resolve_hogql()` prefers the inline form and falls
back to the variant; anything with neither aborts the run before a byte is written.
"""
import argparse
import copy
import json
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))

# Route 1 (build_dashboards.py) already owns the synthetic-exclusion rewriter -- the
# predicate derivation (`synthetic_predicate`) and the scope-aware HogQL/native
# injectors (`apply_exclusion`). Route 2 reuses that exact code rather than carrying a
# second copy, so a rewriter fix is found and applied once, not twice (WIC-1664/WIC-1845).
# The path shim lets this run from any cwd.
sys.path.insert(0, HERE)
import build_dashboards as bd  # noqa: E402  (path shim above must run first)

PROJECT = "551963"
HOST = "https://us.posthog.com"

DASHBOARDS = [
    ("Dashboard A — Upload Health",
     "Resume upload pipeline health: success/failure rates, processing latency, parse quality. "
     "Source: docs/analytics/dashboard-spec.md v1.0 (A1-A9)."),
    ("Dashboard B — Export & Engagement",
     "Post-upload engagement: export views, resume-manager visits, CTA split, export generation. "
     "Source: docs/analytics/dashboard-spec.md v1.0 (B1-B5)."),
    ("Dashboard C — Retention & Repeat Usage",
     "Repeat-usage behaviour keyed on person_id: return rate, uploads per active user, new vs returning. "
     "Source: docs/analytics/dashboard-spec.md v1.0 (C1-C3)."),
]

# Tiles are laid out two-up on the 12-column `sm` breakpoint, single-column on `xs`.
TILE_W, TILE_H = 6, 5


def layouts_for(index):
    return {
        "sm": {"i": str(index), "x": (index % 2) * TILE_W, "y": (index // 2) * TILE_H,
               "w": TILE_W, "h": TILE_H, "minW": 3, "minH": 5},
        "xs": {"i": str(index), "x": 0, "y": index * TILE_H,
               "w": 1, "h": TILE_H, "minW": 1, "minH": 5},
    }


def deep_link(query):
    """PostHog opens a pre-filled ad-hoc insight from the `#q=` URL fragment."""
    frag = urllib.parse.quote(json.dumps(query, separators=(",", ":")), safe="")
    return f"{HOST}/project/{PROJECT}/insights/new#q={frag}"


def resolve_hogql(payload):
    """Return the (description, query-node) pair Routes 2 and 3 should paste.

    Native funnel/retention payloads carry no SQL at `query.source.query`; they keep an
    equivalent HogQL table under `_hogql_variant`, with its own description because the
    two forms compute different things (see the route-divergence note in the runbook).
    Returns None when neither form exists, so the caller can abort before writing.
    """
    if "query" in payload["query"].get("source", {}):
        return payload["description"], payload["query"]
    variant = payload.get("_hogql_variant")
    if variant:
        return variant["description"], variant["query"]
    return None


def resolve_all(payloads):
    """Resolve every payload up front, refusing as a whole rather than part-way.

    Checked before anything is written: a mid-run failure here used to overwrite the
    verified dashboard-templates.json and then die before writing the runbook.
    """
    resolved = [(p, resolve_hogql(p)) for p in payloads]
    missing = [p["_key"] for p, r in resolved if r is None]
    if missing:
        raise SystemExit(
            "refusing to generate: no pasteable HogQL for -- "
            f"{', '.join(missing)}.\n"
            "These are PostHog-native funnel/retention queries with no `_hogql_variant` "
            "fallback, and Routes 2 and 3 cannot express them as SQL. Add a `_hogql_variant` "
            "(description + DataTableNode/HogQLQuery node) to each in insight-payloads.json."
        )
    return [(p, desc, query) for p, (desc, query) in resolved]


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate the zero-scope console build pack from insight-payloads.json.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Default (no flags) regenerates the committed pack, which is deliberately\n"
            "UNFILTERED -- the committed dashboard-templates.json proves it was built\n"
            "against probe data, and default output stays byte-identical (the WIC-1302\n"
            "gate). Pass --exclude-synthetic --out-dir DIR on build day to get a copy\n"
            "with the probe-registry predicate already applied to every tile."
        ),
    )
    parser.add_argument(
        "--exclude-synthetic",
        action="store_true",
        help="apply build_dashboards.py's probe-registry exclusion predicate to every "
             "tile (WIC-1664); requires --out-dir outside docs/analytics/",
    )
    parser.add_argument(
        "--out-dir",
        metavar="DIR",
        help="write the pack here instead of next to this script; required with "
             "--exclude-synthetic",
    )
    args = parser.parse_args(argv)

    out_dir = os.path.abspath(args.out_dir) if args.out_dir else HERE
    # Refuse HERE *and any subdirectory of it* -- `docs/analytics/subdir` is still "inside
    # docs/analytics/", the tree the runbook promises a filtered pack can never land in.
    if args.exclude_synthetic and (out_dir == HERE or out_dir.startswith(HERE + os.sep)):
        parser.error(
            "--exclude-synthetic needs --out-dir pointing outside "
            f"{HERE} (subdirectories of it are refused too).\nA filtered pack embeds the "
            "registry as it stands today, so "
            "committing it would ship a snapshot that goes stale the next time a probe "
            "fires -- the WIC-1389/WIC-1392 transcription bug, one layer down. Generate "
            "it outside the repo, use it, throw it away."
        )
    args.out_dir = out_dir
    return args


def main(argv=None):
    args = parse_args(argv)

    all_payloads = json.load(open(os.path.join(HERE, "insight-payloads.json")))
    # Mirrors build_dashboards.py: `_enabled: false` entries are authored and validated
    # but deliberately not built yet, so all three routes agree on which tiles exist.
    payloads = [p for p in all_payloads if p.get("_enabled", True)]
    resolved = resolve_all(payloads)

    if args.exclude_synthetic:
        # Fatal on any registry problem (synthetic_predicate exits non-zero): a pack that
        # quietly fell back to the raw queries would look exactly like a filtered one and
        # count probes as product usage. Filter the *resolved* node -- the one Routes 2/3
        # actually paste -- so A1/C1 get their `_hogql_variant` filtered, not the native
        # FunnelsQuery/RetentionQuery that no console route imports.
        predicate, _src, _counts = bd.synthetic_predicate()
        filtered = []
        for p, desc, query in resolved:
            query = copy.deepcopy(query)
            bd.apply_exclusion({"_key": p["_key"], "query": query}, predicate)
            filtered.append((p, desc, query))
        resolved = filtered

    templates = []
    for name, description in DASHBOARDS:
        tiles = []
        for i, (p, desc, query) in enumerate(x for x in resolved if x[0]["_dashboard"] == name):
            tiles.append({
                "type": "INSIGHT",
                "name": p["name"],
                "description": desc,
                "query": query,
                "layouts": layouts_for(i),
                "color": None,
            })
        templates.append({
            "template_name": name,
            "dashboard_description": description,
            "dashboard_filters": {},
            "tags": ["wic-1024", "dashboard-spec-v1.0"],
            "tiles": tiles,
            "variables": [],
        })

    lines = []
    w = lines.append
    w("# WIC-1024 — zero-scope console build runbook")
    w("")
    w("**For:** whoever holds the PostHog console for project "
      f"`{PROJECT}` ({HOST}) · **Author:** Data Analyst (01d53393) · **Date:** 2026-08-19")
    w("")
    w("This is the **alternative to granting API scopes**. Every insight below was authored from")
    w("`dashboard-spec.md` v1.0 and executed green against this live project (17/17 — see")
    w("`dashboard-build-pack.md`). Nothing here needs a credential change, a new key, or an agent.")
    w("")
    w("Pick **one** of the three routes.")
    w("")
    w("**All three routes build the same 17 tiles, under the same 17 names**, from the same")
    w("source file (`insight-payloads.json`). Everything below is generated from it.")
    w("")
    w("**Two of those 17 are not the same calculation.** Since #81, Route 1 renders **A1** as a")
    w("native `FunnelsQuery` and **C1** as a native `RetentionQuery` — both person-aggregated.")
    w("Routes 2 and 3 cannot paste a native node as SQL, so they use the HogQL tables kept at")
    w("`_hogql_variant`: A1 as an event-count ratio, C1 as the share of people with >=2 uploads")
    w("in 30d. Same tile names, different numbers — read each tile's description, which differs")
    w("per route for exactly these two. The other **15 tiles are byte-identical across all three**.")
    w("")
    w("(The native `A3n` variant is `_enabled: false` — gated on `resume_upload_started` ever")
    w("firing — so *no* route builds it today. A3 is the HogQL form everywhere.)")
    w("")
    w("---")
    w("")
    w("## Route 1 — grant the scopes, agent builds it (fastest, ~2 min of console time)")
    w("")
    w("Still the cheapest option if you are willing to scope the existing key.")
    w("`Settings → Personal API keys →` the Data Analyst key `→ Scopes`, add:")
    w("")
    w("| Scope | Why |")
    w("|---|---|")
    w("| `insight:read` | read back what was created, for verification |")
    w("| `insight:write` | create the 17 insights |")
    w("| `dashboard:read` | read back the 3 dashboards |")
    w("| `dashboard:write` | create the 3 dashboards and attach tiles |")
    w("")
    w("Then comment on WIC-1024. Acceptance check is one line — "
      "`python3 docs/analytics/build_dashboards.py --dry-run` prints")
    w("`OK  scopes present (read+write)` instead of exiting `2`. The build itself is an idempotent loop.")
    w("")
    w("**Route 1 applies the synthetic exclusion for you** (WIC-1667). The builder derives the")
    w("predicate from `probe-registry.json` on every run and injects it into all "
      f"{len(resolved)} queries")
    w("in memory — including the native funnel and retention tiles, which carry no SQL to edit. You")
    w("do not paste anything, and a probe registered after today is excluded by the next build with")
    w("no code change. It is fail-closed: a tile it cannot filter aborts the build rather than")
    w("shipping unfiltered. Confirm it ran: `--dry-run` prints a `synthetic exclusion derived from`")
    w("line naming the registry it read and the number of filter sites it applied.")
    w("")
    w("**If you are declining Route 1 on security grounds, that is a reasonable call** — a write-scoped")
    w("key is a standing capability. Routes 2 and 3 exist so that decision does not also block the")
    w("deliverable. Say so on WIC-1024 and take Route 2.")
    w("")
    w("## Route 2 — import the dashboard JSON (no scope change, ~5 min)")
    w("")
    w("`dashboard-templates.json` in this directory holds three PostHog dashboard-template objects")
    w("(A, B, C) with all tiles, queries and layouts pre-filled.")
    w("")
    w("1. `Dashboards → New dashboard`.")
    w("2. Choose the **import / paste JSON** option in that modal.")
    w("3. Paste the **first array element** of `dashboard-templates.json` (Dashboard A). Create.")
    w("4. Repeat for elements 2 (Dashboard B) and 3 (Dashboard C).")
    w("")
    w("> **The committed `dashboard-templates.json` carries NO synthetic exclusion, and that is")
    w("> deliberate.** Baking today's registry into an artifact a human imports would ship a snapshot")
    w("> that goes stale the next time a probe fires — the WIC-1389/WIC-1392 transcription bug one")
    w("> layer down, in the file that is hardest to notice — and it would stop the committed pack from")
    w("> proving it was built against probe data. So the committed file counts probe residue as product")
    w("> usage until you filter it.")
    w(">")
    w("> **On build day, regenerate a filtered pack instead of importing the committed one** (WIC-1664):")
    w(">")
    w("> ```bash")
    w("> python3 docs/analytics/make_console_pack.py --exclude-synthetic --out-dir /tmp/console-pack")
    w("> ```")
    w(">")
    w("> Import the three dashboards from `/tmp/console-pack/dashboard-templates.json`, whose every tile")
    w("> already carries the `NOT (...)` predicate derived from `probe-registry.json` at generation")
    w("> time — the same rewriter Route 1 uses (`build_dashboards.py`), so there is nothing to")
    w("> hand-transcribe. The command **refuses to write into `docs/analytics/`**, so a filtered pack")
    w("> can never be committed. See **Before you paste anything** below; it applies to Routes 2 and 3")
    w("> alike.")
    w("")
    w("> **Caveat, stated honestly:** I cannot exercise the console to confirm the exact wording or")
    w("> presence of the JSON-import affordance on your PostHog version — my key is 403 on every")
    w("> dashboard endpoint, which is the whole problem. The JSON conforms to PostHog's dashboard-template")
    w("> schema (`template_name` / `dashboard_description` / `tiles[].query` / `tiles[].layouts`).")
    w("> If your build has no import affordance, Route 3 always works.")
    w("")
    w("## Route 3 — paste each insight by hand (no scope change, always works, ~20 min)")
    w("")
    w("For each row in the table below:")
    w("")
    w("1. `Product analytics → New insight → SQL`.")
    w("2. Replace the default query with the HogQL in the matching section.")
    w("3. `Save`, using the **Insight name** from the table verbatim (names are load-bearing — the")
    w("   spec, the build pack and the alerting thresholds all key on the `A1`/`B3`/`C2` prefixes).")
    w("4. `Add to dashboard →` the dashboard named in the table, creating it on first use with the")
    w("   description from `dashboard-templates.json`.")
    w("")
    w("The **Open pre-filled** link skips steps 1-2 by carrying the query in the URL fragment; if a link")
    w("lands on an empty insight, just paste the SQL from the section below it.")
    w("")
    w("| # | Insight name | Dashboard | Open pre-filled |")
    w("|---|---|---|---|")
    for p, _desc, query in resolved:
        w(f"| {p['_key'].split('_')[0]} | {p['name']} | {p['_dashboard']} | "
          f"[open]({deep_link(query)}) |")
    w("")
    w("---")
    w("")
    # Routes 2 and 3 only. Route 1 does this itself (WIC-1667), which is why the heading no
    # longer claims to gate every route.
    w("## Before you paste anything: exclude synthetic traffic (MANDATORY for Routes 2 and 3)")
    w("")
    w("_Added 2026-08-26 (WIC-1389 / WIC-1392); scoped to Routes 2 and 3 on 2026-08-30 "
      "(WIC-1667),")
    w(f"when Route 1 started doing this itself. The {len(resolved)} queries below were authored "
      "when " + PROJECT + " held")
    w("nothing but probes, so they deliberately carry **no** exclusion — every tile counted the")
    w("synthetic events on purpose, to prove the query ran. **On build day that is no longer what you")
    w("want**, because by definition you are building because organic traffic arrived, and the probes")
    w("are still in there permanently._")
    w("")
    w("Every known synthetic actor is recorded in `docs/analytics/probe-registry.json`. Print the")
    w("current exclusion predicate with:")
    w("")
    w("```bash")
    w("python3 docs/analytics/organic_watch.py --audit     # prints SYNTHETIC_PREDICATE")
    w("```")
    w("")
    w("Then add one line to **every** query below, immediately after its existing `WHERE`:")
    w("")
    w("```sql")
    w("  AND NOT ( <paste SYNTHETIC_PREDICATE here> )")
    w("```")
    w("")
    w("Watch the two queries whose only `FROM events` sits inside a subquery (**C1**'s pasteable")
    w("form and **C3**): the line belongs on the *inner* `WHERE`, next to the `FROM events` it")
    w("filters, not on the outer query — which in both cases has no `WHERE` of its own.")
    w("")
    w("Do not hand-transcribe the actor ids — regenerate them, so the registry stays the single source")
    w("of record. If a probe fires between now and build day, the regenerated predicate covers it and a")
    w("hand-copied one does not.")
    w("")
    w("### Two funnel-reading corrections (from DevOps, WIC-1389)")
    w("")
    w("Both will produce wrong panels if ignored, and neither is visible from the query text:")
    w("")
    w("1. **Never read `resume_upload_failed` as the failure count** (affects **A9**, and any failure")
    w("   rate derived from it). `track()` delivers over `fetch()`, and a `fetch` is a subrequest — so")
    w("   during a subrequest-exhaustion outage (WIC-1386) the failure capture is itself dropped")
    w("   (WIC-1387). A failure panel therefore reads **0 during a total outage**, which is")
    w("   indistinguishable from perfect health, and it is *most* wrong exactly when you need it most.")
    w("   Derive failures from `resume_upload_submitted` with **no matching terminal event** in the")
    w("   session, and treat A9 as a breakdown of the failures you already know about, not a count.")
    w("")
    w("2. **The lifetime funnel is entirely synthetic, and it is not even a well-formed funnel.**")
    w("   WIC-996 emitted all three upload legs 0.3 s apart including `completed` *and* `failed` for one")
    w("   session — impossible for a real upload. The separate WIC-967 end-to-end probe left a dangling")
    w("   `submitted` with no terminal leg (its `failed` was the one dropped by WIC-1387 above). So of")
    w("   the 6 lifetime events, both terminal events and both `submitted` are probes. Any funnel")
    w("   conversion you compute today is an artefact. Exclude first, then read.")
    w("")
    w("---")
    w("")
    w("## The 17 queries")
    w("")
    for p, desc, query in resolved:
        w(f"### {p['name']}")
        w("")
        w(f"*{p['_dashboard']} · {desc}*")
        w("")
        w("```sql")
        w(query["source"]["query"].strip())
        w("```")
        w("")

    w("---")
    w("")
    w("## What these dashboards will show on day one")
    w("")
    w("**Mostly zeros, and that is correct.** PostHog project "
      f"`{PROJECT}` holds **6 lifetime events, all")
    w("synthetic** (3 from the WIC-996 server smoke test, 2 QA probes, and — since 2026-08-26 — 1 from the")
    w("WIC-967 end-to-end probe). Zero organic traffic has ever reached it. All 6 are itemised in")
    w("`docs/analytics/probe-registry.json`; apply the exclusion and every tile reads **0**, which is")
    w("the honest day-one picture. The counts described in the next paragraph are what you see *without*")
    w("the exclusion, i.e. probe residue — so they are what Routes 2 and 3 show until you paste the")
    w("predicate in, and what Route 1 never shows at all.")
    w("")
    w("Only 3 of the 9 taxonomy events have ever fired; the 6 client-side ones never have, because the")
    w("app has been unreachable (WIC-1004 SPA deep-link 404, WIC-1011 plaintext HTTP), not because the")
    w("client transport is broken — WIC-1012 proved the client capture leg round-trips.")
    w("")
    w("So on build day: **A1, A4-A9, B5, C2, C3 render real (synthetic) numbers; A2, A3, B1-B4, C1**")
    w("**render empty.** Empty is the honest state, not a build defect. Do not treat it as a regression,")
    w("and do not re-file the missing `$pageview` — there is no autocapture by design (hand-rolled")
    w("`/capture` wrapper, and `dashboard-spec.md` has zero pageview/UTM/referrer dependencies).")
    w("")
    w("Re-check **C1-C3** once real multi-session traffic exists — they key on `person_id` and the")
    w("identity graph (WIC-822 server attribution + WIC-825 client `identify()` alias) is correct in")
    w("principle but unproven against organic users.")
    w("")
    w('**"Empty now, fills in later" is not true of every empty tile.** Before reading any zero as a')
    w("traffic reading, check the event's class in **`docs/analytics/event-reachability-matrix.md`**,")
    w("which classifies all 9 taxonomy events by whether their call site can execute at all. Three")
    w("classes, three different meanings for the same `0`:")
    w("")
    w("- **outage-immune** (`resume_upload_started`, `resume_upload_validation_failed`) — fire from the")
    w("  browser straight to PostHog with no Worker in the path. A zero here really is a demand reading.")
    w("- **outage-blocked** (`resume_upload_cta_clicked`, `resume_manager_viewed`,")
    w("  `resume_exports_link_clicked`, `resume_upload_submitted`/`_completed`/`_failed`) — gated behind")
    w("  a DB-backed fetch that currently 500s. A zero here restates the outage and says nothing about")
    w("  demand. These fill in only after prod recovers, **not** merely when traffic arrives.")
    w("- **unreachable** (`export_viewed`) — dead code, so **B1 never fills in at any traffic level**")
    w("  until WIC-1707 lands. B1's zero is structural; no amount of traffic moves it.")
    w("")
    w("The trap in that list is `resume_manager_viewed`: it reads like a plain page-view event, but its")
    w("effect guard is `!isLoading && !error`, so a failed resume-list fetch suppresses it. Classify by")
    w("call site, not by event name.")
    w("")

    # Both artifacts are fully built before either is written, so a failure above can
    # never leave a half-regenerated pack on disk.
    os.makedirs(args.out_dir, exist_ok=True)
    out_json = os.path.join(args.out_dir, "dashboard-templates.json")
    with open(out_json, "w") as fh:
        json.dump(templates, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    out_md = os.path.join(args.out_dir, "console-build-runbook.md")
    with open(out_md, "w") as fh:
        fh.write("\n".join(lines))

    for name, _ in DASHBOARDS:
        n = sum(1 for t in templates if t["template_name"] == name for _ in t["tiles"])
        print(f"  {name}: {n} tiles")
    print(f"wrote {out_json}")
    print(f"wrote {out_md}")
    if args.exclude_synthetic:
        # No Prettier note: a filtered pack is a throwaway for one console session, not a
        # committed file, so there is nothing for a format check to diff.
        print("\nSynthetic traffic is already excluded in both files above. This pack is a "
              "throwaway\nfor one console session — do not commit it; it embeds the registry "
              "as of today.")
        return
    # Both artifacts are Prettier-formatted in the repo, and this script does not emit
    # Prettier's exact style (short-array collapsing, md table padding). Without this the
    # regenerated pack diffs cosmetically against the committed one and CI format-checks fail.
    print("\nnow run: npx prettier --write docs/analytics/dashboard-templates.json "
          "docs/analytics/console-build-runbook.md")


if __name__ == "__main__":
    main()

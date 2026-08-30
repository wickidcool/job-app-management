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
import json
import os
import sys
import textwrap
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))

sys.path.insert(0, HERE)

import synthetic_exclusion as sx  # noqa: E402  (path shim above must run first)

PROJECT = "551963"
HOST = "https://us.posthog.com"

# Second input, alongside insight-payloads.json. WIC-1389/WIC-1392 added a mandatory
# synthetic-exclusion step to the runbook by hand, which broke the "regenerating the pack
# reproduces the committed files" invariant #109 exists to hold -- the next regeneration
# would have silently deleted the safety section. Everything those commits added now lives
# here, and every probe fact in it is derived from the registry rather than transcribed.
REGISTRY = "probe-registry.json"

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


def synthetic_count(reg):
    """How many events the registry itemises -- i.e. the synthetic total.

    This, not `lifetime_event_count_at_verification`, is the number every "synthetic"
    slot in the prose means. The two are equal only while `organic` is 0.
    """
    return sum(len(p["event_uuids"]) for p in reg["probes"])


def load_registry():
    """Load probe-registry.json and check it still accounts for every lifetime event.

    The runbook's day-one section tells a human that excluding the registry leaves only
    organic traffic. That claim is only true while the registry covers every event that
    is not organic, so it is asserted here rather than assumed: if a probe is added
    without its `event_uuids`, or `lifetime_event_count_at_verification` is bumped
    without either a matching probe entry or a matching `organic_...` bump, the generator
    refuses instead of shipping a false promise.

    Note what is deliberately *not* fatal: organic traffic arriving. That is the day this
    project exists to see, and it must not turn the build red -- it changes what the prose
    should say, not whether it can be generated. See `day_one_paragraph()`.
    """
    path = os.path.join(HERE, REGISTRY)
    try:
        with open(path, encoding="utf-8") as fh:
            reg = json.load(fh)
    except FileNotFoundError:
        raise SystemExit(
            f"refusing to generate: {REGISTRY} not found at {path}.\n"
            "The runbook's mandatory synthetic-exclusion section is derived from it; "
            "generating without it would silently ship a pack that tells a human to "
            "exclude a list that does not exist."
        )
    lifetime = reg["lifetime_event_count_at_verification"]
    organic = reg["organic_event_count_at_verification"]
    accounted = synthetic_count(reg)
    if accounted + organic != lifetime:
        raise SystemExit(
            f"refusing to generate: {REGISTRY} does not account for the project.\n"
            f"  lifetime_event_count_at_verification = {lifetime}\n"
            f"  organic_event_count_at_verification  = {organic}\n"
            f"  event_uuids across {len(reg['probes'])} probes = {accounted}\n"
            "Re-run `python3 docs/analytics/organic_watch.py --audit` and reconcile the "
            "registry before regenerating the pack."
        )
    return reg


def probe_breakdown(reg):
    """`WIC-889 x1, WIC-996 x3, ...` -- the registry's composition, not a transcription."""
    parts = []
    for p in reg["probes"]:
        label = p["ticket"] or f"unticketed {p['when'][:10]} probe"
        parts.append(f"{label} ×{len(p['event_uuids'])}")
    return ", ".join(parts)


TERMINAL_EVENTS = ("resume_upload_completed", "resume_upload_failed")


def synthetic_event_counts(reg):
    """{event_name: n} across every probe, or None when names cannot be attributed.

    `events` and `event_uuids` are separate lists with no declared correspondence, so a
    probe that fired one event name twice would carry one name and two uuids and counting
    names would undercount it. Only claim a per-name count when every probe's two lists
    line up 1:1; otherwise say nothing numeric.
    """
    counts = {}
    for p in reg["probes"]:
        if len(p["events"]) != len(p["event_uuids"]):
            return None
        for name in p["events"]:
            counts[name] = counts.get(name, 0) + 1
    return counts


def funnel_clause(reg, synthetic, organic):
    """Closing sentence of funnel correction 2.

    Both the count *and* the nouns here are data: the sentence used to hardcode "both
    terminal events and both `submitted`" next to an interpolated lifetime total, which
    made it wrong on two axes at once as soon as organic traffic landed. Derive both, and
    scope the claim to the synthetic set rather than to the project.
    """
    counts = synthetic_event_counts(reg)
    if counts is None:
        legs = "all the terminal events and `submitted` legs the registry itemises"
    else:
        n_sub = counts.get("resume_upload_submitted", 0)
        n_term = sum(counts.get(e, 0) for e in TERMINAL_EVENTS)
        legs = f"{n_term} terminal events and {n_sub} `resume_upload_submitted` events"
    if organic:
        return (f"So {legs} are probes rather than users, mixed in with {organic} organic "
                "events. Any funnel conversion you compute without excluding them is "
                "contaminated. Exclude first, then read.")
    return (f"So of the {synthetic} lifetime events, {legs} are probes. Any funnel "
            "conversion you compute today is an artefact. Exclude first, then read.")


def day_one_paragraph(reg, lifetime, synthetic, organic):
    """The "what will these show" lead, which asserts a *state of the world*, not a count.

    The bug this branch exists to prevent: substituting `lifetime` into slots that mean
    "synthetic" reads correctly only while `organic == 0`. With 40 lifetime / 6 synthetic
    it emitted "40 lifetime events, all synthetic", "Zero organic traffic has ever reached
    it", "All 40 are itemised" and "every tile reads 0" -- six false statements next to a
    breakdown that visibly sums to 6, on the one day anybody reads this page.
    """
    if organic:
        return (f"**Real numbers now — but only once you exclude the probes.** PostHog "
                f"project `{PROJECT}` holds **{lifetime} lifetime events, {synthetic} of "
                f"them synthetic** ({probe_breakdown(reg)}) and **{organic} organic** — "
                f"last verified {reg['last_verified']} by {reg['last_verified_by']}. Only "
                f"the {synthetic} synthetic ones are itemised in "
                f"`docs/analytics/{REGISTRY}`; apply the exclusion above and every tile "
                "reads organic traffic only. Skip it and every tile reads those "
                f"{synthetic} probes as product usage.")
    return (f"**Mostly zeros, and that is correct.** PostHog project `{PROJECT}` holds "
            f"**{synthetic} lifetime events, all synthetic** ({probe_breakdown(reg)}). "
            f"Zero organic traffic has ever reached it — last verified "
            f"{reg['last_verified']} by {reg['last_verified_by']}. All {synthetic} are "
            f"itemised in `docs/analytics/{REGISTRY}`; apply the exclusion above and "
            "every tile reads **0**, which is the honest day-one picture. The counts "
            "described in the next paragraph are what you see _without_ the exclusion, "
            "i.e. probe residue.")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate the zero-scope console build pack from insight-payloads.json.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Default (no flags) regenerates the committed pack, which is deliberately\n"
            "UNFILTERED and is what CI diffs. Pass --exclude-synthetic --out-dir DIR on\n"
            "build day to get a copy with the probe-registry predicate already applied."
        ),
    )
    parser.add_argument(
        "--exclude-synthetic",
        action="store_true",
        help="apply the probe-registry.json exclusion predicate to every query (WIC-1664)",
    )
    parser.add_argument(
        "--out-dir",
        metavar="DIR",
        help="write the pack here instead of next to this script; required with "
             "--exclude-synthetic",
    )
    args = parser.parse_args(argv)

    out_dir = os.path.abspath(args.out_dir) if args.out_dir else HERE
    if args.exclude_synthetic and out_dir == HERE:
        parser.error(
            "--exclude-synthetic needs --out-dir pointing somewhere other than "
            f"{HERE}.\nA filtered pack embeds the registry as it stands today, so "
            "committing it would ship a snapshot that goes stale the next time a probe "
            "fires -- the WIC-1389/WIC-1392 transcription bug, one layer down. Generate "
            "it outside the repo, use it, throw it away."
        )
    args.out_dir = out_dir
    return args


def main(argv=None):
    args = parse_args(argv)

    with open(os.path.join(HERE, "insight-payloads.json"), encoding="utf-8") as fh:
        all_payloads = json.load(fh)
    # Mirrors build_dashboards.py: `_enabled: false` entries are authored and validated
    # but deliberately not built yet, so all three routes agree on which tiles exist.
    payloads = [p for p in all_payloads if p.get("_enabled", True)]
    if args.exclude_synthetic:
        # Fatal on failure: a pack that quietly fell back to the raw payloads would look
        # exactly like a filtered one and would count probes as product usage.
        try:
            predicate, registry_path, problems = sx.load_predicate()
            payloads = [sx.filtered_payload(p, predicate) for p in payloads]
        except sx.ExclusionError as exc:
            raise SystemExit(f"refusing to generate: synthetic exclusion failed -- {exc}")
        for problem in problems:
            print(f"WARN  {problem}")
        print(f"applying synthetic exclusion from {os.path.relpath(registry_path)}")
    resolved = resolve_all(payloads)
    reg = load_registry()
    lifetime = reg["lifetime_event_count_at_verification"]
    organic = reg["organic_event_count_at_verification"]
    # Never interpolate `lifetime` into a slot that means "synthetic": load_registry()
    # guarantees synthetic + organic == lifetime, so the two are the same number only
    # until the first real user arrives.
    synthetic = synthetic_count(reg)

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
    w("firing — so _no_ route builds it today. A3 is the HogQL form everywhere.)")
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
    if args.exclude_synthetic:
        w("## Synthetic traffic is already excluded from this pack")
        w("")
        w(f"_Generated with `--exclude-synthetic` from `docs/analytics/{REGISTRY}` as it stood at")
        w(f"{reg['last_verified']}. Every query below — and every tile in the")
        w("`dashboard-templates.json` beside it — already carries the `NOT (...)` predicate. Paste")
        w("them exactly as they are; adding the predicate again is harmless but means you are")
        w("hand-transcribing actor ids, which is the thing this pack exists to avoid._")
        w("")
        w("**This pack is disposable.** It embeds the registry as of the moment it was generated, so")
        w("it is correct for one console session and stale the next time a probe fires. Do not commit")
        w("it, and regenerate rather than reuse.")
        w("")
    else:
        w("## Before you paste anything: exclude synthetic traffic (MANDATORY)")
        w("")
        w("_Added 2026-08-26 (WIC-1389 / WIC-1392). The 17 queries below were authored when "
          f"{PROJECT} held")
        w("nothing but probes, so they deliberately carry **no** exclusion — every tile counted the")
        w("synthetic events on purpose, to prove the query ran. **On build day that is no longer what you")
        w("want**, because by definition you are building because organic traffic arrived, and the probes")
        w("are still in there permanently._")
        w("")
        w(f"Every known synthetic actor is recorded in `docs/analytics/{REGISTRY}`, and since WIC-1664")
        w("the predicate is derived from it at **build time** rather than pasted in by hand.")
        w("")
        w("**Route 1 needs nothing from you.** `build_dashboards.py` reads the registry and filters")
        w("every payload before it writes, so an API build excludes probe traffic by default")
        w("(`--no-exclude-synthetic` opts out). `--dry-run` executes the filtered queries, so what it")
        w("proves green is what gets created.")
        w("")
        w("**For Routes 2 and 3, regenerate this pack with the predicate already applied.** One")
        w("command, and both `dashboard-templates.json` and all 17 queries below come out filtered:")
        w("")
        w("```bash")
        w("python3 docs/analytics/make_console_pack.py --exclude-synthetic --out-dir /tmp/console-pack")
        w("```")
        w("")
        w("Then import or paste from `/tmp/console-pack/` rather than from this directory. The output")
        w("is deliberately written outside the repo — it is a snapshot of the registry, correct for one")
        w("console session, and committing it would reintroduce exactly the staleness this replaced.")
        w("")
        w("**Fallback, if you cannot run Python.** Print the current predicate:")
        w("")
        w("```bash")
        w("python3 docs/analytics/organic_watch.py --audit     # prints SYNTHETIC_PREDICATE")
        w("```")
        w("")
        w("and add one line to **every** query below, immediately after its existing `WHERE`:")
        w("")
        w("```sql")
        w("  AND NOT ( <paste SYNTHETIC_PREDICATE here> )")
        w("```")
        w("")
        w("Watch the two tiles that read `events` only inside a subquery (**C1**, **C3**) — the line")
        w("belongs on the inner `WHERE`, not the outer one. This is precisely the transcription step")
        w("the generator removes; use it if you can.")
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
    w("   indistinguishable from perfect health, and it is _most_ wrong exactly when you need it most.")
    w("   Derive failures from `resume_upload_submitted` with **no matching terminal event** in the")
    w("   session, and treat A9 as a breakdown of the failures you already know about, not a count.")
    w("")
    if organic:
        w("2. **The synthetic funnel legs are still in there, and they are not a well-formed funnel.**")
    else:
        w("2. **The lifetime funnel is entirely synthetic, and it is not even a well-formed funnel.**")
    w("   WIC-996 emitted all three upload legs 0.3 s apart including `completed` _and_ `failed` for one")
    w("   session — impossible for a real upload. The separate WIC-967 end-to-end probe left a dangling")
    w("   `submitted` with no terminal leg (its `failed` was the one dropped by WIC-1387 above).")
    # Registry-derived, so its length moves with the data: wrapped rather than hand-broken.
    for line in textwrap.wrap(
        funnel_clause(reg, synthetic, organic),
        width=98, initial_indent="   ", subsequent_indent="   ",
        break_long_words=False, break_on_hyphens=False,
    ):
        w(line)
    w("")
    w("---")
    w("")
    w("## The 17 queries")
    w("")
    for p, desc, query in resolved:
        w(f"### {p['name']}")
        w("")
        w(f"_{p['_dashboard']} · {desc}_")
        w("")
        w("```sql")
        w(query["source"]["query"].strip())
        w("```")
        w("")

    w("---")
    w("")
    w("## What these dashboards will show on day one")
    w("")
    # Wrapped here rather than as fixed `w()` lines: the breakdown is registry-derived, so its
    # length changes with the data and hand-placed line breaks would drift past printWidth.
    for line in textwrap.wrap(
        day_one_paragraph(reg, lifetime, synthetic, organic),
        width=98, break_long_words=False, break_on_hyphens=False,
    ):
        w(line)
    w("")
    # The tile-by-tile prediction below is a measurement of a zero-organic project, not a
    # property of the dashboards. It stops being true the moment a real session lands, so it
    # is withdrawn rather than restated once the registry records organic traffic.
    if organic:
        w("**The per-tile prediction that used to sit here has been withdrawn.** It enumerated which")
        w("panels render empty, and it was only ever a measurement of a project holding nothing but")
        w("probes. Organic traffic has since arrived, so re-measure rather than trusting a forecast")
        w("written before there were any users. What still holds: there is no autocapture by design")
        w("(hand-rolled `/capture` wrapper), so a missing `$pageview` is not a defect and should not be")
        w("re-filed — `dashboard-spec.md` has zero pageview/UTM/referrer dependencies.")
        w("")
    else:
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

    # Both artifacts are fully built before either is written, so a failure above can
    # never leave a half-regenerated pack on disk.
    os.makedirs(args.out_dir, exist_ok=True)
    out_json = os.path.join(args.out_dir, "dashboard-templates.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(templates, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    out_md = os.path.join(args.out_dir, "console-build-runbook.md")
    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    for name, _ in DASHBOARDS:
        n = sum(1 for t in templates if t["template_name"] == name for _ in t["tiles"])
        print(f"  {name}: {n} tiles")
    print(f"wrote {out_json}")
    print(f"wrote {out_md}")
    if args.exclude_synthetic:
        # No Prettier note here: a filtered pack is a throwaway artifact for one console
        # session, not a committed file, so there is nothing for a format check to diff.
        print("\nSynthetic traffic is already excluded in both files above. Do not commit "
              "them —\nthey embed the registry as of today.")
        return
    # Both artifacts are Prettier-formatted in the repo, and this script does not emit
    # Prettier's exact style (short-array collapsing, md table padding). Without this the
    # regenerated pack diffs cosmetically against the committed one and CI format-checks fail.
    print("\nnow run: npx prettier --write docs/analytics/dashboard-templates.json "
          "docs/analytics/console-build-runbook.md")


if __name__ == "__main__":
    main()

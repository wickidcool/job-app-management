#!/usr/bin/env python3
"""Report-only inventory of title-case vs sentence-case UI strings in packages/web/src.

WHAT THIS IS FOR (WIC-2112, carrying WIC-2096)
==============================================
`docs/design/CONTENT_STYLE.md` proposes sentence case for every UI string. **That
proposal has never been ratified** — see its "Adoption status" section — and the board
decision is live on WIC-1066. This script exists so that whichever way that ruling goes,
nobody re-derives the numbers a third time by hand:

  * board **ratifies**  -> this is the work-list, staged into child issues by area;
  * board **withdraws** -> the same run names the sentence-case strings to invert.

⛔ **This script never fails a build, and must not be given an enforcing exit code while
the rule it would enforce is unadopted.** It always exits 0 (except on a usage error). It
is deliberately NOT wired into `deploy.yml` or `docs-audit.yml`. If WIC-1066 ratifies the
standard, adding an enforcing mode is a follow-up decision, not a drive-by.

WHY THIS IS A SIBLING OF wireframe-casing-audit.py AND NOT A MODE INSIDE IT
==========================================================================
The CEM's dispatch predicted `wireframe-casing-audit.py` was the right host and asked for
that prediction to be falsified cheaply. It is falsified. That script reads *markdown*
fenced blocks in `COMPONENT_SPECS.md`, strips box-drawing glyphs, and answers a positional
question about ALL-CAPS row labels. This one reads *TypeScript/TSX*, strips comments, and
answers a per-word question about title vs sentence case. They share no scope, no input
format, no parser and no verdict. Worse, that script is the enforcing gate at
`deploy.yml:81` — bolting a second, non-enforcing mode onto a build gate means a flag that
changes exit semantics in a script CI depends on. Two files, one job each.

Note also that the two rules are not the same rule and are in *opposite* states of
adoption: the ALL-CAPS clause IS in force (WIC-1209, via `local/no-literal-caps-jsx-text`
plus that audit script), while the sentence-case clause is not. All-caps strings are
therefore reported here in their own bucket and are excluded from the title/sentence
tally — they are somebody else's settled business.

SCOPE
=====
`packages/web/src`, tracked `.ts`/`.tsx`, excluding `*.test.ts(x)` and anything under a
`test/` directory. Multi-word strings only (>= 2 words), matching how WIC-2096 counted.

EXTRACTION — THREE CHANNELS, AND WHAT EACH CANNOT SEE
=====================================================
There is no TypeScript parser here on purpose: the whole `docs/design/*.py` family is
zero-dependency `python3` so it runs identically in CI and on a clone with no
`node_modules`. The cost is that extraction is a **floor, not a proof** — the same caveat
`wireframe-casing-audit.py` states about itself.

  channel `jsx`     JSX text nodes: `>Some Text<`. High precision. Blind to text broken
                    across `{' '}` joins or split by inline elements.
  channel `prop`    String literals under an allowlist of label-bearing props and object
                    keys (`label`, `placeholder`, `aria-label`, `title`, ...).
  channel `literal` Any other capitalized multi-word string literal. Lower precision, but
                    it carries the RECALL: without it the inventory misses labels in JSX
                    expression containers (`{p ? 'Analyzing...' : 'Analyze Fit →'}`) and
                    labels in `.copy.ts` objects under keys no allowlist would guess
                    (`primaryAction: 'Back to dashboard'`). Both shapes are real shipped
                    strings and neither is reachable by widening the allowlist. SVG path
                    data and `console.*` arguments are filtered out.

All channels run over source with comments removed by a real string-aware scanner, which
is the single most important step. Raw `git grep -F` over these files is badly wrong: the
JSDoc block at `pages/JobFitAnalysis.tsx:22` alone discusses `Job Fit Analysis` in prose
several times, and a naive count reads every one of those as a shipped UI string. The CEM's
hand counts and WIC-2096's disagreed on exactly this axis; `--counterexamples` re-measures
CONTENT_STYLE.md's own five pairs with comments stripped, which is the arbitration.

Template literals containing `${}` are counted as `dynamic` and reported separately rather
than guessed at.

BUCKETS — WHY A FLAT COUNT WOULD MISLEAD A MIGRATION
====================================================
"One rule is not one shape" applies to the strings exactly as it does to the docs that
cite the rule. Three shapes are NOT migration work under *either* board outcome, so they
are split out of the headline tally rather than left to be discovered one PR at a time:

  `chrome`   buttons, headings, labels, messages — the strings the rule is about
  `sample`   `e.g.`-placeholders, hardcoded `<option>` records, `mock*` fixture data —
             user data standing in for records, not chrome
  `derived`  `constants/title.ts`, the §5 route-title mirror table. Each entry is its
             route's `<h1>` verbatim, and `route-title-table-audit.py` ENFORCES that in
             `deploy.yml`. Migrating these on their own turns the build red.

CLASSIFIER
==========
Sentence case = first character capitalized, nothing else that ordinary prose would not
capitalize. A word after the first marks the string TITLE case unless it is exempt:
proper noun / brand (CONTENT_STYLE.md Exception 1), an acronym, follows a sentence
boundary (`.`/`!`/`?`/`:`), or is not alphabetic. Exemptions are listed under `--legend`
so a disputed call is auditable rather than buried.

USAGE
=====
  python3 docs/design/ui-string-casing-inventory.py                 # summary + per-area
  python3 docs/design/ui-string-casing-inventory.py --strings       # every string, file:line
  python3 docs/design/ui-string-casing-inventory.py --strings --case sentence
  python3 docs/design/ui-string-casing-inventory.py --area pages
  python3 docs/design/ui-string-casing-inventory.py --counterexamples
  python3 docs/design/ui-string-casing-inventory.py --json
  python3 docs/design/ui-string-casing-inventory.py --selftest
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

ROOT_DEFAULT = "packages/web/src"

# --------------------------------------------------------------------------- #
# Classifier vocabulary
# --------------------------------------------------------------------------- #

# Proper nouns and brands. CONTENT_STYLE.md Exception 1: "written as their owner writes
# them". `Careerpin` is the product name, ruled under WIC-1102.
PROPER_NOUNS = {
    "careerpin",
    "careerpin's",
    "google",
    "linkedin",
    "cloudflare",
    "supabase",
    "github",
    "anthropic",
    "claude",
    "workday",
    "greenhouse",
    "lever",
    "indeed",
    "glassdoor",
}

# Acronyms and initialisms that carry caps regardless of position. Anything matching
# ALL_CAPS_WORD below is also exempt; this set covers the mixed-case stragglers.
ACRONYMS = {
    "ai",
    "api",
    "ats",
    "csv",
    "docx",
    "id",
    "json",
    "ok",
    "pdf",
    "r2",
    "star",
    "url",
    "uk",
    "us",
}

# Weekday/month names capitalize in ordinary prose.
CALENDAR = {
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
}

ALL_CAPS_WORD = re.compile(r"^[A-Z0-9][A-Z0-9&'\-\.]*$")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")

# Ornaments and arrows that decorate a label without being part of it.
ORNAMENT_CHARS = "→←⇒…·•✓✗★☆●○+*"

SENTENCE_BOUNDARY = ".!?:"

# --------------------------------------------------------------------------- #
# Props / object keys whose string value is a rendered label
# --------------------------------------------------------------------------- #

LABEL_KEYS = {
    "aria-label",
    "arialabel",
    "alt",
    "blurb",
    "buttontext",
    "caption",
    "cta",
    "ctalabel",
    "confirmlabel",
    "cancellabel",
    "emptymessage",
    "emptytitle",
    "errormessage",
    "heading",
    "helptext",
    "label",
    "legend",
    "message",
    "placeholder",
    "srlabel",
    "submitlabel",
    "subtitle",
    "title",
    "tooltip",
}

# --------------------------------------------------------------------------- #
# Comment-stripping scanner
# --------------------------------------------------------------------------- #

# A `/` opens a regex literal (rather than being division) when the previous
# significant character is one of these.
REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>\n")


def strip_comments(src):
    """Blank out comments, preserving every byte offset and line number.

    Returns (masked_source, string_literals) where string_literals is a list of
    (start_offset, quote_char, raw_body) for every string / template literal found
    outside a comment.
    """
    out = list(src)
    literals = []
    i, n = 0, len(src)
    prev_sig = "\n"

    def blank(a, b):
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j == -1 else j
            blank(i, j)
            i = j
            continue

        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            blank(i, j)
            i = j
            continue

        if c in "'\"":
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == c or src[j] == "\n":
                    break
                j += 1
            literals.append((i, c, src[i + 1 : j]))
            prev_sig = c
            i = j + 1
            continue

        if c == "`":
            j, depth = i + 1, 0
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "$" and j + 1 < n and src[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                if depth and src[j] == "}":
                    depth -= 1
                    j += 1
                    continue
                if src[j] == "`" and not depth:
                    break
                j += 1
            literals.append((i, "`", src[i + 1 : j]))
            prev_sig = "`"
            i = j + 1
            continue

        if c == "/" and prev_sig in REGEX_PRECEDERS:
            # Regex literal. Skip it so a `//` inside one is not read as a comment.
            j, in_class = i + 1, False
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                elif src[j] == "/" and not in_class:
                    break
                elif src[j] == "\n":
                    j = i  # not a regex after all; fall through as division
                    break
                j += 1
            if j > i:
                i = j + 1
                prev_sig = "/"
                continue

        if not c.isspace():
            prev_sig = c
        elif c == "\n":
            prev_sig = "\n"
        i += 1

    return "".join(out), literals


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #


def clean_label(s):
    """Strip ornaments, entities and surrounding whitespace from a candidate label."""
    s = s.replace("&nbsp;", " ").replace("&amp;", "&")
    s = re.sub(r"&[a-zA-Z]+;", " ", s)
    s = s.strip()
    s = s.strip(ORNAMENT_CHARS + " \t")
    return re.sub(r"\s+", " ", s).strip()


def word_positions(s):
    """Yield (word, preceding_significant_char) for each alphabetic word."""
    for m in WORD_RE.finditer(s):
        k = m.start() - 1
        while k >= 0 and s[k] in " \t\n’'\"(—–-":
            k -= 1
        yield m.group(0), (s[k] if k >= 0 else "")


def classify(s):
    """Return (verdict, offending_words).

    verdict is one of: 'title', 'sentence', 'caps', 'skip'.
    """
    label = clean_label(s)
    words = [w for w, _ in word_positions(label)]
    if len(words) < 2:
        return "skip", []

    # A fully upper-case string is governed by the ALL-CAPS clause (WIC-1209), which is
    # already in force and enforced elsewhere. Not this inventory's business.
    if all(ALL_CAPS_WORD.match(w) and len(w) > 1 for w in words):
        return "caps", []

    if not label[:1].isalpha():
        # Leading digit / symbol: first "word" is not in first position, so the
        # first-word exemption cannot be applied honestly.
        return "skip", []

    offenders = []
    first = True
    for w, prev in word_positions(label):
        if first:
            first = False
            continue
        low = w.lower().rstrip("'’s").rstrip("'’")
        if not w[:1].isupper():
            continue
        if prev in SENTENCE_BOUNDARY:
            continue
        if ALL_CAPS_WORD.match(w) and len(w) > 1:
            continue
        if len(w) == 1:
            continue
        if low in PROPER_NOUNS or w.lower() in PROPER_NOUNS:
            continue
        if low in ACRONYMS or w.lower() in ACRONYMS:
            continue
        if low in CALENDAR or w.lower() in CALENDAR:
            continue
        offenders.append(w)

    return ("title" if offenders else "sentence"), offenders


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #

# JSX text node: between `>` and `<`, containing at least one letter, and free of the
# characters that would mean we are looking at code rather than rendered text.
JSX_TEXT_RE = re.compile(r">([^<>{}=;]*[A-Za-z][^<>{}=;]*)<")

# `label="..."` / `label={'...'}` / `label: '...'`
PROP_RE = re.compile(
    r"""(?P<key>[A-Za-z][A-Za-z0-9_-]*)\s*(?::|=)\s*\{?\s*(?P<q>['"])(?P<val>(?:\\.|(?!(?P=q))[^\\])*)(?P=q)"""
)


# A placeholder that opens with `e.g.` / `ex.` is showing the user what to *type*. Its
# capitalization is modelling user data, not chrome, so it is not migration work.
SAMPLE_PREFIX_RE = re.compile(r"(?i)^\s*(e\.?\s?g\.?|ex\.|for example)\b")

TAG_NAME_RE = re.compile(r"<\s*([A-Za-z][A-Za-z0-9._-]*)")


def enclosing_tag(masked, gt_offset):
    """Name of the element whose opening `>` sits at gt_offset, or '' if unclear."""
    start = masked.rfind("<", max(0, gt_offset - 600), gt_offset)
    if start == -1:
        return ""
    m = TAG_NAME_RE.match(masked, start)
    return m.group(1).lower() if m else ""


# SVG `d` attributes read as capitalized multi-word strings (`M9 5l7 7-7 7`). Path
# commands may recur anywhere in the run, so the charset has to allow them throughout;
# requiring a digit as well is what keeps prose like `Class Act` out.
SVG_PATH_RE = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz][MmLlHhVvCcSsQqTtAaZz0-9\s.,\-]*$")

CONSOLE_RE = re.compile(r"console\.(log|warn|error|info|debug|trace)\s*\(\s*$")


def is_svg_path(s):
    s = s.strip()
    return bool(SVG_PATH_RE.match(s)) and any(ch.isdigit() for ch in s)


def is_console_arg(masked, off):
    """True when this literal is the first argument to a console.* call."""
    return bool(CONSOLE_RE.search(masked[max(0, off - 40) : off]))


def line_of(src, offset):
    return src.count("\n", 0, offset) + 1


def looks_like_code(s):
    """Reject tailwind class strings, URLs, paths, keys — things that never render."""
    if not s.strip():
        return True
    if re.search(r"https?://|^/|^\./|^\.\./", s.strip()):
        return True
    # Tailwind-ish: several hyphenated lowercase tokens.
    toks = s.split()
    if len(toks) >= 2 and sum(1 for t in toks if re.fullmatch(r"[a-z0-9:\[\]/\.-]+", t)) == len(toks):
        if sum(1 for t in toks if "-" in t or ":" in t) >= max(1, len(toks) // 2):
            return True
    if re.fullmatch(r"[a-z0-9_.\-]+(\s+[a-z0-9_.\-]+)*", s.strip()) and "-" in s:
        return True
    return False


def extract(path, src):
    """Yield dicts for every candidate UI string in one file."""
    masked, literals = strip_comments(src)
    seen = set()

    for m in JSX_TEXT_RE.finditer(masked):
        raw = m.group(1)
        if looks_like_code(raw):
            continue
        label = clean_label(raw)
        if not label:
            continue
        channel = "jsx-option" if enclosing_tag(masked, m.start()) == "option" else "jsx"
        key = (channel, label, line_of(src, m.start(1)))
        if key in seen:
            continue
        seen.add(key)
        yield {
            "file": path,
            "line": line_of(src, m.start(1)),
            "channel": channel,
            "key": None,
            "string": label,
        }

    for m in PROP_RE.finditer(masked):
        key = m.group("key").lower()
        if key not in LABEL_KEYS:
            continue
        raw = m.group("val")
        if looks_like_code(raw):
            continue
        label = clean_label(raw)
        if not label:
            continue
        sig = ("prop", label, line_of(src, m.start("val")))
        if sig in seen:
            continue
        seen.add(sig)
        yield {
            "file": path,
            "line": line_of(src, m.start("val")),
            "channel": "prop",
            "key": m.group("key"),
            "string": label,
        }

    # Channel 3: bare string literals. Lower precision than the two above, so reported
    # under its own channel — but it is the channel with the *recall*, and without it the
    # inventory silently misses two whole shapes of real UI string:
    #   * a label in a JSX expression container, e.g.
    #     `{isPending ? 'Analyzing...' : 'Analyze Fit →'}` (JobFitAnalysis.tsx:598)
    #   * a label in a `.copy.ts` object under a key no allowlist would guess, e.g.
    #     `primaryAction: 'Back to dashboard'` (NotFound.copy.ts:23)
    # Both were missed by the first version of this script, and both are real strings a
    # user reads. Neither can be reached by widening LABEL_KEYS.
    for off, quote, body in literals:
        if quote == "`" and "${" in body:
            continue
        label = clean_label(body)
        if not label or " " not in label:
            continue
        if looks_like_code(label) or is_svg_path(label) or not label[:1].isupper():
            continue
        if is_console_arg(masked, off):
            continue
        sig = ("literal", label, line_of(src, off))
        if sig in seen or any(s[1] == label and s[2] == line_of(src, off) for s in seen):
            continue
        seen.add(sig)
        yield {
            "file": path,
            "line": line_of(src, off),
            "channel": "literal",
            "key": None,
            "string": label,
        }

    # Template literals with interpolation: reported, never guessed at.
    for off, quote, body in literals:
        if quote != "`" or "${" not in body:
            continue
        stat = clean_label(re.sub(r"\$\{[^}]*\}", "…", body))
        if not stat or looks_like_code(stat):
            continue
        words = [w for w, _ in word_positions(stat)]
        if len(words) < 2:
            continue
        yield {
            "file": path,
            "line": line_of(src, off),
            "channel": "dynamic",
            "key": None,
            "string": stat,
        }


def area_of(path, root):
    rel = os.path.relpath(path, root)
    parts = rel.split(os.sep)
    if len(parts) == 1:
        return "(root)"
    if len(parts) == 2:
        return parts[0]
    return os.sep.join(parts[:2])


def source_files(root):
    try:
        out = subprocess.run(
            ["git", "ls-files", "--", f"{root}/**/*.ts", f"{root}/**/*.tsx", f"{root}/*.ts", f"{root}/*.tsx"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split("\n")
        files = [p for p in out if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        files = []
        for dirpath, _, names in os.walk(root):
            for nm in names:
                if nm.endswith((".ts", ".tsx")):
                    files.append(os.path.join(dirpath, nm))
    keep = []
    for p in sorted(set(files)):
        parts = p.split(os.sep)
        if ".test." in os.path.basename(p) or "test" in parts or "e2e" in parts:
            continue
        if os.path.basename(p).endswith(".d.ts"):
            continue
        keep.append(p)
    return keep


def collect(root):
    rows = []
    for path in source_files(root):
        try:
            src = open(path, encoding="utf-8").read()
        except OSError:
            continue
        for row in extract(path, src):
            verdict, offenders = classify(row["string"])
            if verdict == "skip":
                continue
            if row["channel"] == "dynamic":
                verdict = "dynamic-" + verdict
            row["case"] = verdict
            row["offenders"] = offenders
            row["area"] = area_of(path, root)
            row["bucket"] = bucket_of(row)
            rows.append(row)
    return rows


def bucket_of(row):
    """Split chrome from content the user could just as well have typed.

    CONTENT_STYLE.md says "There is no string class that opts out", and that is true of
    the strings the rule is *about* — buttons, headings, labels. It is not a claim about
    sample data. Three shapes in this tree are not chrome and must not land on a
    migration work-list:

      * `placeholder="e.g., Remote, NYC"`  — modelling what the user should type
      * `placeholder="Jane Smith, Engineering Manager"` — a sample person and their role
      * `<option value="1">Generic Software Engineer Letter</option>` — hardcoded mock
        records standing in for user documents

    Retitling any of them would be wrong under *both* board outcomes, which is exactly the
    "one rule is not one shape" failure this card was scoped to avoid on the doc-citation
    side. `wireframe-casing-audit.py` reaches the same conclusion for the wireframes and
    spells it `‹sample›`.
    """
    base = os.path.basename(row["file"])
    if row["channel"] == "jsx-option":
        return "sample"
    if (row["key"] or "").lower() == "placeholder" and SAMPLE_PREFIX_RE.match(row["string"]):
        return "sample"
    if base.startswith("mock") or ".mock." in base or "fixtures" in row["file"].split(os.sep):
        # e.g. services/mockApplicationService.ts — `Senior Frontend Engineer`,
        # `TechCorp Inc`, `San Francisco, CA`. Job titles and company names are user
        # data standing in for records, not chrome.
        return "sample"
    if row["file"].replace(os.sep, "/").endswith("constants/title.ts"):
        # The §5 route-title mirror table. ROUTE_TITLE_CONVENTION.md §0.3 makes each
        # entry its route's <h1> *verbatim* — every line here is annotated with the
        # `Component.tsx:line` it copies. These strings are DERIVED: they must move when
        # their heading moves and never on their own. Migrating them independently would
        # break `route-title-table-audit.py`, which is an ENFORCING gate in deploy.yml.
        return "derived"
    return "chrome"


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

COUNTEREXAMPLES = [
    ("Analyze fit", "Analyze Fit"),
    ("Job fit analysis", "Job Fit Analysis"),
    ("Generate resume variant", "Generate Resume Variant"),
    ("Back to dashboard", "Back to Dashboard"),
    ("Try again", "Try Again"),
]


def report_counterexamples(rows):
    """Re-measure CONTENT_STYLE.md's own five pairs, over EXTRACTED strings only.

    This is the number that arbitrates: raw `git grep -F -c` also counts prose in
    comments, which is how the two prior hand-counts came to disagree.
    """
    print("CONTENT_STYLE.md 'The rule' — its own five pairs, re-measured over extracted")
    print("UI strings (comments stripped), not raw grep:\n")
    print(f"  {'sentence-case (✅)':<30} {'✅ hits':>7}  {'❌ hits':>7}")
    print("  " + "-" * 48)
    detail = []
    for good, bad in COUNTEREXAMPLES:
        g = [r for r in rows if r["string"].lower() == good.lower() and r["string"] == good]
        b = [r for r in rows if r["string"] == bad]
        print(f"  {good:<30} {len(g):>7}  {len(b):>7}")
        detail.append((good, bad, g, b))
    print()
    for good, bad, g, b in detail:
        if g or b:
            print(f"  {good!r}:")
            for r in b:
                print(f"    ❌ {r['file']}:{r['line']}  ({r['channel']})")
            for r in g:
                print(f"    ✅ {r['file']}:{r['line']}  ({r['channel']})")
    print()
    print("  Read this against the raw-grep counts in WIC-2096 and the WIC-2112 dispatch:")
    print("  where they disagree, the difference is prose in comments, and these are the")
    print("  counts that describe strings a user can actually see.")


def report(rows, args):
    chrome = [r for r in rows if r["bucket"] == "chrome"]
    sample = [r for r in rows if r["bucket"] == "sample"]
    title = [r for r in chrome if r["case"] == "title"]
    sent = [r for r in chrome if r["case"] == "sentence"]
    caps = [r for r in chrome if r["case"] == "caps"]
    dyn = [r for r in chrome if r["case"].startswith("dynamic-")]
    derived = [r for r in rows if r["bucket"] == "derived"]
    s_title = [r for r in sample if r["case"] == "title"]
    d_title = [r for r in derived if r["case"] == "title"]

    print(f"UI string casing inventory — {args.root}")
    print("report-only; this script never fails a build (CONTENT_STYLE.md is unadopted)")
    print("=" * 72)
    print()
    total = len(title) + len(sent)
    print(f"  title case    {len(title):>4}")
    print(f"  sentence case {len(sent):>4}")
    print(f"  {'':>13} {'----':>4}")
    print(f"  classified    {total:>4}", end="")
    if total:
        print(f"   ({100 * len(title) // total}% title case)")
    else:
        print()
    print()
    print(f"  all-caps      {len(caps):>4}   governed by the WIC-1209 clause, already in force —")
    print(f"  {'':>18}   excluded from the tally above, not this script's business")
    print(f"  dynamic       {len(dyn):>4}   template literals with ${{}}; listed, never guessed at")
    print(f"  sample        {len(sample):>4}   e.g.-placeholders, <option> mock records, mock* fixtures")
    print(f"  {'':>18}   ({len(s_title)} of them title case). NOT chrome, NOT migration work")
    print(f"  {'':>18}   under either board outcome — see --strings --case title --bucket sample")
    print(f"  derived       {len(derived):>4}   constants/title.ts, the §5 route-title mirror table")
    print(f"  {'':>18}   ({len(d_title)} title case). These follow their <h1> and must never")
    print(f"  {'':>18}   be migrated on their own — route-title-table-audit.py is an")
    print(f"  {'':>18}   ENFORCING gate in deploy.yml and would fail on the divergence.")
    print()

    print("Per area (title / sentence):")
    print("-" * 72)
    per = defaultdict(Counter)
    for r in title:
        per[r["area"]]["title"] += 1
    for r in sent:
        per[r["area"]]["sentence"] += 1
    for area in sorted(per, key=lambda a: -per[a]["title"]):
        c = per[area]
        print(f"  {area:<28} {c['title']:>4} / {c['sentence']:>4}")
    print()

    print("Most common offending words (the word that makes a string title case):")
    print("-" * 72)
    off = Counter(w.lower() for r in title for w in r["offenders"])
    for w, n in off.most_common(15):
        print(f"  {w:<20} {n:>4}")
    print()

    if args.strings:
        wanted = args.case or "title"
        pool = {"chrome": chrome, "sample": sample, "derived": derived}[args.bucket]
        print(f"All {wanted}-case {args.bucket} strings, file:line:")
        print("-" * 72)
        sel = [r for r in pool if r["case"] == wanted]
        for r in sorted(sel, key=lambda r: (r["file"], r["line"])):
            extra = f"  [{'/'.join(r['offenders'])}]" if r["offenders"] else ""
            print(f"  {r['file']}:{r['line']}: {r['string']!r}{extra}")
        print()
        print(f"  {len(sel)} string(s).")
    else:
        print("Run with --strings for the work-list, --strings --case sentence to invert it.")


LEGEND = """Classifier exemptions — a capitalized word after the first does NOT make a
string title case when it is:

  * a proper noun / brand      CONTENT_STYLE.md Exception 1 (Careerpin, Google, LinkedIn, ...)
  * an acronym or initialism   ALL-CAPS token, or one of AI/API/ATS/PDF/DOCX/STAR/URL/...
  * after a sentence boundary  the preceding significant char is one of . ! ? :
  * a weekday or month name    capitalizes in ordinary prose
  * a single letter            e.g. "Plan A"

Everything else counts. Disagree with a call? The word is printed in brackets next to the
string under --strings, so the dispute is about one word, not the whole verdict.
"""


# --------------------------------------------------------------------------- #
# Selftest
# --------------------------------------------------------------------------- #

SELFTEST_CLASSIFY = [
    ("Back to Dashboard", "title", ["Dashboard"]),
    ("Back to dashboard", "sentence", []),
    ("Job Fit Analysis", "title", ["Fit", "Analysis"]),
    ("Job fit analysis", "sentence", []),
    ("Try Again", "title", ["Again"]),
    ("Try again", "sentence", []),
    ("Sign in with Google", "sentence", []),
    ("Import from LinkedIn", "sentence", []),
    ("Welcome to Careerpin", "sentence", []),
    ("Export as PDF", "sentence", []),
    ("NO FIT", "caps", []),
    ("Next: Select experiences", "sentence", []),
    ("Next: Select Experiences", "title", ["Experiences"]),
    ("Dashboard", "skip", []),
    ("Generate Resume Variant", "title", ["Resume", "Variant"]),
    ("Analyze fit →", "sentence", []),
    ("Analyze Fit →", "title", ["Fit"]),
]

SELFTEST_SRC = '''
// Back to Dashboard  <- a comment, must NOT be counted
/** Job Fit Analysis is discussed here in prose. */
const re = /https:\\/\\/x/;
export function C() {
  return (
    <div className="mt-6 text-sm">
      <h1>Job Fit Analysis</h1>
      <button aria-label="Try Again">Try again</button>
      <Field label="Job Title" placeholder="e.g. Senior Engineer" />
      <p>{`Showing ${n} Saved Applications`}</p>
      <select>
        <option value="1">Generic Software Engineer Letter</option>
      </select>
      <button>{isPending ? 'Analyzing...' : 'Analyze Fit →'}</button>
      <svg><path d="M9 5l7 7-7 7" /></svg>
    </div>
  );
}
export const copy = { primaryAction: 'Back to dashboard' };
console.error('Failed to load Something Here:', e);
'''


def selftest():
    fails = 0
    for s, want_case, want_off in SELFTEST_CLASSIFY:
        got_case, got_off = classify(s)
        if got_case != want_case or got_off != want_off:
            fails += 1
            print(f"  FAIL classify({s!r}) -> {got_case} {got_off}, want {want_case} {want_off}")
    rows = []
    for row in extract("selftest.tsx", SELFTEST_SRC):
        verdict, off = classify(row["string"])
        if verdict == "skip":
            continue
        row["case"] = ("dynamic-" + verdict) if row["channel"] == "dynamic" else verdict
        row["offenders"] = off
        row["bucket"] = bucket_of(row)
        rows.append(row)

    got = {(r["string"], r["case"]) for r in rows}
    expected = {
        ("Job Fit Analysis", "title"),
        ("Try again", "sentence"),
        ("Try Again", "title"),
        ("Job Title", "title"),
        ("Showing … Saved Applications", "dynamic-title"),
        ("Generic Software Engineer Letter", "title"),
        # The two false negatives the `literal` channel exists to close:
        ("Analyze Fit", "title"),          # ternary inside a JSX expression container
        ("Back to dashboard", "sentence"),  # a .copy.ts key no allowlist would guess
    }

    # Noise the `literal` channel must reject.
    for s in ("M9 5l7 7-7 7", "Failed to load Something Here:"):
        if any(r["string"] == s for r in rows):
            fails += 1
            print(f"  FAIL literal channel admitted noise: {s!r}")

    # A prop value must not be counted twice (once as `prop`, once as `literal`).
    n_ta = sum(1 for r in rows if r["string"] == "Try Again")
    if n_ta != 1:
        fails += 1
        print(f"  FAIL dedup: {n_ta} 'Try Again' rows, want 1")

    # The two sample shapes must land in the sample bucket, not on the work-list.
    for s in ("Generic Software Engineer Letter", "e.g. Senior Engineer"):
        got_bucket = next((r["bucket"] for r in rows if r["string"] == s), None)
        if got_bucket != "sample":
            fails += 1
            print(f"  FAIL bucket_of({s!r}) -> {got_bucket}, want 'sample'")
    if next((r["bucket"] for r in rows if r["string"] == "Job Title"), None) != "chrome":
        fails += 1
        print("  FAIL bucket_of('Job Title') should be 'chrome'")
    missing = expected - got
    if missing:
        fails += 1
        print(f"  FAIL extraction missing: {sorted(missing)}")

    # The comment and JSDoc mentions of `Back to Dashboard` / `Job Fit Analysis` must not
    # appear as extra rows. Exactly one `Job Fit Analysis` — the h1.
    n_jfa = sum(1 for r in rows if r["string"] == "Job Fit Analysis")
    if n_jfa != 1:
        fails += 1
        print(f"  FAIL comment stripping: {n_jfa} 'Job Fit Analysis' rows, want 1")
    if any(r["string"] == "Back to Dashboard" for r in rows):
        fails += 1
        print("  FAIL comment stripping: 'Back to Dashboard' leaked from a // comment")

    print("selftest: " + ("PASS" if not fails else f"{fails} failure(s)"))
    return 1 if fails else 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("root", nargs="?", default=ROOT_DEFAULT)
    ap.add_argument("--strings", action="store_true", help="list every string with file:line")
    ap.add_argument("--case", choices=["title", "sentence", "caps"], help="which list --strings prints")
    ap.add_argument("--bucket", choices=["chrome", "sample", "derived"], default="chrome", help="which bucket --strings prints")
    ap.add_argument("--area", help="restrict to one area, e.g. pages or components/wizard")
    ap.add_argument("--counterexamples", action="store_true", help="re-measure CONTENT_STYLE.md's five pairs")
    ap.add_argument("--json", action="store_true", help="machine-readable, for staging child issues")
    ap.add_argument("--legend", action="store_true", help="print the classifier exemptions")
    ap.add_argument("--selftest", action="store_true", help="run the offline fixtures")
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest()
    if args.legend:
        print(LEGEND)
        return 0
    if not os.path.isdir(args.root):
        print(f"no such directory: {args.root}", file=sys.stderr)
        return 2

    rows = collect(args.root)
    if args.area:
        rows = [r for r in rows if r["area"] == args.area]

    if args.json:
        json.dump(
            {
                "root": args.root,
                "adopted": False,
                "counts": dict(Counter(r["case"] for r in rows)),
                "strings": sorted(rows, key=lambda r: (r["file"], r["line"])),
            },
            sys.stdout,
            indent=2,
        )
        print()
        return 0

    if args.counterexamples:
        report_counterexamples(rows)
        return 0

    report(rows, args)
    # Always 0. See the module docstring: the rule this would enforce is not adopted.
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

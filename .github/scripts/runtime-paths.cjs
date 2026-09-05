// WIC-2098 / WIC-2088 / WIC-1271 — SINGLE SOURCE OF TRUTH for "does this path
// have a runtime surface?".
//
// This predicate was inline in `.github/workflows/skip-ci-guard.yml` until now.
// The deploy-drift detector (`.github/workflows/deploy-drift.yml`) needs exactly
// the same classification to answer a different question, and WIC-1271 called
// out the hazard by name: "reuse skip-ci-guard's allowlist logic rather than
// re-deriving it; a second copy will drift." So it lives here and both workflows
// `require()` it. Do not re-inline it into either.
//
// CommonJS on purpose: `actions/github-script@v7` evaluates its `script:` body in
// a CJS context and can only `require()` a module, not `import` one.
//
// The two consumers ask different questions of the same predicate:
//   - skip-ci-guard: "this PR carries a CI skip marker — does it change anything
//     CI would have had to prove?"  A runtime path means BLOCK.
//   - deploy-drift:  "prod is N commits behind main — is any of that undeployed
//     code that actually runs?"     A runtime path means ALERT LOUDLY; a
//     docs/workflow-only gap is reported quietly (WIC-1271 point 3: a monitor
//     that pages for a docs commit gets muted, and is then worse than nothing).

// ── DECISION (WIC-2101, ruled WIC-2113) — LEAVE `ALLOWED` AS IT IS ───────────
// It was raised as a real question, not an oversight: `.gitleaks.toml`,
// `.gitleaks-baseline.json`, `.gitattributes`, `.github/secret-scan-allowlist.json`
// and `.github/scripts/**` all classify as runtime-bearing here, and none of them
// can reach the Worker. Two alternatives were considered and BOTH REJECTED —
// (2) per-consumer allowlists, a shared base plus a drift-only extension, which
// models the asymmetry honestly but reintroduces the two-lists-that-drift hazard
// this module was extracted to kill; and (3) allowlisting them for both
// consumers, which weakens secret-scan posture and would need a security
// sign-off that is not obtainable from an agent seat today (WIC-2018).
// The deciding point is that the two consumers' errors are NOT symmetric in
// cost. A wrong answer costs `deploy-drift` a page with no remedy; it costs
// `skip-ci-guard` a PR that adds a gitleaks allowlist entry — one that
// SUPPRESSES A LEAKED SECRET — merging under a CI-skip marker with zero check
// runs. A nuisance page is recoverable; a suppressed secret scan is not. So the
// shared predicate is tuned to the stricter consumer on purpose, and the
// over-alerting is the price, knowingly paid.
// ⛔ REVISIT TRIGGER IS FREQUENCY DATA, NOT A DATE. If `deploy-drift.yml`
// actually pages on a CI-only path in practice, reopen with the real count. Do
// not reopen on the hypothetical — and do not reopen it to make WIC-1271's
// replay window quiet, which is a wrong premise (see deploy-drift.mjs's header
// and the correction filed on WIC-1271 itself).

// Paths with no runtime surface, so there is nothing for CI to have proven and
// nothing for a deploy to have shipped.
//
// ⛔ There is deliberately NO `startsWith('docs/')` predicate (WIC-2084).
// It was here until WIC-2094 and it was a fail-open: `docs/` is not
// documentation-only. Four of the scripts that CONSTITUTE the `lint-and-test`
// gate live under it and are invoked by `deploy.yml` with no
// `continue-on-error` —
// `docs/design/{wireframe-casing,route-title-table,doc-reference,confirmation-modal-focus}-audit.py`.
// A `docs/`-wide predicate let a PR edit a gate script and merge under a skip
// marker without ever running the gate it just changed.
// Prose under `docs/` is still allowlisted, by `endsWith('.md')` below.
// Do not re-add a directory-shaped predicate here: allowlist by what a path
// CANNOT affect at runtime, not by where it happens to live.
//
// ⛔ Nor is there a `startsWith('.github/')` predicate, which would be the
// obvious way to stop THIS file and `deploy-drift.mjs` from counting as runtime
// code. It is deliberately absent: `.github/secret-scan-allowlist.json` lives
// there, and widening the predicate would let a PR that adds an allowlist entry
// suppressing a leaked secret merge under a skip marker. The cost of leaving it
// out is that a commit touching `.github/scripts/` reads as runtime-bearing to
// the drift detector — an over-alert on a path that cannot in fact reach the
// Worker. That is the direction to err in: over-alerting on CI-only paths is a
// nuisance, under-alerting on runtime code is the failure WIC-1271 exists to
// prevent. `.github/workflows/**` stays allowlisted because a workflow-only
// change is exactly the no-deploy merge route this repo relies on.
const ALLOWED = [(p) => p.endsWith('.md'), (p) => p.startsWith('.github/workflows/')];

/**
 * @param {string} path repo-relative path
 * @returns {boolean} true when the path can affect what production runs
 */
function isRuntimePath(path) {
  return !ALLOWED.some((ok) => ok(path));
}

/**
 * @param {string[]} paths repo-relative paths
 * @returns {string[]} the subset that can affect what production runs
 */
function runtimePaths(paths) {
  return paths.filter(isRuntimePath);
}

module.exports = { ALLOWED, isRuntimePath, runtimePaths };

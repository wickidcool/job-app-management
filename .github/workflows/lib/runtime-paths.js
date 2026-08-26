// Single source of truth for "which changed paths have no runtime surface".
//
// WIC-1271. Two workflows need this exact judgement and the card is explicit
// that a second copy WILL drift from the first:
//   - skip-ci-guard.yml — may a `[skip ci]` commit merge? (yes iff every changed
//     path is allowlisted, i.e. nothing here would change what users get)
//   - deploy-drift.yml   — is production behind `main` on anything a user would
//     see? (page iff the undeployed delta contains a non-allowlisted path)
// Same question, opposite direction. Keep the list HERE and only here.
//
// Placed under `.github/workflows/` on purpose: that prefix is itself
// allowlisted (see ALLOWED below and skip-ci-guard.yml), so this file and the
// workflows that consume it all ride the cheap `[skip ci]` no-deploy merge
// route. GitHub Actions ignores non-`.yml` files in this directory.

// A changed path is "allowlisted" when it has no runtime surface, so there is
// nothing a build could have proven and nothing a deploy would change for a
// user. This mirrors the historical inline list in skip-ci-guard.yml exactly.
const ALLOWED = [
  (p) => p.startsWith('docs/'),
  (p) => p.endsWith('.md'),
  (p) => p.startsWith('.github/workflows/'),
];

// True when the path carries user-visible runtime surface (i.e. NOT allowlisted).
function isRuntimePath(p) {
  return !ALLOWED.some((ok) => ok(p));
}

// Split a list of changed paths into { runtime, allowlisted }.
function classify(paths) {
  const runtime = [];
  const allowlisted = [];
  for (const p of paths) (isRuntimePath(p) ? runtime : allowlisted).push(p);
  return { runtime, allowlisted };
}

module.exports = { ALLOWED, isRuntimePath, classify };

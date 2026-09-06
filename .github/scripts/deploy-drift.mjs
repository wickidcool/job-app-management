#!/usr/bin/env node
// WIC-2098 (carries WIC-2088, spec WIC-1271) — deploy-drift detector.
//
// THE GAP THIS CLOSES: production can silently fall behind `main` and nothing
// says so. WIC-1271 documented prod sitting 14 commits behind for six days,
// because 14 consecutive `[skip ci]` merges suppressed the only route to
// production. Nothing in the repo compares what prod runs against what `main`
// says it should run.
//
// ⚠️ SCOPING — this is NOT a health-regression alarm (WIC-2098 correction).
// WIC-2088 cited the 2026-09-05 `503` as motivation. That outage is NOT drift:
// prod was running current code (deploy.yml succeeded at 12:49:33Z) and was
// degraded for a CONNECTIVITY reason (`hyperdrive:false` plus a failing `db`
// field) tracked on WIC-1386 / WIC-2092 / WIC-2097.
//
// ⛔ Do NOT key anything on that `db` string. It names whichever of OUR OWN
// mitigations fired, not the fault, and it has changed three times while the
// fault stayed put (WIC-2169):
//   1. `Too many subrequests by single Worker invocation`  — pre-WIC-2043, the
//      unbounded initial connect loop spending the whole subrequest budget.
//   2. `write CONNECTION_DESTROYED aws-1-us-west-2.pooler.supabase.com:6543`
//      — WIC-2043's deadline tearing the pool down; teardown collateral, not
//      the pooler dropping us. This comment used to quote it as
//      "CONNECTION_DESTROYED against the us-west-2 pooler", which read as a
//      far-end fault. WIC-2163 disproved that.
//   3. `connect deadline exceeded: no connection within 1500ms (…:6543)`
//      — WIC-2163's honest rendering. Current as of 2026-09-06.
//
// So `/api/health` is REPORTED here as context — WIC-2088's addition, because a
// monitor saying "prod is 0 commits behind" while prod returns 503 is telling a
// true and useless thing — but it can NEVER trigger this alarm. A health alarm
// is a different detector and belongs on its own card.
//
// ── How the deployed revision is identified (WIC-2098 AC-2) ──────────────────
// NOT from the app. `/api/health` returns
// `{status, hyperdrive, db}` and NOTHING ELSE — no version, no SHA, no build id
// (verified live 2026-09-05; `packages/api/src/app.ts:117-118` confirms the
// handler has no version field, and the Worker is built with no SHA injected).
// There is no endpoint to ask. Do not add one on this card — that is a runtime
// change requiring a deploy, and this card is read-only.
//
// The revision source is instead GitHub Actions run history: the most recent
// `deploy.yml` run whose `Deploy Production` JOB concluded `success`. That job
// is the only route to production (`deploy.yml:653-663`: `environment:
// production`, `if: push || workflow_dispatch`), and its `head_sha` is the tree
// wrangler deployed. The workflow resolves it at the JOB level, not the run
// level, because a run's overall conclusion is not the same claim — `Deploy
// Production` is `skipped` on every `pull_request` run, and a run can conclude
// non-`success` for reasons that have nothing to do with whether prod moved.
//
// STATED LIMITATION, so nobody over-reads a green result: this proves what CI
// last successfully pushed. A `wrangler deploy` run from someone's laptop would
// be invisible to it, and would make this detector report drift that has in fact
// already shipped. That is the safe direction (over-report, not under-report),
// and the repo's stated policy is that production deploys go through this
// workflow. Cloudflare's deployment list carries no git SHA for a
// `wrangler deploy`, so it cannot corroborate the revision either — only the
// timing. This is the best available source, not a perfect one.

// ── ⚠️ WIC-1271's own acceptance figures do NOT reproduce — measured 2026-09-05 ──
// WIC-1271 asks that replaying its motivating window classify as "14 commits
// behind, ZERO runtime paths -> informational, not a page." Replayed against
// real history, that is wrong on both numbers, so do not tune this detector to
// reproduce it:
//
//   DEPLOYED_SHA=$(git rev-parse c3b9d484) MAIN_SHA=$(git rev-parse 332856f9) \
//     node .github/scripts/deploy-drift.mjs
//   -> 17 commits behind (16 excluding the commit that CLOSED the gap), 4
//      runtime-bearing, ALARM.
//
// The gap is real — last successful production deploy `c3b9d484` 2026-08-19
// 06:08:45Z, next push run 2026-08-25 21:55:02Z — but its contents were not
// runtime-free:
//   - `332856f9` (WIC-1069) changes FOUR packages/web source files. It is the
//     push that ended the drought, so it is arguably the boundary rather than
//     the contents — but it is unambiguously runtime code.
//   - `69259658`, `8e197059`, `69724346` touch `.gitleaks.toml`,
//     `.gitleaks-baseline.json` and `.gitattributes`. WIC-1271 called these
//     "zero runtime surface", and in the user-visible sense they are. They are
//     NOT allowlisted, because the allowlist deliberately excludes
//     secret-scan SUPPRESSION config for the same reason it excludes
//     `.github/secret-scan-allowlist.json` — see runtime-paths.cjs.
//
// So the detector pages on that window, and it is right to. WIC-1271's "zero
// runtime paths" was an unverified quantifier written from memory of the merge
// subjects, not from the diffs. Whether `.gitleaks.*` / `.gitattributes` should
// join the allowlist is a POLICY question that also moves skip-ci-guard, and it
// is filed separately rather than decided here by tuning a monitor to a wrong
// premise.

import { execFileSync } from 'node:child_process';
import runtime from './runtime-paths.cjs';

const { isRuntimePath, runtimePaths } = runtime;

// ── Thresholds (WIC-2098 AC-1: "alerting on drift beyond a STATED threshold") ─
// T1 is the primary trigger. The grace period exists so the detector does not
// page during the ~8 minutes a legitimate deploy takes to run lint+e2e+deploy;
// 90 minutes is ~10x that, which is long enough that a fired alarm means the
// deploy lane is genuinely not moving rather than merely mid-flight.
const DEFAULT_MAX_RUNTIME_DRIFT_MINUTES = 90;
// T2 catches the WIC-1271 shape directly: many commits stacking up behind a
// suppressed deploy lane. It fires on COUNT regardless of age, so a burst of
// merges cannot hide inside the grace window.
const DEFAULT_MAX_RUNTIME_DRIFT_COMMITS = 5;

const DEFAULT_HEALTH_URL = 'https://jobtrail.al-23f.workers.dev/api/health';

// stderr is captured rather than inherited: `execFileSync` otherwise streams git's
// own `fatal:` straight to the job log, where it lands ABOVE the explanatory
// `::error::` and reads like the real diagnosis. We want our message to be the
// one a reader sees first.
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * Enumerate first-parent commits in `deployed..head`, newest first, each with
 * the paths its own merge brought in.
 *
 * --first-parent on purpose: this repo lands PRs as merge commits, so the
 * first-parent walk is the PR-level history — the granularity "prod is N
 * commits behind" is actually asking about. And `git diff <sha>^ <sha>` on a
 * merge commit is the diff against its FIRST parent, i.e. everything that PR
 * brought to `main`. (Plain `git show --name-only` on a merge prints nothing,
 * which would silently classify every merge as touching zero paths — the exact
 * fail-open this detector exists to avoid.)
 */
function readCommits(deployedSha, headSha) {
  const line = git('rev-list', '--first-parent', '--format=%H%x1f%ct%x1f%s', `${deployedSha}..${headSha}`);
  if (!line) return [];
  return line
    .split('\n')
    .filter((l) => !l.startsWith('commit '))
    .map((l) => {
      const [sha, committedAt, subject] = l.split('\x1f');
      const files = git('diff', '--name-only', `${sha}^`, sha)
        .split('\n')
        .filter(Boolean);
      return { sha, committedAt: Number(committedAt) * 1000, subject, files };
    });
}

/**
 * The whole decision, as a pure function of already-gathered facts, so the
 * self-test can drive it with synthetic input and observe it FIRE (AC-3).
 * Takes no network and no git.
 */
export function evaluate({
  deployedSha,
  headSha,
  commits,
  nowMs,
  maxRuntimeDriftMinutes = DEFAULT_MAX_RUNTIME_DRIFT_MINUTES,
  maxRuntimeDriftCommits = DEFAULT_MAX_RUNTIME_DRIFT_COMMITS,
  // Aggregate `git diff --name-only deployed..head`. This — not the per-commit
  // union — is the authoritative answer to "does the deployed tree differ from
  // main in runtime code", because it nets out a change that was made and then
  // reverted while prod was behind.
  diffPaths,
}) {
  const runtimeDiffPaths = runtimePaths(diffPaths);
  const annotated = commits.map((c) => ({ ...c, runtimeFiles: runtimePaths(c.files) }));
  const runtimeCommits = annotated.filter((c) => c.runtimeFiles.length > 0);
  const quietCommits = annotated.filter((c) => c.runtimeFiles.length === 0);

  // The tree is what actually matters. If every runtime change in the window was
  // reverted before the window closed, the deployed tree is already correct in
  // every runtime path and there is nothing undeployed to page about, however
  // many runtime-touching commits went by.
  const treeHasUndeployedRuntimeCode = runtimeDiffPaths.length > 0;

  // WIC-1271 point 4. Built here rather than in the workflow so the self-test
  // can assert the alarm actually carries it.
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY || 'wickidcool/job-app-management';
  const dispatchUrl = `${server}/${repo}/actions/workflows/deploy.yml`;

  const oldest = runtimeCommits.length
    ? runtimeCommits.reduce((a, b) => (a.committedAt <= b.committedAt ? a : b))
    : null;
  const oldestAgeMinutes = oldest ? (nowMs - oldest.committedAt) / 60000 : 0;

  const triggers = [];
  if (treeHasUndeployedRuntimeCode) {
    if (oldest && oldestAgeMinutes > maxRuntimeDriftMinutes) {
      triggers.push(
        `T1: undeployed runtime code has been on \`main\` for ${oldestAgeMinutes.toFixed(0)} min ` +
          `(threshold ${maxRuntimeDriftMinutes} min) — oldest is \`${oldest.sha.slice(0, 8)}\`.`
      );
    }
    if (runtimeCommits.length >= maxRuntimeDriftCommits) {
      triggers.push(
        `T2: ${runtimeCommits.length} undeployed runtime-bearing commits ` +
          `(threshold ${maxRuntimeDriftCommits}), regardless of age.`
      );
    }
  }

  return {
    deployedSha,
    headSha,
    totalCommits: commits.length,
    runtimeCommits,
    quietCommits,
    runtimeDiffPaths,
    treeHasUndeployedRuntimeCode,
    oldestAgeMinutes,
    maxRuntimeDriftMinutes,
    maxRuntimeDriftCommits,
    dispatchUrl,
    triggers,
    alarm: triggers.length > 0,
  };
}

/** Read-only GET. Reported as context only — never a trigger. */
async function readHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { ok: true, httpStatus: res.status, status: body?.status ?? '(no `status` field)', body: text.slice(0, 400) };
  } catch (err) {
    return { ok: false, httpStatus: null, status: 'unreachable', body: String(err && err.message ? err.message : err) };
  }
}

function render(result, health) {
  const short = (s) => s.slice(0, 8);
  const lines = [];
  lines.push('## Deploy-drift detector');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Deployed revision | \`${short(result.deployedSha)}\` |`);
  lines.push(`| \`main\` head | \`${short(result.headSha)}\` |`);
  lines.push(`| Commits behind (first-parent) | ${result.totalCommits} |`);
  lines.push(`| — runtime-bearing | **${result.runtimeCommits.length}** |`);
  lines.push(`| — docs/workflow-only | ${result.quietCommits.length} |`);
  lines.push(`| Undeployed runtime paths | ${result.runtimeDiffPaths.length} |`);
  lines.push('');
  lines.push(
    `Revision source: most recent \`deploy.yml\` run whose **\`Deploy Production\` job** concluded ` +
      `\`success\`. The app exposes no version endpoint — \`/api/health\` returns no SHA — so run ` +
      `history is the only available source. See the header of \`.github/scripts/deploy-drift.mjs\`.`
  );
  lines.push('');
  lines.push(
    `Thresholds: **T1** runtime drift older than ${result.maxRuntimeDriftMinutes} min · ` +
      `**T2** ${result.maxRuntimeDriftCommits}+ runtime-bearing commits at any age.`
  );
  lines.push('');
  lines.push(
    `Production health (context only, **never** a trigger — WIC-2098 scoping correction): ` +
      `\`${health.status}\`${health.httpStatus ? ` (HTTP ${health.httpStatus})` : ''}. ` +
      (health.status === 'ok'
        ? ''
        : `A non-\`ok\` health is NOT drift and is not this detector's business — see WIC-1386 / WIC-2092 / WIC-2097.`)
  );
  lines.push('');

  if (result.runtimeCommits.length) {
    lines.push('### Undeployed runtime-bearing commits');
    lines.push('');
    for (const c of result.runtimeCommits) {
      lines.push(`- \`${short(c.sha)}\` ${c.subject} — ${c.runtimeFiles.length} runtime path(s)`);
    }
    lines.push('');
  }
  if (result.quietCommits.length) {
    lines.push(`### Undeployed docs/workflow-only commits (quiet — WIC-1271 point 3)`);
    lines.push('');
    for (const c of result.quietCommits) lines.push(`- \`${short(c.sha)}\` ${c.subject}`);
    lines.push('');
  }

  if (result.alarm) {
    lines.push('### 🔴 DRIFT ALARM');
    lines.push('');
    for (const t of result.triggers) lines.push(`- ${t}`);
    lines.push('');
    lines.push(
      'Production is running code older than `main` in paths that affect what it runs. ' +
        'Check whether the deploy lane is suppressed (a CI-skip merge run, or a failing ' +
        '`Deploy Production` job). **This detector does not deploy anything.**'
    );
    lines.push('');
    // WIC-1271 design point 4: "surface the one-click close — link the
    // workflow_dispatch run URL in the alert." An alarm that makes you go and
    // find the lever is most of a page and none of a remedy. WIC-1260 built the
    // lever; this is what connects the two.
    lines.push(`**One-click fix:** [run \`deploy.yml\` against \`main\`](${result.dispatchUrl}) — WIC-1260's manual lever. It is a real production deploy and stays board-gated like any other.`);
  } else if (result.treeHasUndeployedRuntimeCode) {
    lines.push(
      '### 🟡 Runtime drift present but inside threshold\n\n' +
        'A deploy is most likely in flight. No alarm.'
    );
  } else if (result.totalCommits) {
    lines.push('### 🟢 No runtime drift\n\nEverything undeployed is docs/workflow-only. Reported, not alarmed.');
  } else {
    lines.push('### 🟢 In sync\n\nProduction is running `main`.');
  }
  return lines.join('\n');
}

// ── Self-test (AC-3: prove it FIRES, not only that it stays quiet) ───────────
// A detector only ever verified in its quiet state is indistinguishable from a
// broken one. Every case below drives the same `evaluate()` the scheduled run
// uses. Run: `node .github/scripts/deploy-drift.mjs --selftest`
function selftest() {
  const NOW = 1_757_000_000_000;
  const minsAgo = (m) => NOW - m * 60000;
  const c = (sha, files, ageMin, subject = 'x') => ({
    sha: sha.padEnd(40, '0'),
    files,
    committedAt: minsAgo(ageMin),
    subject,
  });
  const cases = [
    {
      name: 'in sync — no commits at all',
      input: { commits: [], diffPaths: [] },
      alarm: false,
    },
    {
      name: 'docs-only drift, very old — must stay QUIET (WIC-1271 point 3)',
      input: {
        commits: [c('aaa', ['README.md', 'docs/design/NOTES.md'], 10_000), c('bbb', ['.github/workflows/deploy.yml'], 9000)],
        diffPaths: ['README.md', 'docs/design/NOTES.md', '.github/workflows/deploy.yml'],
      },
      alarm: false,
    },
    {
      name: 'runtime drift inside the grace window — quiet (deploy in flight)',
      input: { commits: [c('ccc', ['packages/api/src/app.ts'], 30)], diffPaths: ['packages/api/src/app.ts'] },
      alarm: false,
    },
    {
      name: 'T1 — single runtime commit past the grace window — must FIRE',
      input: { commits: [c('ddd', ['packages/api/src/app.ts'], 200)], diffPaths: ['packages/api/src/app.ts'] },
      alarm: true,
      trigger: 'T1',
    },
    {
      name: 'T2 — 5 fresh runtime commits, all inside grace — must FIRE on count',
      input: {
        commits: [1, 2, 3, 4, 5].map((i) => c(`e${i}`, [`packages/web/src/f${i}.tsx`], 5)),
        diffPaths: [1, 2, 3, 4, 5].map((i) => `packages/web/src/f${i}.tsx`),
      },
      alarm: true,
      trigger: 'T2',
    },
    {
      name: 'the WIC-1271 shape — 14 commits behind, mixed — must FIRE',
      input: {
        commits: [
          ...Array.from({ length: 9 }, (_, i) => c(`f${i}`, [`packages/api/src/routes/r${i}.ts`], 400 + i)),
          ...Array.from({ length: 5 }, (_, i) => c(`g${i}`, [`docs/d${i}.md`], 300 + i)),
        ],
        diffPaths: Array.from({ length: 9 }, (_, i) => `packages/api/src/routes/r${i}.ts`),
      },
      alarm: true,
      trigger: 'T1',
    },
    {
      name: 'runtime commits netted out by a revert — tree is clean, so QUIET',
      input: {
        commits: [c('h1', ['packages/api/src/app.ts'], 900), c('h2', ['packages/api/src/app.ts'], 800, 'Revert')],
        diffPaths: [],
      },
      alarm: false,
    },
    {
      name: 'gate-script edit under docs/ counts as runtime (WIC-2084/2094 fail-open)',
      input: {
        commits: [c('i1', ['docs/design/route-title-table-audit.py'], 500)],
        diffPaths: ['docs/design/route-title-table-audit.py'],
      },
      alarm: true,
      trigger: 'T1',
    },
  ];

  let failed = 0;
  for (const t of cases) {
    const r = evaluate({ deployedSha: 'dead'.padEnd(40, '0'), headSha: 'beef'.padEnd(40, '0'), nowMs: NOW, ...t.input });
    const okAlarm = r.alarm === t.alarm;
    const okTrigger = !t.trigger || r.triggers.some((x) => x.startsWith(t.trigger));
    if (okAlarm && okTrigger) {
      console.log(`PASS  ${t.name}`);
    } else {
      failed++;
      console.error(`FAIL  ${t.name}`);
      console.error(`      expected alarm=${t.alarm}${t.trigger ? ` trigger=${t.trigger}` : ''}`);
      console.error(`      got      alarm=${r.alarm} triggers=${JSON.stringify(r.triggers)}`);
    }
  }

  // Guard the guard: the classifier must be the shared module, and it must still
  // say the two things the whole design rests on. If someone re-inlines a copy
  // into a workflow and it drifts, this is what notices.
  const classifier = [
    ['packages/api/src/app.ts', true],
    ['docs/design/route-title-table-audit.py', true],
    ['.github/scripts/deploy-drift.mjs', true],
    ['docs/design/NOTES.md', false],
    ['.github/workflows/deploy.yml', false],
  ];
  for (const [p, want] of classifier) {
    if (isRuntimePath(p) !== want) {
      failed++;
      console.error(`FAIL  classifier: isRuntimePath(${p}) = ${!want}, expected ${want}`);
    } else {
      console.log(`PASS  classifier: ${p} -> ${want ? 'runtime' : 'allowlisted'}`);
    }
  }

  // WIC-1271 design point 4: the alarm must carry the one-click lever, not just
  // mention that one exists. Asserted on the RENDERED alarm, because that is
  // what a human reads — a `dispatchUrl` present in the result object but
  // dropped from `render()` would satisfy a field check and help nobody.
  {
    const r = evaluate({
      deployedSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      nowMs: NOW,
      commits: [c('z1', ['packages/api/src/app.ts'], 500)],
      diffPaths: ['packages/api/src/app.ts'],
    });
    const md = render(r, { status: 'ok', httpStatus: 200 });
    if (r.alarm && md.includes('/actions/workflows/deploy.yml') && md.includes('One-click fix')) {
      console.log('PASS  alarm carries the WIC-1260 one-click deploy lever (WIC-1271 point 4)');
    } else {
      failed++;
      console.error('FAIL  alarm does not carry the one-click deploy lever link (WIC-1271 point 4)');
    }
  }

  // A test suite that can pass while the detector is inert is worthless. Assert
  // at least one case actually reached the alarm branch.
  const firing = cases.filter((t) => t.alarm).length;
  if (firing === 0) {
    failed++;
    console.error('FAIL  self-test contains no firing case — it would pass against a detector that never alarms.');
  } else {
    console.log(`PASS  ${firing} firing case(s) present`);
  }

  if (failed) {
    console.error(`\n${failed} self-test failure(s).`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length + classifier.length + 1} deploy-drift self-test checks passed.`);
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest();

  const deployedSha = process.env.DEPLOYED_SHA;
  if (!deployedSha) {
    console.error('DEPLOYED_SHA is required (resolved by the workflow from deploy.yml run history).');
    process.exit(2);
  }
  const headSha = process.env.MAIN_SHA || git('rev-parse', 'HEAD');

  // A shallow checkout cannot see the range; fail loudly rather than reporting a
  // confident "0 commits behind" off a truncated history.
  try {
    git('merge-base', '--is-ancestor', deployedSha, headSha);
  } catch {
    console.error(
      `::error::\`${deployedSha}\` is not an ancestor of \`${headSha}\`. Either the checkout is ` +
        `shallow (needs fetch-depth: 0) or production is running a ref that is not on \`main\` — ` +
        `both are conditions a human must look at, not conditions to report as "no drift".`
    );
    process.exit(2);
  }

  const commits = readCommits(deployedSha, headSha);
  const diffPaths = git('diff', '--name-only', deployedSha, headSha).split('\n').filter(Boolean);
  const result = evaluate({
    deployedSha,
    headSha,
    commits,
    diffPaths,
    nowMs: Date.now(),
    maxRuntimeDriftMinutes: Number(process.env.MAX_RUNTIME_DRIFT_MINUTES || DEFAULT_MAX_RUNTIME_DRIFT_MINUTES),
    maxRuntimeDriftCommits: Number(process.env.MAX_RUNTIME_DRIFT_COMMITS || DEFAULT_MAX_RUNTIME_DRIFT_COMMITS),
  });

  const health = await readHealth(process.env.HEALTH_URL || DEFAULT_HEALTH_URL);
  const summary = render(result, health);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (result.alarm) {
    console.error(`::error::Deploy drift: ${result.triggers.join(' ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

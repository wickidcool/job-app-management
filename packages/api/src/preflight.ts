/**
 * Credential preflight CLI (ADR-0001 Pillar 1 — WIC-878).
 *
 * Runs the boot-time credential validation helper against a chosen set of
 * providers and exits non-zero if any authenticated ping fails. Intended to be
 * invoked at the top of a harness/CI job, before real work begins.
 *
 *   npm run -w @wic/api preflight -- cloudflare supabase
 *   PREFLIGHT_PROVIDERS=github,anthropic npm run -w @wic/api preflight
 *   npm run -w @wic/api preflight -- all
 *
 * Exit codes: 0 = all selected credentials valid; 1 = at least one failed;
 * 2 = no valid providers selected.
 */
import 'dotenv/config';
import {
  ALL_PROVIDERS,
  defaultDeps,
  formatResultLine,
  runPreflight,
  type ProviderId,
} from './lib/credential-preflight.js';

function parseProviders(argv: string[]): { providers: ProviderId[]; unknown: string[] } {
  const raw = argv.length ? argv : (process.env.PREFLIGHT_PROVIDERS?.split(',') ?? []);
  const tokens = raw.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length || tokens.includes('all'))
    return { providers: [...ALL_PROVIDERS], unknown: [] };
  const known = new Set<string>(ALL_PROVIDERS);
  const providers = tokens.filter((t): t is ProviderId => known.has(t));
  const unknown = tokens.filter((t) => !known.has(t));
  return { providers, unknown };
}

async function main(): Promise<void> {
  const { providers, unknown } = parseProviders(process.argv.slice(2));
  if (unknown.length) {
    console.error(`[preflight] ignoring unknown providers: ${unknown.join(', ')}`);
  }
  if (!providers.length) {
    console.error(`[preflight] no valid providers selected (known: ${ALL_PROVIDERS.join(', ')})`);
    process.exit(2);
  }

  const { ok, results } = await runPreflight(providers, defaultDeps());
  for (const result of results) {
    const line = formatResultLine(result);
    if (result.outcome === 'fail') console.error(line);
    else console.log(line);
  }

  if (!ok) {
    const failed = results.filter((r) => r.outcome === 'fail').length;
    console.error(`[preflight] FAILED: ${failed} credential check(s) failed — refusing to proceed`);
    process.exit(1);
  }
  console.log('[preflight] OK: all selected credentials valid');
}

main().catch((err) => {
  console.error(`[preflight] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

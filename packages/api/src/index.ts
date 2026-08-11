import 'dotenv/config';
import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { closeDb } from './db/client.js';
import {
  defaultDeps,
  formatResultLine,
  runPreflight,
  type ProviderId,
} from './lib/credential-preflight.js';

const config = getConfig();
const keyPreview = config.anthropicApiKey
  ? `${config.anthropicApiKey.substring(0, 10)}...${config.anthropicApiKey.substring(config.anthropicApiKey.length - 4)} (len: ${config.anthropicApiKey.length})`
  : 'not set';
console.log(`[startup] ANTHROPIC_API_KEY: ${keyPreview}`);

// ADR-0001 Pillar 1 (WIC-878): validate configured credentials before serving so a
// bad token fails loudly at boot instead of deep in a request as a 401/403. Only
// *configured* providers are checked (unconfigured ones are skipped), so this never
// blocks local dev without keys. Set PREFLIGHT_ON_BOOT=false to opt out.
if (process.env.PREFLIGHT_ON_BOOT !== 'false') {
  const providers: ProviderId[] = [];
  if (process.env.GITHUB_TOKEN) providers.push('github');
  if (config.anthropicApiKey) providers.push('anthropic');
  if (config.supabaseUrl && config.supabaseAnonKey) providers.push('supabase');
  if (providers.length) {
    const { ok, results } = await runPreflight(providers, defaultDeps());
    for (const result of results) {
      const line = formatResultLine(result);
      if (result.outcome === 'fail') console.error(line);
      else console.log(line);
    }
    if (!ok) {
      console.error('[startup] credential preflight failed — refusing to start');
      process.exit(1);
    }
  }
}

const app = buildApp();

const shutdown = async () => {
  console.log('Shutting down...');
  await closeDb();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Server running at http://${info.address}:${info.port}`);
});

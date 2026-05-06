import 'dotenv/config';
import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { closeDb } from './db/client.js';

const config = getConfig();
const keyPreview = config.anthropicApiKey
  ? `${config.anthropicApiKey.substring(0, 10)}...${config.anthropicApiKey.substring(config.anthropicApiKey.length - 4)} (len: ${config.anthropicApiKey.length})`
  : 'not set';
console.log(`[startup] ANTHROPIC_API_KEY: ${keyPreview}`);

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

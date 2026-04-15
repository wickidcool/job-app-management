import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { closeDb } from './db/client.js';

const config = getConfig();
const app = buildApp({ logger: config.nodeEnv !== 'test' });

const shutdown = async () => {
  app.log.info('Shutting down...');
  await app.close();
  await closeDb();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server running at http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  await closeDb();
  process.exit(1);
}

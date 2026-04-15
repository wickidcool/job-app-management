export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  dataDir: string;
  nodeEnv: string;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = {
      port: parseInt(process.env.PORT ?? '3000', 10),
      host: process.env.HOST ?? '127.0.0.1',
      databaseUrl:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5432/job_app_manager',
      dataDir: process.env.DATA_DIR ?? './data',
      nodeEnv: process.env.NODE_ENV ?? 'development',
    };
  }
  return _config;
}

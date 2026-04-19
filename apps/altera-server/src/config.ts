import {
  DEFAULT_HOST,
  DEFAULT_JWT_ACCESS_TTL_SEC,
  DEFAULT_JWT_REFRESH_TTL_SEC,
  DEFAULT_PORT,
} from '@altera/core';

export interface ServerConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  databaseUrl: string;
  dataDir: string;
  maxUploadBytes: number;
  jwtSecret: string;
  jwtAccessTtlSec: number;
  jwtRefreshTtlSec: number;
  corsOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): ServerConfig {
  const env = envStr('NODE_ENV', 'development') as ServerConfig['env'];
  const jwtSecret = envStr('JWT_SECRET', '');

  if (!jwtSecret && env === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  return {
    env,
    host: envStr('HOST', DEFAULT_HOST),
    port: envInt('PORT', DEFAULT_PORT),
    databaseUrl: envStr('DATABASE_URL', './data/altera.db'),
    dataDir: envStr('ALTERA_DATA_DIR', './data'),
    maxUploadBytes: envInt('ALTERA_MAX_UPLOAD_BYTES', 50 * 1024 * 1024),
    jwtSecret: jwtSecret || 'dev-only-secret-change-in-production-xxxxxxxxxxxxxxxxxxxxxxxx',
    jwtAccessTtlSec: envInt('JWT_ACCESS_TTL', DEFAULT_JWT_ACCESS_TTL_SEC),
    jwtRefreshTtlSec: envInt('JWT_REFRESH_TTL', DEFAULT_JWT_REFRESH_TTL_SEC),
    corsOrigins: envStr('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: envStr('LOG_LEVEL', 'info') as ServerConfig['logLevel'],
  };
}

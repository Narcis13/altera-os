import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { buildApp } from './app.ts';
import type { ServerConfig } from './config.ts';

let tmpDir: string;
let dbPath: string;

const baseConfig: ServerConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: '',
  dataDir: './data',
  maxUploadBytes: 10 * 1024 * 1024,
  jwtSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  jwtAccessTtlSec: 60,
  jwtRefreshTtlSec: 120,
  corsOrigins: ['*'],
  logLevel: 'error',
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'altera-srv-'));
  dbPath = join(tmpDir, 'test.db');
  runMigrations({ dbUrl: dbPath, silent: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function appWithTenant() {
  const { db } = createDb({ url: dbPath });
  db.insert(schema.tenants)
    .values({
      id: newId('tenant'),
      name: 'Acme',
      slug: 'acme',
      settingsJson: '{}',
      createdAt: new Date(),
    })
    .run();
  return buildApp({ db, config: { ...baseConfig, databaseUrl: dbPath } });
}

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const app = appWithTenant();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('altera-server');
  });
});

describe('auth flow', () => {
  test('register → login → /api/me round-trip', async () => {
    const app = appWithTenant();

    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: 'acme',
        username: 'alice',
        email: 'alice@acme.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(regRes.status).toBe(201);

    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: 'acme',
        usernameOrEmail: 'alice',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { accessToken: string };
    expect(loginBody.accessToken).toBeTruthy();

    const meRes = await app.request('/api/me', {
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { user: { username: string } };
    expect(meBody.user.username).toBe('alice');
  });

  test('/api/me rejects missing bearer', async () => {
    const app = appWithTenant();
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  test('/api/me rejects invalid bearer', async () => {
    const app = appWithTenant();
    const res = await app.request('/api/me', {
      headers: { authorization: 'Bearer not-a-valid-token' },
    });
    expect(res.status).toBe(401);
  });

  test('login with wrong password yields 401 with consistent error shape', async () => {
    const app = appWithTenant();
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: 'acme',
        username: 'bob',
        email: 'bob@acme.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: 'acme',
        usernameOrEmail: 'bob',
        password: 'wrong',
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('validation error returns 400 with details', async () => {
    const app = appWithTenant();
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantSlug: 'acme', username: 'x' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

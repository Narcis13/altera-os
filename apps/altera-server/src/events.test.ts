import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { eq } from 'drizzle-orm';
import { buildAppWithBus } from './app.ts';
import type { ServerConfig } from './config.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../migrations');

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
  tmpDir = mkdtempSync(join(tmpdir(), 'altera-srv-events-'));
  dbPath = join(tmpDir, 'test.db');
  runMigrations({ dbUrl: dbPath, migrationsDir: MIGRATIONS_DIR, silent: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function bootstrap() {
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
  const built = buildAppWithBus({ db, config: { ...baseConfig, databaseUrl: dbPath } });

  await built.app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantSlug: 'acme',
      username: 'alice',
      email: 'alice@acme.test',
      password: 'correct-horse-battery-staple',
    }),
  });
  const loginRes = await built.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantSlug: 'acme',
      usernameOrEmail: 'alice',
      password: 'correct-horse-battery-staple',
    }),
  });
  const login = (await loginRes.json()) as { accessToken: string };
  const me = await built.app.request('/api/me', {
    headers: { authorization: `Bearer ${login.accessToken}` },
  });
  const meBody = (await me.json()) as { user: { id: string; tenantId: string } };
  return { built, db, accessToken: login.accessToken, user: meBody.user };
}

describe('S2.2 — ActivitySubscriber', () => {
  test('debug-emit triggers an audit_log row', async () => {
    const { built, db, accessToken, user } = await bootstrap();

    const res = await built.app.request('/api/events/debug-emit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        type: 'file.uploaded',
        payload: {
          fileId: 'fil_test',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          hashSha256: 'h',
        },
      }),
    });
    expect(res.status).toBe(200);

    const auditRows = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tenantId, user.tenantId))
      .all();
    const fileEvents = auditRows.filter((r) => r.action === 'file.uploaded');
    expect(fileEvents).toHaveLength(1);
    expect(fileEvents[0]!.resourceType).toBe('file');
    expect(fileEvents[0]!.resourceId).toBe('fil_test');
    expect(fileEvents[0]!.userId).toBe(user.id);

    const eventRows = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.tenantId, user.tenantId))
      .all();
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.type).toBe('file.uploaded');
  });
});

describe('S2.3 — SSE /api/events/stream', () => {
  test('events for the authenticated tenant arrive over SSE', async () => {
    const { built, accessToken, user } = await bootstrap();

    const res = await built.app.request(
      `/api/events/stream?access_token=${accessToken}&topics=entity.created`,
      { headers: { accept: 'text/event-stream' } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    async function readChunk(): Promise<string> {
      const { value } = await reader.read();
      return value ? dec.decode(value) : '';
    }

    const ready = await readChunk();
    expect(ready).toContain('event: ready');

    await built.bus.emit({
      tenantId: user.tenantId,
      userId: user.id,
      type: 'entity.created',
      payload: { entityId: 'ent_z', entityType: 'doc' },
    });
    const chunk = await readChunk();
    expect(chunk).toContain('event: entity.created');
    expect(chunk).toContain('"entityId":"ent_z"');

    await reader.cancel();
  });

  test('SSE rejects without a token', async () => {
    const { built } = await bootstrap();
    const res = await built.app.request('/api/events/stream');
    expect(res.status).toBe(401);
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { eq } from 'drizzle-orm';
import { buildAppWithBus } from './app.ts';
import type { ServerConfig } from './config.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../migrations');

let tmpDir: string;
let dataDir: string;
let dbPath: string;

const baseConfig: ServerConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: '',
  dataDir: '',
  maxUploadBytes: 10 * 1024 * 1024,
  jwtSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  jwtAccessTtlSec: 60,
  jwtRefreshTtlSec: 120,
  corsOrigins: ['*'],
  logLevel: 'error',
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'altera-srv-ingest-'));
  dbPath = join(tmpDir, 'test.db');
  dataDir = join(tmpDir, 'data');
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
  const built = buildAppWithBus({
    db,
    config: { ...baseConfig, databaseUrl: dbPath, dataDir },
  });

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

async function uploadFixture(
  built: Awaited<ReturnType<typeof bootstrap>>['built'],
  accessToken: string,
  body: Uint8Array,
  name: string,
  mime: string,
): Promise<Response> {
  const fd = new FormData();
  const blob = new Blob([new Uint8Array(body)], { type: mime });
  fd.set('file', new File([blob], name, { type: mime }));
  return built.app.request('/api/files/upload', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: fd,
  });
}

describe('S3.2 — file upload endpoint', () => {
  test('upload persists file on disk, inserts row, emits event', async () => {
    const { built, db, accessToken, user } = await bootstrap();
    const body = new TextEncoder().encode('hello upload\n');
    const res = await uploadFixture(built, accessToken, body, 'note.txt', 'text/plain');
    expect(res.status).toBe(201);
    const meta = (await res.json()) as {
      id: string;
      storagePath: string;
      hashSha256: string;
      mimeType: string;
      sizeBytes: number;
    };
    expect(meta.mimeType).toBe('text/plain');
    expect(meta.sizeBytes).toBe(body.length);

    const absPath = resolve(dataDir, meta.storagePath);
    expect(existsSync(absPath)).toBe(true);
    const onDisk = new Uint8Array(readFileSync(absPath));
    expect(onDisk.length).toBe(body.length);

    const rows = db
      .select()
      .from(schema.files)
      .where(eq(schema.files.tenantId, user.tenantId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(meta.id);
    expect(rows[0]!.hashSha256).toBe(meta.hashSha256);

    await built.ingest.drain();

    const fileEvents = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.tenantId, user.tenantId))
      .all();
    expect(fileEvents.some((e) => e.type === 'file.uploaded')).toBe(true);
  });

  test('rejects empty uploads', async () => {
    const { built, accessToken } = await bootstrap();
    const res = await uploadFixture(
      built,
      accessToken,
      new Uint8Array(),
      'empty.txt',
      'text/plain',
    );
    expect(res.status).toBe(400);
  });

  test('rejects duplicate uploads by hash', async () => {
    const { built, accessToken } = await bootstrap();
    const body = new TextEncoder().encode('dup content');
    const first = await uploadFixture(built, accessToken, body, 'a.txt', 'text/plain');
    expect(first.status).toBe(201);
    const second = await uploadFixture(built, accessToken, body, 'a-copy.txt', 'text/plain');
    expect(second.status).toBe(409);
  });

  test('enforces auth', async () => {
    const { built } = await bootstrap();
    const fd = new FormData();
    fd.set('file', new File([new TextEncoder().encode('x')], 'x.txt', { type: 'text/plain' }));
    const res = await built.app.request('/api/files/upload', { method: 'POST', body: fd });
    expect(res.status).toBe(401);
  });
});

describe('S3.3 — ingest worker', () => {
  test('upload → entity with raw_text attribute + entity.created event', async () => {
    const { built, db, accessToken, user } = await bootstrap();
    const body = new TextEncoder().encode('# title\n\nbody text here\n');
    const upload = await uploadFixture(built, accessToken, body, 'doc.md', 'text/markdown');
    expect(upload.status).toBe(201);
    const meta = (await upload.json()) as { id: string };

    await built.ingest.drain();

    const entities = db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.tenantId, user.tenantId))
      .all();
    expect(entities).toHaveLength(1);
    const entity = entities[0]!;
    expect(entity.status).toBe('raw');
    expect(entity.sourceFileId).toBe(meta.id);
    expect(entity.entityType).toBeNull();

    const attrs = db
      .select()
      .from(schema.attributes)
      .where(eq(schema.attributes.entityId, entity.id))
      .all();
    const byKey = new Map(attrs.map((a) => [a.key, a]));
    expect(byKey.get('raw_text')?.valueText).toContain('body text here');
    expect(byKey.get('raw_text')?.valueText).toContain('title');
    expect(byKey.get('source_file_id')?.valueText).toBe(meta.id);
    expect(byKey.get('parse_metadata')?.valueJson).toBeTruthy();

    const events = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.tenantId, user.tenantId))
      .all();
    const entityEvt = events.find((e) => e.type === 'entity.created');
    expect(entityEvt).toBeTruthy();
    expect(JSON.parse(entityEvt!.payloadJson)).toMatchObject({ entityId: entity.id });
  });

  test('files detail endpoint returns extracted text', async () => {
    const { built, accessToken } = await bootstrap();
    const body = new TextEncoder().encode('detail endpoint content');
    const upload = await uploadFixture(built, accessToken, body, 'dt.txt', 'text/plain');
    const meta = (await upload.json()) as { id: string };

    await built.ingest.drain();

    const res = await built.app.request(`/api/files/${meta.id}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      rawText: string | null;
      entity: { id: string; status: string } | null;
    };
    expect(detail.rawText).toContain('detail endpoint content');
    expect(detail.entity?.status).toBe('raw');
  });

  test('entities list/show endpoints work', async () => {
    const { built, accessToken } = await bootstrap();
    const body = new TextEncoder().encode('entities route content');
    await uploadFixture(built, accessToken, body, 'ent.txt', 'text/plain');

    await built.ingest.drain();

    const listRes = await built.app.request('/api/entities', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      entities: Array<{ id: string; status: string }>;
    };
    expect(list.entities.length).toBeGreaterThan(0);
    const first = list.entities[0]!;

    const showRes = await built.app.request(`/api/entities/${first.id}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(showRes.status).toBe(200);
    const detail = (await showRes.json()) as {
      attributes: Array<{ key: string; valueText: string | null }>;
    };
    const raw = detail.attributes.find((a) => a.key === 'raw_text');
    expect(raw?.valueText).toContain('entities route content');
  });
});

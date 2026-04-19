import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { eq } from 'drizzle-orm';
import { EventBus } from './bus.ts';
import type { AnyEnvelope } from './types.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-events-'));
  dbPath = join(tmp, 'test.db');
  runMigrations({ dbUrl: dbPath, migrationsDir: MIGRATIONS_DIR, silent: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeTenant(db: ReturnType<typeof createDb>['db'], slug: string): string {
  const tenantId = newId('tenant');
  db.insert(schema.tenants)
    .values({ id: tenantId, name: slug, slug, settingsJson: '{}', createdAt: new Date() })
    .run();
  return tenantId;
}

describe('EventBus (in-memory)', () => {
  test('emit fires subscriber and is not persisted', async () => {
    const bus = new EventBus();
    const seen: AnyEnvelope[] = [];
    bus.subscribe('file.uploaded', (env) => {
      seen.push(env);
    });

    const env = await bus.emit({
      tenantId: 'tnt_x',
      type: 'file.uploaded',
      payload: {
        fileId: 'fil_1',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        hashSha256: 'h',
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(env.id);
    expect(seen[0]!.type).toBe('file.uploaded');
  });

  test('wildcard subscribers receive all events', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe('*', (env) => {
      seen.push(env.type);
    });
    await bus.emit({
      tenantId: 't',
      type: 'workflow.started',
      payload: { workflowId: 'w', runId: 'r' },
    });
    await bus.emit({
      tenantId: 't',
      type: 'workflow.completed',
      payload: { workflowId: 'w', runId: 'r', status: 'success' },
    });
    expect(seen).toEqual(['workflow.started', 'workflow.completed']);
  });

  test('unsubscribe stops delivery', async () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.subscribe('entity.created', () => {
      count++;
    });
    await bus.emit({
      tenantId: 't',
      type: 'entity.created',
      payload: { entityId: 'e1', entityType: 'doc' },
    });
    off();
    await bus.emit({
      tenantId: 't',
      type: 'entity.created',
      payload: { entityId: 'e2', entityType: 'doc' },
    });
    expect(count).toBe(1);
    expect(bus.listenerCount('entity.created')).toBe(0);
  });

  test('a throwing listener does not break the bus', async () => {
    const bus = new EventBus();
    bus.subscribe('*', () => {
      throw new Error('boom');
    });
    let saw = false;
    bus.subscribe('*', () => {
      saw = true;
    });
    await bus.emit({
      tenantId: 't',
      type: 'report.rendered',
      payload: { reportId: 'r', format: 'pdf' },
    });
    expect(saw).toBe(true);
  });
});

describe('EventBus (persistent)', () => {
  test('emit persists event to events table', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = makeTenant(db, 'acme');

    const bus = new EventBus({ db, persist: true });
    const seen: AnyEnvelope[] = [];
    bus.subscribe('file.uploaded', (env) => {
      seen.push(env);
    });

    const env = await bus.emit({
      tenantId,
      userId: null,
      type: 'file.uploaded',
      payload: {
        fileId: 'fil_abc',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        hashSha256: 'sha',
      },
      metadata: { source: 'test' },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(env.id);

    const rows = db.select().from(schema.events).where(eq(schema.events.id, env.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('file.uploaded');
    expect(rows[0]!.tenantId).toBe(tenantId);
    expect(JSON.parse(rows[0]!.payloadJson).fileId).toBe('fil_abc');
    expect(rows[0]!.metadataJson).not.toBeNull();
    expect(JSON.parse(rows[0]!.metadataJson as string).source).toBe('test');

    sqlite.close();
  });

  test('persist=true without db throws', () => {
    expect(() => new EventBus({ persist: true })).toThrow();
  });
});

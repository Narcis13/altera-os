import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { eq } from 'drizzle-orm';
import { ActivitySubscriber } from './activity-subscriber.ts';
import { EventBus } from './bus.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-activity-'));
  dbPath = join(tmp, 'test.db');
  runMigrations({ dbUrl: dbPath, migrationsDir: MIGRATIONS_DIR, silent: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('ActivitySubscriber', () => {
  test('writes audit_log entry for every event', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = newId('tenant');
    db.insert(schema.tenants)
      .values({ id: tenantId, name: 'a', slug: 'a', settingsJson: '{}', createdAt: new Date() })
      .run();

    const userId = newId('user');
    db.insert(schema.users)
      .values({
        id: userId,
        tenantId,
        username: 'alice',
        email: 'a@a.test',
        passwordHash: 'x',
        role: 'user',
        createdAt: new Date(),
      })
      .run();

    const bus = new EventBus({ db, persist: true });
    const sub = new ActivitySubscriber({ db, bus });
    sub.start();

    await bus.emit({
      tenantId,
      userId,
      type: 'file.uploaded',
      payload: {
        fileId: 'fil_1',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        hashSha256: 'h',
      },
    });

    await bus.emit({
      tenantId,
      userId,
      type: 'entity.created',
      payload: { entityId: 'ent_1', entityType: 'doc' },
    });

    const rows = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tenantId, tenantId))
      .all();

    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['entity.created', 'file.uploaded']);

    const fileRow = rows.find((r) => r.action === 'file.uploaded')!;
    expect(fileRow.resourceType).toBe('file');
    expect(fileRow.resourceId).toBe('fil_1');
    expect(fileRow.userId).toBe(userId);
    expect(JSON.parse(fileRow.afterJson as string).fileId).toBe('fil_1');

    const entRow = rows.find((r) => r.action === 'entity.created')!;
    expect(entRow.resourceType).toBe('entity');
    expect(entRow.resourceId).toBe('ent_1');

    sub.stop();
    sqlite.close();
  });

  test('start is idempotent and stop unsubscribes', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = newId('tenant');
    db.insert(schema.tenants)
      .values({ id: tenantId, name: 'b', slug: 'b', settingsJson: '{}', createdAt: new Date() })
      .run();

    const bus = new EventBus({ db, persist: true });
    const sub = new ActivitySubscriber({ db, bus });
    sub.start();
    sub.start();
    sub.stop();

    await bus.emit({
      tenantId,
      type: 'workflow.started',
      payload: { workflowId: 'w', runId: 'r1' },
    });

    const rows = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(0);

    sqlite.close();
  });
});

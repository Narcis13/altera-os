import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { createEntity, getEntity } from '@altera/eav';
import { EventBus } from '@altera/events';
import { eq } from 'drizzle-orm';
import { ClassifySubscriber, upsertTenantTaxonomy } from './classify-subscriber.ts';
import { MockProvider } from '../providers/mock.ts';
import type { AnyEnvelope } from '@altera/events';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-classify-'));
  dbPath = join(tmp, 'test.db');
  runMigrations({ dbUrl: dbPath, migrationsDir: MIGRATIONS_DIR, silent: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function seedTenant(db: ReturnType<typeof createDb>['db'], slug: string): string {
  const tenantId = newId('tenant');
  db.insert(schema.tenants)
    .values({ id: tenantId, name: slug, slug, settingsJson: '{}', createdAt: new Date() })
    .run();
  return tenantId;
}

describe('ClassifySubscriber', () => {
  test('classifies entity on entity.created and emits entity.classified', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');

    const entity = createEntity(
      { db, tenantId },
      {
        name: 'invoice-2024-001.pdf',
        status: 'raw',
        attributes: [
          {
            key: 'raw_text',
            valueText:
              'INVOICE\nSupplier: Acme Corp\nTotal due: 1234.56 EUR\nDue date: 2024-06-15',
            extractedBy: 'structured_import',
          },
        ],
      },
    );

    const bus = new EventBus({ db, persist: true });

    const provider = new MockProvider((_call, idx) => {
      if (idx === 0) {
        return {
          content: null,
          toolUses: [
            {
              id: 'tu_1',
              name: 'classify_entity',
              input: { entityId: entity.id, entityType: 'invoice', confidence: 0.92 },
            },
          ],
          stopReason: 'tool_use',
        };
      }
      return { content: 'Classified as invoice.', toolUses: [], stopReason: 'end_turn' };
    });

    const captured: AnyEnvelope[] = [];
    bus.subscribe('entity.classified', (env) => {
      captured.push(env);
    });

    const sub = new ClassifySubscriber({ db, bus, provider });
    sub.start();

    await bus.emit({
      tenantId,
      type: 'entity.created',
      payload: { entityId: entity.id, entityType: 'raw' },
    });
    await sub.drain();

    expect(captured).toHaveLength(1);
    const payload = captured[0]!.payload as {
      entityId: string;
      classification: string;
      confidence?: number;
    };
    expect(payload.entityId).toBe(entity.id);
    expect(payload.classification).toBe('invoice');
    expect(payload.confidence).toBe(0.92);

    const reloaded = getEntity({ db, tenantId }, entity.id);
    expect(reloaded?.status).toBe('classified');
    expect(reloaded?.entityType).toBe('invoice');

    const stored = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, 'entity.classified'))
      .all();
    expect(stored).toHaveLength(1);

    sqlite.close();
  });

  test('skips entities without raw_text', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');

    const entity = createEntity({ db, tenantId }, { name: 'empty', status: 'raw' });

    const bus = new EventBus();
    const provider = new MockProvider([]);
    const sub = new ClassifySubscriber({
      db,
      bus,
      provider,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    sub.start();

    await bus.emit({
      tenantId,
      type: 'entity.created',
      payload: { entityId: entity.id, entityType: 'raw' },
    });
    await sub.drain();

    expect(provider.calls).toHaveLength(0);

    sqlite.close();
  });

  test('uses tenant taxonomy when present', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');

    upsertTenantTaxonomy(db, tenantId, [
      { entityType: 'spital_report', description: 'Raport medical intern' },
      { entityType: 'spital_payroll' },
    ]);

    const entity = createEntity(
      { db, tenantId },
      {
        name: 'rapport.pdf',
        status: 'raw',
        attributes: [
          {
            key: 'raw_text',
            valueText: 'Raport al trimestrului pentru sectia cardiologie.',
            extractedBy: 'structured_import',
          },
        ],
      },
    );

    const bus = new EventBus();
    let capturedPrompt = '';

    const provider = new MockProvider((call) => {
      const userMsg = call.messages.find((m) => m.role === 'user');
      capturedPrompt = userMsg?.content ?? '';
      return {
        content: 'done',
        toolUses: [
          {
            id: 'tu_1',
            name: 'classify_entity',
            input: { entityId: entity.id, entityType: 'spital_report', confidence: 0.7 },
          },
        ],
        stopReason: 'tool_use',
      };
    });

    const sub = new ClassifySubscriber({ db, bus, provider });
    sub.start();

    await bus.emit({
      tenantId,
      type: 'entity.created',
      payload: { entityId: entity.id, entityType: 'raw' },
    });
    await sub.drain();

    expect(capturedPrompt).toContain('spital_report');
    expect(capturedPrompt).toContain('spital_payroll');
    expect(capturedPrompt).not.toContain('invoice');

    sqlite.close();
  });
});

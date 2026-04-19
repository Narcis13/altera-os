import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import {
  createEntity,
  deleteEntity,
  getAttributeByKey,
  getAttributes,
  getEntity,
  queryEntities,
  searchFts,
  setAttribute,
  updateEntity,
} from './eav.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-eav-'));
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

describe('createEntity / getEntity', () => {
  test('creates an entity and returns it with tenant scope', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    const entity = createEntity(ctx, {
      entityType: 'invoice',
      name: 'Invoice 2024-001',
      status: 'classified',
      classificationConfidence: 0.9,
    });

    expect(entity.id).toMatch(/^ent_/);
    expect(entity.tenantId).toBe(tenantId);
    expect(entity.entityType).toBe('invoice');
    expect(entity.status).toBe('classified');
    expect(entity.classificationConfidence).toBe(0.9);
    expect(entity.ingestedAt).toBeInstanceOf(Date);

    const loaded = getEntity(ctx, entity.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(entity.id);

    sqlite.close();
  });

  test('getEntity refuses cross-tenant reads', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantA = seedTenant(db, 'acme');
    const tenantB = seedTenant(db, 'beta');

    const entity = createEntity({ db, tenantId: tenantA }, { name: 'A-only' });
    const wrong = getEntity({ db, tenantId: tenantB }, entity.id);
    expect(wrong).toBeNull();

    sqlite.close();
  });

  test('createEntity with inline attributes persists them', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    const entity = createEntity(ctx, {
      entityType: 'report',
      name: 'Q1 report',
      status: 'classified',
      attributes: [
        { key: 'period', valueText: '2024-Q1', extractedBy: 'user' },
        { key: 'total', valueNumber: 12345.67, extractedBy: 'agent', confidence: 0.7 },
        { key: 'meta', valueJson: { tags: ['finance'] }, extractedBy: 'agent' },
      ],
    });

    const attrs = getAttributes(ctx, entity.id);
    expect(attrs).toHaveLength(3);

    const period = attrs.find((a) => a.key === 'period');
    expect(period?.valueText).toBe('2024-Q1');
    expect(period?.extractedBy).toBe('user');

    const total = attrs.find((a) => a.key === 'total');
    expect(total?.valueNumber).toBe(12345.67);
    expect(total?.confidence).toBe(0.7);

    const meta = attrs.find((a) => a.key === 'meta');
    expect(meta?.valueJson).toEqual({ tags: ['finance'] });

    sqlite.close();
  });
});

describe('setAttribute / getAttributes / getAttributeByKey', () => {
  test('setAttribute appends an attribute row', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    const entity = createEntity(ctx, { name: 'doc' });
    const attr = setAttribute(ctx, entity.id, {
      key: 'author',
      valueText: 'Alice',
      extractedBy: 'agent',
      confidence: 0.8,
    });

    expect(attr.id).toMatch(/^atr_/);
    expect(attr.entityId).toBe(entity.id);

    const loaded = getAttributeByKey(ctx, entity.id, 'author');
    expect(loaded?.valueText).toBe('Alice');
    expect(loaded?.extractedBy).toBe('agent');
    expect(loaded?.confidence).toBe(0.8);

    sqlite.close();
  });

  test('setAttribute throws when entity does not exist in tenant', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantA = seedTenant(db, 'acme');
    const tenantB = seedTenant(db, 'beta');

    const entity = createEntity({ db, tenantId: tenantA }, { name: 'A' });

    expect(() =>
      setAttribute({ db, tenantId: tenantB }, entity.id, {
        key: 'foo',
        valueText: 'bar',
        extractedBy: 'user',
      }),
    ).toThrow(/Entity not found/);

    sqlite.close();
  });
});

describe('updateEntity', () => {
  test('patches entity_type / status / classification_confidence', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    const entity = createEntity(ctx, { name: 'doc', status: 'raw' });

    const updated = updateEntity(ctx, entity.id, {
      entityType: 'invoice',
      status: 'classified',
      classificationConfidence: 0.88,
    });
    expect(updated.entityType).toBe('invoice');
    expect(updated.status).toBe('classified');
    expect(updated.classificationConfidence).toBe(0.88);

    const reloaded = getEntity(ctx, entity.id)!;
    expect(reloaded.entityType).toBe('invoice');
    expect(reloaded.status).toBe('classified');
    expect(reloaded.classificationConfidence).toBe(0.88);

    sqlite.close();
  });
});

describe('queryEntities', () => {
  test('filters by entityType and status', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    createEntity(ctx, { entityType: 'invoice', status: 'classified' });
    createEntity(ctx, { entityType: 'invoice', status: 'raw' });
    createEntity(ctx, { entityType: 'report', status: 'classified' });

    const invoices = queryEntities(ctx, { entityType: 'invoice' });
    expect(invoices.total).toBe(2);

    const classified = queryEntities(ctx, { status: 'classified' });
    expect(classified.total).toBe(2);

    const both = queryEntities(ctx, { entityType: 'invoice', status: 'classified' });
    expect(both.total).toBe(1);

    sqlite.close();
  });

  test('filters by attribute equalsText', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    createEntity(ctx, {
      entityType: 'invoice',
      attributes: [{ key: 'period', valueText: '2024-Q1', extractedBy: 'user' }],
    });
    createEntity(ctx, {
      entityType: 'invoice',
      attributes: [{ key: 'period', valueText: '2024-Q2', extractedBy: 'user' }],
    });

    const q1 = queryEntities(ctx, {
      attributes: [{ key: 'period', equalsText: '2024-Q1' }],
    });
    expect(q1.total).toBe(1);
    expect(q1.entities[0]!.entityType).toBe('invoice');

    sqlite.close();
  });

  test('pagination and ordering', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    for (let i = 0; i < 5; i++) {
      createEntity(ctx, { name: `doc-${i}` });
    }
    const first = queryEntities(ctx, { limit: 2, offset: 0 });
    expect(first.entities).toHaveLength(2);
    expect(first.total).toBe(5);

    const second = queryEntities(ctx, { limit: 2, offset: 2 });
    expect(second.entities).toHaveLength(2);
    expect(first.entities.map((e) => e.id)).not.toEqual(
      second.entities.map((e) => e.id),
    );

    sqlite.close();
  });
});

describe('FTS search', () => {
  test('searchFts finds attributes by keyword', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    const entityA = createEntity(ctx, {
      name: 'report-a',
      attributes: [
        {
          key: 'raw_text',
          valueText: 'Quarterly financial report for hospital departments.',
          extractedBy: 'structured_import',
        },
      ],
    });
    createEntity(ctx, {
      name: 'report-b',
      attributes: [
        {
          key: 'raw_text',
          valueText: 'Logistics inventory counts.',
          extractedBy: 'structured_import',
        },
      ],
    });

    const hits = searchFts(ctx, 'financial');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.entityId).toBe(entityA.id);
    expect(hits[0]!.snippet).toContain('[financial]');

    const none = searchFts(ctx, 'vaccine');
    expect(none).toHaveLength(0);

    sqlite.close();
  });

  test('queryEntities with search filter', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    createEntity(ctx, {
      name: 'wanted',
      entityType: 'report',
      attributes: [
        {
          key: 'raw_text',
          valueText: 'Annual medication inventory.',
          extractedBy: 'structured_import',
        },
      ],
    });
    createEntity(ctx, {
      name: 'other',
      entityType: 'report',
      attributes: [
        {
          key: 'raw_text',
          valueText: 'Payroll statements.',
          extractedBy: 'structured_import',
        },
      ],
    });

    const result = queryEntities(ctx, { search: 'medication' });
    expect(result.total).toBe(1);
    expect(result.entities[0]!.name).toBe('wanted');

    sqlite.close();
  });

  test('FTS is tenant-scoped', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantA = seedTenant(db, 'acme');
    const tenantB = seedTenant(db, 'beta');

    createEntity(
      { db, tenantId: tenantA },
      {
        attributes: [
          { key: 'raw_text', valueText: 'secret memo alpha', extractedBy: 'user' },
        ],
      },
    );

    const fromB = searchFts({ db, tenantId: tenantB }, 'alpha');
    expect(fromB).toHaveLength(0);

    const fromA = searchFts({ db, tenantId: tenantA }, 'alpha');
    expect(fromA.length).toBeGreaterThan(0);

    sqlite.close();
  });

  test('deleting an entity drops its FTS rows', () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx = { db, tenantId };

    const entity = createEntity(ctx, {
      attributes: [
        { key: 'raw_text', valueText: 'unique-zeta-keyword', extractedBy: 'user' },
      ],
    });

    const before = searchFts(ctx, 'zeta');
    expect(before.length).toBeGreaterThan(0);

    deleteEntity(ctx, entity.id);

    const after = searchFts(ctx, 'zeta');
    expect(after).toHaveLength(0);

    sqlite.close();
  });
});

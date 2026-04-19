import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { createEntity, getEntity } from '@altera/eav';
import {
  createClassifyEntityTool,
  createQueryEntitiesTool,
  createSanitizeThenCallTool,
  createSetAttributeTool,
} from './eav-tools.ts';
import { sanitizeText } from './sanitize.ts';
import type { ToolContext } from '../types.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-agent-tools-'));
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

describe('sanitizeText', () => {
  test('masks common PII patterns', () => {
    const { sanitized, replacements } = sanitizeText(
      'Contact alice@example.com or +40 721 123 456 for invoice RO12345678 in IBAN RO49AAAA1B31007593840000.',
    );
    expect(sanitized).not.toContain('alice@example.com');
    expect(sanitized).toContain('[EMAIL_1]');
    expect(replacements.some((r) => r.kind === 'email')).toBe(true);
    expect(replacements.some((r) => r.kind === 'iban')).toBe(true);
    expect(replacements.some((r) => r.kind === 'cui')).toBe(true);
  });

  test('leaves benign text alone', () => {
    const out = sanitizeText('The quarterly report shows growth of 3 percent.');
    expect(out.sanitized).toBe('The quarterly report shows growth of 3 percent.');
    expect(out.replacements).toHaveLength(0);
  });
});

describe('sanitize_then_call tool', () => {
  test('schema + execute', async () => {
    const tool = createSanitizeThenCallTool();
    const ctx: ToolContext = { tenantId: 'tnt_x' };
    const parsed = tool.parameters.parse({ text: 'ping alice@example.com' });
    const out = await tool.execute(parsed as never, ctx);
    const parsedOut = JSON.parse(out) as {
      sanitized: string;
      replacements: Array<{ kind: string; placeholder: string }>;
    };
    expect(parsedOut.sanitized).toContain('[EMAIL_1]');
    expect(parsedOut.replacements[0]!.kind).toBe('email');
  });
});

describe('query_entities tool', () => {
  test('returns filtered entities as JSON', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx: ToolContext = { tenantId };

    createEntity({ db, tenantId }, { entityType: 'invoice', name: 'A' });
    createEntity({ db, tenantId }, { entityType: 'report', name: 'B' });

    const tool = createQueryEntitiesTool({ db });
    const out = await tool.execute(
      tool.parameters.parse({ entityType: 'invoice' }) as never,
      ctx,
    );
    const parsed = JSON.parse(out) as { total: number; entities: Array<{ name: string }> };
    expect(parsed.total).toBe(1);
    expect(parsed.entities[0]!.name).toBe('A');

    sqlite.close();
  });

  test('includeAttributes attaches attributes', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx: ToolContext = { tenantId };

    createEntity(
      { db, tenantId },
      {
        name: 'A',
        attributes: [{ key: 'foo', valueText: 'bar', extractedBy: 'user' }],
      },
    );

    const tool = createQueryEntitiesTool({ db });
    const parsedArgs = tool.parameters.parse({ includeAttributes: true });
    const out = await tool.execute(parsedArgs as never, ctx);
    const parsed = JSON.parse(out) as {
      entities: Array<{ attributes?: Array<{ key: string }> }>;
    };
    expect(parsed.entities[0]!.attributes?.[0]!.key).toBe('foo');

    sqlite.close();
  });
});

describe('set_attribute tool', () => {
  test('writes an attribute', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx: ToolContext = { tenantId };

    const entity = createEntity({ db, tenantId }, { name: 'doc' });
    const tool = createSetAttributeTool({ db });
    const parsed = tool.parameters.parse({
      entityId: entity.id,
      key: 'author',
      valueText: 'Alice',
      extractedBy: 'agent',
      confidence: 0.9,
    });
    const out = await tool.execute(parsed as never, ctx);
    const body = JSON.parse(out) as { key: string };
    expect(body.key).toBe('author');

    sqlite.close();
  });

  test('returns error for unknown entity', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx: ToolContext = { tenantId };

    const tool = createSetAttributeTool({ db });
    const parsed = tool.parameters.parse({
      entityId: 'ent_missing',
      key: 'foo',
      valueText: 'bar',
      extractedBy: 'agent',
    });
    const out = await tool.execute(parsed as never, ctx);
    expect(out).toMatch(/not found/);

    sqlite.close();
  });
});

describe('classify_entity tool', () => {
  test('marks entity as classified', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    const tenantId = seedTenant(db, 'acme');
    const ctx: ToolContext = { tenantId };

    const entity = createEntity({ db, tenantId }, { name: 'doc', status: 'raw' });
    const tool = createClassifyEntityTool({ db });
    const parsed = tool.parameters.parse({
      entityId: entity.id,
      entityType: 'medical_report',
      confidence: 0.81,
    });
    const out = await tool.execute(parsed as never, ctx);
    const body = JSON.parse(out) as {
      entityType: string;
      status: string;
      classificationConfidence: number;
    };
    expect(body.entityType).toBe('medical_report');
    expect(body.status).toBe('classified');
    expect(body.classificationConfidence).toBe(0.81);

    const reloaded = getEntity({ db, tenantId }, entity.id);
    expect(reloaded?.status).toBe('classified');

    sqlite.close();
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from './client.ts';
import { newId } from './ids.ts';
import { runMigrations } from './migrate.ts';
import { tenants, users } from './schema/index.ts';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'altera-db-'));
  dbPath = join(tmpDir, 'test.db');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrations', () => {
  test('runMigrations creates core tables', () => {
    const res = runMigrations({ dbUrl: dbPath, silent: true });
    expect(res.applied).toContain('0000_init');

    const { db, sqlite } = createDb({ url: dbPath });
    const rows = sqlite
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);

    expect(rows).toContain('tenants');
    expect(rows).toContain('users');
    expect(rows).toContain('sessions');
    expect(rows).toContain('audit_log');
    expect(rows).toContain('files');
    sqlite.close();
    void db;
  });

  test('runMigrations is idempotent', () => {
    runMigrations({ dbUrl: dbPath, silent: true });
    const second = runMigrations({ dbUrl: dbPath, silent: true });
    expect(second.applied).toHaveLength(0);
  });
});

describe('tenant + user CRUD', () => {
  test('insert + select round-trip with tenant FK', () => {
    runMigrations({ dbUrl: dbPath, silent: true });
    const { db, sqlite } = createDb({ url: dbPath });

    const tenantId = newId('tenant');
    db.insert(tenants)
      .values({
        id: tenantId,
        name: 'Acme',
        slug: 'acme',
        settingsJson: '{}',
        createdAt: new Date(),
      })
      .run();

    const userId = newId('user');
    db.insert(users)
      .values({
        id: userId,
        tenantId,
        username: 'alice',
        email: 'alice@acme.test',
        passwordHash: 'x',
        role: 'admin',
        createdAt: new Date(),
      })
      .run();

    const found = db.select().from(users).where(eq(users.id, userId)).all();
    expect(found).toHaveLength(1);
    expect(found[0]!.tenantId).toBe(tenantId);
    expect(found[0]!.role).toBe('admin');

    sqlite.close();
  });

  test('foreign key rejects orphan user', () => {
    runMigrations({ dbUrl: dbPath, silent: true });
    const { db, sqlite } = createDb({ url: dbPath });

    expect(() =>
      db
        .insert(users)
        .values({
          id: newId('user'),
          tenantId: 'nonexistent',
          username: 'x',
          email: 'x@y.z',
          passwordHash: 'h',
          role: 'user',
          createdAt: new Date(),
        })
        .run(),
    ).toThrow();
    sqlite.close();
  });
});

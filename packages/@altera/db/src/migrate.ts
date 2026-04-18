#!/usr/bin/env bun
/**
 * Simple SQL-file migrator.
 * Reads migrations/*.sql in lexical order, runs each once, tracks applied IDs in `_migrations`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { openSqlite } from './client.ts';

export interface MigrateOptions {
  dbUrl?: string;
  migrationsDir?: string;
  silent?: boolean;
}

export function runMigrations(opts: MigrateOptions = {}): { applied: string[]; skipped: string[] } {
  const migrationsDir = opts.migrationsDir ?? resolve(process.cwd(), 'migrations');
  const sqlite = openSqlite({ url: opts.dbUrl });
  const log = opts.silent ? () => {} : console.log.bind(console);

  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);',
  );

  const appliedIds = new Set(
    sqlite
      .query<{ id: string }, []>('SELECT id FROM _migrations')
      .all()
      .map((r) => r.id),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const id = basename(file, '.sql');
    if (appliedIds.has(id)) {
      skipped.push(id);
      continue;
    }
    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
    log(`[migrate] Applying ${id} …`);
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.query('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
    })();
    applied.push(id);
  }

  log(`[migrate] Applied ${applied.length} migration(s); ${skipped.length} already current.`);
  sqlite.close();
  return { applied, skipped };
}

if (import.meta.main) {
  runMigrations();
}

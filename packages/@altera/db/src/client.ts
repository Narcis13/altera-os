import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema/index.ts';

export type AlteraDb = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDbOptions {
  url?: string;
  readonly?: boolean;
}

export function openSqlite(options: OpenDbOptions = {}): Database {
  const url = options.url ?? process.env.DATABASE_URL ?? './data/altera.db';
  const sqlite = new Database(url, { create: !options.readonly, readonly: options.readonly });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA synchronous = NORMAL;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');
  return sqlite;
}

export function createDb(options: OpenDbOptions = {}): { db: AlteraDb; sqlite: Database } {
  const sqlite = openSqlite(options);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export { schema };

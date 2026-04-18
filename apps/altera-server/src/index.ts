#!/usr/bin/env bun
import { createDb, runMigrations } from '@altera/db';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

// Run migrations on startup for dev ergonomics. Production should run `bun run migrate` explicitly.
runMigrations({ dbUrl: config.databaseUrl });

const { db } = createDb({ url: config.databaseUrl });
const app = buildApp({ db, config });

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
});

console.log(`[altera-server] listening on http://${server.hostname}:${server.port}`);
console.log(`[altera-server] env=${config.env} db=${config.databaseUrl}`);

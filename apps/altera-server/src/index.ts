#!/usr/bin/env bun
import { resolve } from 'node:path';
import { verifyToken, type JwtConfig } from '@altera/auth';
import { createDb, runMigrations } from '@altera/db';
import type { WsClientData } from '@altera/events';
import { buildAppWithBus } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

runMigrations({
  dbUrl: config.databaseUrl,
  migrationsDir: resolve(import.meta.dir, '../../../migrations'),
});

const { db } = createDb({ url: config.databaseUrl });
const built = buildAppWithBus({ db, config });

const jwt: JwtConfig = {
  secret: config.jwtSecret,
  accessTtlSec: config.jwtAccessTtlSec,
  refreshTtlSec: config.jwtRefreshTtlSec,
};

const server = Bun.serve<WsClientData>({
  port: config.port,
  hostname: config.host,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/api/events/ws') {
      const tokenFromQs = url.searchParams.get('access_token');
      let tenantId: string | undefined;
      if (tokenFromQs) {
        try {
          const claims = await verifyToken(jwt, tokenFromQs);
          if (claims.typ === 'access') tenantId = claims.tid;
        } catch {
          /* fallthrough */
        }
      } else {
        const auth = req.headers.get('authorization');
        const m = auth?.match(/^Bearer\s+(.+)$/i);
        if (m) {
          try {
            const claims = await verifyToken(jwt, m[1] as string);
            if (claims.typ === 'access') tenantId = claims.tid;
          } catch {
            /* fallthrough */
          }
        }
      }

      if (!tenantId) {
        return new Response(
          JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'WS auth required' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }

      const topics = (url.searchParams.get('topics') ?? '*')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const data = built.ws.newClientData({ tenantId, topics: topics as never });
      if (srv.upgrade(req, { data })) return undefined;
      return new Response('upgrade failed', { status: 400 });
    }

    return built.app.fetch(req);
  },
  websocket: {
    open(ws) {
      built.ws.onOpen(ws);
    },
    message(ws, message) {
      built.ws.onMessage(ws, message as string | Buffer);
    },
    close(ws) {
      built.ws.onClose(ws);
    },
  },
});

console.log(`[altera-server] listening on http://${server.hostname}:${server.port}`);
console.log(`[altera-server] env=${config.env} db=${config.databaseUrl}`);

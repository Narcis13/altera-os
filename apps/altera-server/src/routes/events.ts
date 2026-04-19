import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import {
  type EventBus,
  type EventTopic,
  type SseManager,
  isEventType,
} from '@altera/events';
import { Hono } from 'hono';
import { verifyToken } from '@altera/auth';

export interface EventsRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
  bus: EventBus;
  sse: SseManager;
}

function parseTopics(raw: string | null): EventTopic[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as EventTopic[];
}

export function eventsRoutes(deps: EventsRoutesDeps): Hono {
  const app = new Hono();

  // SSE endpoint. Browsers can't set Authorization on EventSource — accept
  // ?access_token= for that case, otherwise fall back to the standard middleware.
  app.get('/stream', async (c) => {
    const url = new URL(c.req.url);
    const tokenFromQs = url.searchParams.get('access_token');

    let tenantId: string;
    if (tokenFromQs) {
      try {
        const claims = await verifyToken(deps.jwt, tokenFromQs);
        if (claims.typ !== 'access') throw new Error('wrong type');
        tenantId = claims.tid;
      } catch {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access_token' } }, 401);
      }
    } else {
      const auth = c.req.header('authorization');
      if (!auth) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }, 401);
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Bad bearer' } }, 401);
      try {
        const claims = await verifyToken(deps.jwt, m[1] as string);
        tenantId = claims.tid;
      } catch {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401);
      }
    }

    const topics = parseTopics(url.searchParams.get('topics'));
    const lastEventId = c.req.header('last-event-id') ?? undefined;

    return deps.sse.subscribe({
      tenantId,
      topics,
      ...(lastEventId ? { lastEventId } : {}),
    });
  });

  // Authenticated debug emit — lets the admin UI fire events to validate the pipeline.
  const protectedRoutes = new Hono();
  protectedRoutes.use('*', requireAuth(deps));
  protectedRoutes.use('*', withTenant(deps));

  protectedRoutes.post('/debug-emit', async (c) => {
    const body = (await c.req.json()) as { type?: string; payload?: unknown };
    if (!body.type || !isEventType(body.type)) {
      throw validationError('Unknown event type', { type: body.type });
    }
    const principal = c.get('principal');
    const env = await deps.bus.emit({
      tenantId: principal.tenantId,
      userId: principal.userId,
      type: body.type as never,
      payload: (body.payload ?? {}) as never,
      metadata: { source: 'debug-emit' },
    });
    return c.json({ id: env.id, type: env.type, createdAt: env.createdAt.toISOString() });
  });

  app.route('/', protectedRoutes);
  return app;
}

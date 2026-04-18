import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.res.headers.set('x-request-id', requestId);
    const start = performance.now();

    try {
      await next();
    } finally {
      const ms = Math.round(performance.now() - start);
      const status = c.res.status;
      // Keep it single-line, trivially greppable.
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          requestId,
          method: c.req.method,
          path: c.req.path,
          status,
          ms,
        }),
      );
    }
  };
}

export function corsMiddleware(origins: string[]): MiddlewareHandler {
  const allowAll = origins.includes('*');
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && (allowAll || origins.includes(origin))) {
      c.res.headers.set('access-control-allow-origin', origin);
      c.res.headers.set('access-control-allow-credentials', 'true');
      c.res.headers.set('vary', 'Origin');
      c.res.headers.set(
        'access-control-allow-headers',
        'authorization, content-type, x-tenant, x-request-id',
      );
      c.res.headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
    return;
  };
}

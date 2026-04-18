import { Hono } from 'hono';

export function healthRoutes(): Hono {
  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      ok: true,
      service: 'altera-server',
      uptime: process.uptime(),
      now: new Date().toISOString(),
    }),
  );

  return app;
}

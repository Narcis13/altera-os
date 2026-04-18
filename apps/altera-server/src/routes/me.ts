import { type JwtConfig, getUserById, requireAuth, withTenant } from '@altera/auth';
import { notFound } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { Hono } from 'hono';

export interface MeRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

export function meRoutes(deps: MeRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.get('/', async (c) => {
    const principal = c.get('principal');
    const user = await getUserById(deps, principal.userId, principal.tenantId);
    if (!user) throw notFound('User not found');
    return c.json({ user, tenantSlug: c.get('tenantSlug') });
  });

  return app;
}

import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { schema } from '@altera/db';
import { loadClassifyDocumentSkill, upsertTenantTaxonomy } from '@altera/agent';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

export interface TaxonomyRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

const bodySchema = z.object({
  entries: z.array(
    z.object({
      entityType: z.string().min(1).max(128),
      description: z.string().max(500).optional(),
    }),
  ),
  replace: z.boolean().optional(),
});

export function taxonomyRoutes(deps: TaxonomyRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.get('/', (c) => {
    const principal = c.get('principal');
    const rows = deps.db
      .select()
      .from(schema.entityTaxonomy)
      .where(eq(schema.entityTaxonomy.tenantId, principal.tenantId))
      .all();
    const defaults = loadClassifyDocumentSkill().defaultTaxonomy;
    return c.json({
      entries: rows.map((r) => ({
        entityType: r.entityType,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
      })),
      defaults,
    });
  });

  app.put('/', async (c) => {
    const principal = c.get('principal');
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError('Invalid taxonomy body', parsed.error.errors);

    if (parsed.data.replace) {
      deps.db
        .delete(schema.entityTaxonomy)
        .where(eq(schema.entityTaxonomy.tenantId, principal.tenantId))
        .run();
    }
    upsertTenantTaxonomy(
      deps.db,
      principal.tenantId,
      parsed.data.entries.map((e) => ({
        entityType: e.entityType,
        ...(e.description !== undefined ? { description: e.description } : {}),
      })),
    );

    const rows = deps.db
      .select()
      .from(schema.entityTaxonomy)
      .where(eq(schema.entityTaxonomy.tenantId, principal.tenantId))
      .all();
    return c.json({
      entries: rows.map((r) => ({
        entityType: r.entityType,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  return app;
}

import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { notFound } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { schema } from '@altera/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

export interface EntitiesRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

export function entitiesRoutes(deps: EntitiesRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.get('/', (c) => {
    const principal = c.get('principal');
    const url = new URL(c.req.url);
    const limit = Math.min(
      Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
      200,
    );
    const offset = Math.max(
      Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0,
      0,
    );

    const rows = deps.db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.tenantId, principal.tenantId))
      .orderBy(desc(schema.entities.ingestedAt))
      .limit(limit)
      .offset(offset)
      .all();

    return c.json({
      entities: rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        name: r.name,
        status: r.status,
        sourceFileId: r.sourceFileId,
        ingestedAt: r.ingestedAt.toISOString(),
      })),
      limit,
      offset,
    });
  });

  app.get('/:id', (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');

    const entity = deps.db
      .select()
      .from(schema.entities)
      .where(
        and(eq(schema.entities.id, id), eq(schema.entities.tenantId, principal.tenantId)),
      )
      .get();
    if (!entity) throw notFound('Entity not found');

    const attrs = deps.db
      .select()
      .from(schema.attributes)
      .where(eq(schema.attributes.entityId, entity.id))
      .all();

    return c.json({
      entity: {
        id: entity.id,
        entityType: entity.entityType,
        name: entity.name,
        status: entity.status,
        sourceFileId: entity.sourceFileId,
        classificationConfidence: entity.classificationConfidence,
        ingestedAt: entity.ingestedAt.toISOString(),
      },
      attributes: attrs.map((a) => ({
        id: a.id,
        key: a.key,
        valueText: a.valueText,
        valueNumber: a.valueNumber,
        valueDate: a.valueDate ? a.valueDate.toISOString() : null,
        valueJson: a.valueJson ? (tryParseJson(a.valueJson) ?? a.valueJson) : null,
        isSensitive: a.isSensitive,
        extractedBy: a.extractedBy,
        confidence: a.confidence,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  });

  return app;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

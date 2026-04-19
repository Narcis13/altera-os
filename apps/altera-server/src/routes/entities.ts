import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { notFound, validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { getAttributes, getEntity, queryEntities, searchFts } from '@altera/eav';
import type { EntityQuery } from '@altera/eav';
import { Hono } from 'hono';

export interface EntitiesRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

function parseQuery(url: URL): EntityQuery {
  const q: EntityQuery = {};
  const entityType = url.searchParams.get('entityType');
  if (entityType) q.entityType = entityType;
  const sourceFileId = url.searchParams.get('sourceFileId');
  if (sourceFileId) q.sourceFileId = sourceFileId;
  const status = url.searchParams.getAll('status');
  if (status.length === 1) q.status = status[0] as EntityQuery['status'];
  else if (status.length > 1) q.status = status as never;
  const search = url.searchParams.get('search');
  if (search) q.search = search;
  const ingestedAfter = url.searchParams.get('ingestedAfter');
  if (ingestedAfter) q.ingestedAfter = new Date(ingestedAfter);
  const ingestedBefore = url.searchParams.get('ingestedBefore');
  if (ingestedBefore) q.ingestedBefore = new Date(ingestedBefore);
  const orderBy = url.searchParams.get('orderBy');
  if (orderBy === 'ingestedAt:asc' || orderBy === 'ingestedAt:desc') q.orderBy = orderBy;
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  if (Number.isFinite(limit)) q.limit = limit;
  const offset = Number.parseInt(url.searchParams.get('offset') ?? '', 10);
  if (Number.isFinite(offset)) q.offset = offset;
  return q;
}

export function entitiesRoutes(deps: EntitiesRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.get('/', (c) => {
    const principal = c.get('principal');
    const url = new URL(c.req.url);
    const result = queryEntities(
      { db: deps.db, tenantId: principal.tenantId },
      parseQuery(url),
    );
    return c.json({
      entities: result.entities.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        name: r.name,
        status: r.status,
        classificationConfidence: r.classificationConfidence,
        sourceFileId: r.sourceFileId,
        ingestedAt: r.ingestedAt.toISOString(),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.get('/search', (c) => {
    const principal = c.get('principal');
    const url = new URL(c.req.url);
    const text = url.searchParams.get('q') ?? '';
    if (text.trim().length === 0) throw validationError('Missing "q" query param');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    const ctx = { db: deps.db, tenantId: principal.tenantId };
    const hits = searchFts(ctx, text, { limit });
    return c.json({
      query: text,
      hits: hits.map((h) => ({
        entityId: h.entityId,
        attributeId: h.attributeId,
        key: h.key,
        snippet: h.snippet,
        rank: h.rank,
      })),
    });
  });

  app.get('/:id', (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');
    const ctx = { db: deps.db, tenantId: principal.tenantId };
    const entity = getEntity(ctx, id);
    if (!entity) throw notFound('Entity not found');
    const attrs = getAttributes(ctx, entity.id);
    return c.json({
      entity: {
        id: entity.id,
        entityType: entity.entityType,
        name: entity.name,
        status: entity.status,
        classificationConfidence: entity.classificationConfidence,
        sourceFileId: entity.sourceFileId,
        ingestedAt: entity.ingestedAt.toISOString(),
      },
      attributes: attrs.map((a) => ({
        id: a.id,
        key: a.key,
        valueText: a.valueText,
        valueNumber: a.valueNumber,
        valueDate: a.valueDate ? a.valueDate.toISOString() : null,
        valueJson: a.valueJson,
        isSensitive: a.isSensitive,
        extractedBy: a.extractedBy,
        confidence: a.confidence,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  });

  return app;
}

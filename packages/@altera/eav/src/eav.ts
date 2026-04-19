import { notFound, validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { and, asc, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm';
import type {
  Attribute,
  AttributeFilter,
  AttributeInput,
  CreateEntityInput,
  Entity,
  EntityQuery,
  EntityQueryResult,
  FtsHit,
  UpdateEntityInput,
} from './types.ts';

export interface EavContext {
  db: AlteraDb;
  tenantId: string;
}

function rowToEntity(row: typeof schema.entities.$inferSelect): Entity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceFileId: row.sourceFileId,
    entityType: row.entityType,
    name: row.name,
    status: row.status,
    classificationConfidence: row.classificationConfidence,
    ingestedAt: row.ingestedAt,
  };
}

function rowToAttribute(row: typeof schema.attributes.$inferSelect): Attribute {
  let parsedJson: unknown = null;
  if (row.valueJson) {
    try {
      parsedJson = JSON.parse(row.valueJson);
    } catch {
      parsedJson = null;
    }
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityId: row.entityId,
    key: row.key,
    valueText: row.valueText,
    valueNumber: row.valueNumber,
    valueDate: row.valueDate,
    valueJson: parsedJson,
    isSensitive: row.isSensitive,
    extractedBy: row.extractedBy,
    confidence: row.confidence,
    createdAt: row.createdAt,
  };
}

function buildAttributeRow(ctx: EavContext, entityId: string, input: AttributeInput, now: Date) {
  if (!input.key || input.key.length === 0) {
    throw validationError('Attribute key is required');
  }
  return {
    id: newId('attribute'),
    tenantId: ctx.tenantId,
    entityId,
    key: input.key,
    valueText: input.valueText ?? null,
    valueNumber: input.valueNumber ?? null,
    valueDate: input.valueDate ?? null,
    valueJson: input.valueJson === undefined ? null : JSON.stringify(input.valueJson),
    isSensitive: input.isSensitive ?? false,
    extractedBy: input.extractedBy,
    confidence: input.confidence ?? null,
    createdAt: now,
  };
}

export function createEntity(ctx: EavContext, input: CreateEntityInput): Entity {
  const id = newId('entity');
  const now = new Date();
  const status = input.status ?? 'raw';

  const row = {
    id,
    tenantId: ctx.tenantId,
    sourceFileId: input.sourceFileId ?? null,
    entityType: input.entityType ?? null,
    name: input.name ?? null,
    status,
    classificationConfidence: input.classificationConfidence ?? null,
    ingestedAt: now,
  };

  ctx.db.insert(schema.entities).values(row).run();

  if (input.attributes && input.attributes.length > 0) {
    const rows = input.attributes.map((a) => buildAttributeRow(ctx, id, a, now));
    ctx.db.insert(schema.attributes).values(rows).run();
  }

  return rowToEntity(row);
}

export function getEntity(ctx: EavContext, entityId: string): Entity | null {
  const row = ctx.db
    .select()
    .from(schema.entities)
    .where(and(eq(schema.entities.id, entityId), eq(schema.entities.tenantId, ctx.tenantId)))
    .get();
  return row ? rowToEntity(row) : null;
}

export function updateEntity(
  ctx: EavContext,
  entityId: string,
  patch: UpdateEntityInput,
): Entity {
  const existing = getEntity(ctx, entityId);
  if (!existing) throw notFound('Entity not found');

  const values: Partial<typeof schema.entities.$inferInsert> = {};
  if (patch.entityType !== undefined) values.entityType = patch.entityType;
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.classificationConfidence !== undefined) {
    values.classificationConfidence = patch.classificationConfidence;
  }
  if (Object.keys(values).length === 0) return existing;

  ctx.db
    .update(schema.entities)
    .set(values)
    .where(and(eq(schema.entities.id, entityId), eq(schema.entities.tenantId, ctx.tenantId)))
    .run();

  return { ...existing, ...patch } as Entity;
}

export function setAttribute(
  ctx: EavContext,
  entityId: string,
  input: AttributeInput,
): Attribute {
  const entity = getEntity(ctx, entityId);
  if (!entity) throw notFound('Entity not found');

  const now = new Date();
  const row = buildAttributeRow(ctx, entityId, input, now);
  ctx.db.insert(schema.attributes).values(row).run();
  return rowToAttribute(row);
}

export function getAttributes(ctx: EavContext, entityId: string): Attribute[] {
  const rows = ctx.db
    .select()
    .from(schema.attributes)
    .where(
      and(eq(schema.attributes.entityId, entityId), eq(schema.attributes.tenantId, ctx.tenantId)),
    )
    .orderBy(asc(schema.attributes.createdAt))
    .all();
  return rows.map(rowToAttribute);
}

export function getAttributeByKey(
  ctx: EavContext,
  entityId: string,
  key: string,
): Attribute | null {
  const row = ctx.db
    .select()
    .from(schema.attributes)
    .where(
      and(
        eq(schema.attributes.entityId, entityId),
        eq(schema.attributes.tenantId, ctx.tenantId),
        eq(schema.attributes.key, key),
      ),
    )
    .orderBy(desc(schema.attributes.createdAt))
    .limit(1)
    .get();
  return row ? rowToAttribute(row) : null;
}

export function deleteEntity(ctx: EavContext, entityId: string): void {
  const existing = getEntity(ctx, entityId);
  if (!existing) return;
  ctx.db
    .delete(schema.entities)
    .where(and(eq(schema.entities.id, entityId), eq(schema.entities.tenantId, ctx.tenantId)))
    .run();
}

export function queryEntities(ctx: EavContext, query: EntityQuery = {}): EntityQueryResult {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  let matchingIds: string[] | null = null;
  if (query.search && query.search.trim().length > 0) {
    const hits = searchFts(ctx, query.search);
    matchingIds = Array.from(new Set(hits.map((h) => h.entityId)));
    if (matchingIds.length === 0) {
      return { entities: [], total: 0, limit, offset };
    }
  }

  if (query.attributes && query.attributes.length > 0) {
    const idsFromAttrs = filterByAttributes(ctx, query.attributes);
    if (matchingIds) {
      const setB = new Set(idsFromAttrs);
      matchingIds = matchingIds.filter((id) => setB.has(id));
    } else {
      matchingIds = idsFromAttrs;
    }
    if (matchingIds.length === 0) {
      return { entities: [], total: 0, limit, offset };
    }
  }

  const where = buildEntityWhere(ctx.tenantId, query, matchingIds);
  const orderCol =
    query.orderBy === 'ingestedAt:asc'
      ? asc(schema.entities.ingestedAt)
      : desc(schema.entities.ingestedAt);

  const rows = ctx.db
    .select()
    .from(schema.entities)
    .where(where)
    .orderBy(orderCol)
    .limit(limit)
    .offset(offset)
    .all();

  const countRows = ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(schema.entities)
    .where(where)
    .all();
  const total = Number(countRows[0]?.count ?? 0);

  return {
    entities: rows.map(rowToEntity),
    total,
    limit,
    offset,
  };
}

function buildEntityWhere(
  tenantId: string,
  query: EntityQuery,
  restrictIds: string[] | null,
) {
  const clauses = [eq(schema.entities.tenantId, tenantId)];
  if (query.entityType) clauses.push(eq(schema.entities.entityType, query.entityType));
  if (query.sourceFileId) clauses.push(eq(schema.entities.sourceFileId, query.sourceFileId));
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    if (statuses.length === 1) {
      clauses.push(eq(schema.entities.status, statuses[0]!));
    } else if (statuses.length > 1) {
      clauses.push(inArray(schema.entities.status, statuses));
    }
  }
  if (query.ingestedAfter) clauses.push(gte(schema.entities.ingestedAt, query.ingestedAfter));
  if (query.ingestedBefore) clauses.push(lte(schema.entities.ingestedAt, query.ingestedBefore));
  if (restrictIds) clauses.push(inArray(schema.entities.id, restrictIds));
  return and(...clauses);
}

function filterByAttributes(ctx: EavContext, filters: AttributeFilter[]): string[] {
  let ids: Set<string> | null = null;
  for (const f of filters) {
    const clauses = [
      eq(schema.attributes.tenantId, ctx.tenantId),
      eq(schema.attributes.key, f.key),
    ];
    if (f.equalsText !== undefined) clauses.push(eq(schema.attributes.valueText, f.equalsText));
    if (f.equalsNumber !== undefined) {
      clauses.push(eq(schema.attributes.valueNumber, f.equalsNumber));
    }
    if (f.contains !== undefined) {
      clauses.push(like(schema.attributes.valueText, `%${f.contains}%`));
    }

    const rows = ctx.db
      .select({ entityId: schema.attributes.entityId })
      .from(schema.attributes)
      .where(and(...clauses))
      .all();
    const hit = new Set<string>(rows.map((r) => r.entityId));
    if (ids === null) {
      ids = hit;
    } else {
      const prev = ids;
      const next = new Set<string>();
      for (const id of prev) if (hit.has(id)) next.add(id);
      ids = next;
    }
    if (ids.size === 0) return [];
  }
  return ids ? Array.from(ids) : [];
}

const FTS_SANITIZE_RE = /[\"'()]/g;

function buildFtsMatch(input: string): string {
  const tokens = input
    .replace(FTS_SANITIZE_RE, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export function searchFts(
  ctx: EavContext,
  text: string,
  options: { limit?: number } = {},
): FtsHit[] {
  const match = buildFtsMatch(text);
  if (!match) return [];
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  const rows = ctx.db.all<{
    attribute_id: string;
    entity_id: string;
    key: string;
    snippet: string;
    rank: number;
  }>(sql`
    SELECT attribute_id, entity_id, key,
           snippet(attributes_fts, 4, '[', ']', '…', 16) AS snippet,
           rank
    FROM attributes_fts
    WHERE attributes_fts MATCH ${match} AND tenant_id = ${ctx.tenantId}
    ORDER BY rank
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    attributeId: r.attribute_id,
    entityId: r.entity_id,
    key: r.key,
    snippet: r.snippet,
    rank: Number(r.rank) || 0,
  }));
}

import { z } from 'zod';
import { ATTRIBUTE_SOURCES, ENTITY_STATUSES } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import {
  getAttributes,
  getEntity,
  queryEntities,
  setAttribute,
  updateEntity,
} from '@altera/eav';
import type { ToolDefinition } from '../types.ts';
import { sanitizeText } from './sanitize.ts';

export interface EavToolDeps {
  db: AlteraDb;
}

const attributeFilterSchema = z.object({
  key: z.string(),
  equalsText: z.string().optional(),
  equalsNumber: z.number().optional(),
  contains: z.string().optional(),
});

const queryEntitiesSchema = z.object({
  entityType: z.string().optional(),
  status: z
    .union([z.enum(ENTITY_STATUSES), z.array(z.enum(ENTITY_STATUSES))])
    .optional(),
  sourceFileId: z.string().optional(),
  attributes: z.array(attributeFilterSchema).optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  orderBy: z.enum(['ingestedAt:asc', 'ingestedAt:desc']).optional(),
  includeAttributes: z.boolean().optional(),
});

export function createQueryEntitiesTool(deps: EavToolDeps): ToolDefinition {
  return {
    name: 'query_entities',
    description:
      'List entities in the current tenant with optional filters (entity_type, status, attribute key/value, full-text search).',
    parameters: queryEntitiesSchema,
    execute: (input, ctx) => {
      const result = queryEntities(
        { db: deps.db, tenantId: ctx.tenantId },
        input,
      );
      const entities = result.entities.map((e) => {
        const base = {
          id: e.id,
          entityType: e.entityType,
          name: e.name,
          status: e.status,
          classificationConfidence: e.classificationConfidence,
          sourceFileId: e.sourceFileId,
          ingestedAt: e.ingestedAt.toISOString(),
        };
        if (input.includeAttributes) {
          const attrs = getAttributes({ db: deps.db, tenantId: ctx.tenantId }, e.id);
          return {
            ...base,
            attributes: attrs.map((a) => ({
              key: a.key,
              valueText: a.valueText,
              valueNumber: a.valueNumber,
              valueDate: a.valueDate ? a.valueDate.toISOString() : null,
              valueJson: a.valueJson,
              isSensitive: a.isSensitive,
              extractedBy: a.extractedBy,
              confidence: a.confidence,
            })),
          };
        }
        return base;
      });
      return JSON.stringify({
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        entities,
      });
    },
  };
}

const setAttributeSchema = z.object({
  entityId: z.string(),
  key: z.string().min(1),
  valueText: z.string().nullable().optional(),
  valueNumber: z.number().nullable().optional(),
  valueDate: z.string().datetime().nullable().optional(),
  valueJson: z.unknown().optional(),
  isSensitive: z.boolean().optional(),
  extractedBy: z.enum(ATTRIBUTE_SOURCES).default('agent'),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export function createSetAttributeTool(deps: EavToolDeps): ToolDefinition {
  return {
    name: 'set_attribute',
    description:
      'Attach a new attribute to an entity. Provide exactly one of value_text / value_number / value_date / value_json.',
    parameters: setAttributeSchema,
    execute: (input, ctx) => {
      const entity = getEntity({ db: deps.db, tenantId: ctx.tenantId }, input.entityId);
      if (!entity) {
        return `Error: entity ${input.entityId} not found in tenant ${ctx.tenantId}`;
      }
      const payload: Parameters<typeof setAttribute>[2] = {
        key: input.key,
        extractedBy: input.extractedBy,
        ...(input.valueText !== undefined ? { valueText: input.valueText } : {}),
        ...(input.valueNumber !== undefined ? { valueNumber: input.valueNumber } : {}),
        ...(input.valueDate !== undefined
          ? { valueDate: input.valueDate === null ? null : new Date(input.valueDate) }
          : {}),
        ...(input.valueJson !== undefined ? { valueJson: input.valueJson } : {}),
        ...(input.isSensitive !== undefined ? { isSensitive: input.isSensitive } : {}),
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      };
      const attr = setAttribute(
        { db: deps.db, tenantId: ctx.tenantId },
        input.entityId,
        payload,
      );
      return JSON.stringify({
        id: attr.id,
        entityId: attr.entityId,
        key: attr.key,
        extractedBy: attr.extractedBy,
        confidence: attr.confidence,
        createdAt: attr.createdAt.toISOString(),
      });
    },
  };
}

const classifyEntitySchema = z.object({
  entityId: z.string(),
  entityType: z.string().min(1),
  confidence: z.number().min(0).max(1),
  name: z.string().optional(),
});

export function createClassifyEntityTool(deps: EavToolDeps): ToolDefinition {
  return {
    name: 'classify_entity',
    description:
      'Set the entity_type and classification_confidence for an entity, and mark it as classified.',
    parameters: classifyEntitySchema,
    execute: (input, ctx) => {
      const entity = getEntity({ db: deps.db, tenantId: ctx.tenantId }, input.entityId);
      if (!entity) {
        return `Error: entity ${input.entityId} not found in tenant ${ctx.tenantId}`;
      }
      const patch: Parameters<typeof updateEntity>[2] = {
        entityType: input.entityType,
        classificationConfidence: input.confidence,
        status: 'classified',
      };
      if (input.name !== undefined) patch.name = input.name;
      const updated = updateEntity(
        { db: deps.db, tenantId: ctx.tenantId },
        input.entityId,
        patch,
      );
      return JSON.stringify({
        id: updated.id,
        entityType: updated.entityType,
        status: updated.status,
        classificationConfidence: updated.classificationConfidence,
      });
    },
  };
}

const sanitizeThenCallSchema = z.object({
  text: z.string(),
  note: z.string().optional(),
});

export function createSanitizeThenCallTool(): ToolDefinition {
  return {
    name: 'sanitize_then_call',
    description:
      'Scrub likely PII (emails, phones, IBAN, Romanian CNP/CUI) from a text block before you pass it to an external call. Returns the sanitized text plus a list of placeholders you can reference later.',
    parameters: sanitizeThenCallSchema,
    execute: (input) => {
      const { sanitized, replacements } = sanitizeText(input.text);
      return JSON.stringify({
        sanitized,
        replacements: replacements.map((r) => ({ kind: r.kind, placeholder: r.placeholder })),
        ...(input.note ? { note: input.note } : {}),
      });
    },
  };
}

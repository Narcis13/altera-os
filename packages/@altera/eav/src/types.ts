import { z } from 'zod';
import { ATTRIBUTE_SOURCES, ENTITY_STATUSES } from '@altera/core';
import type { AttributeSource, EntityStatus } from '@altera/core';

export interface Entity {
  id: string;
  tenantId: string;
  sourceFileId: string | null;
  entityType: string | null;
  name: string | null;
  status: EntityStatus;
  classificationConfidence: number | null;
  ingestedAt: Date;
}

export interface Attribute {
  id: string;
  tenantId: string;
  entityId: string;
  key: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueJson: unknown;
  isSensitive: boolean;
  extractedBy: AttributeSource;
  confidence: number | null;
  createdAt: Date;
}

export interface AttributeInput {
  key: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
  valueJson?: unknown;
  isSensitive?: boolean;
  extractedBy: AttributeSource;
  confidence?: number | null;
}

export interface CreateEntityInput {
  sourceFileId?: string | null;
  entityType?: string | null;
  name?: string | null;
  status?: EntityStatus;
  classificationConfidence?: number | null;
  attributes?: AttributeInput[];
}

export interface UpdateEntityInput {
  entityType?: string | null;
  name?: string | null;
  status?: EntityStatus;
  classificationConfidence?: number | null;
}

export interface AttributeFilter {
  key: string;
  equalsText?: string;
  equalsNumber?: number;
  contains?: string;
}

export interface EntityQuery {
  entityType?: string;
  status?: EntityStatus | EntityStatus[];
  sourceFileId?: string;
  attributes?: AttributeFilter[];
  search?: string;
  ingestedAfter?: Date;
  ingestedBefore?: Date;
  limit?: number;
  offset?: number;
  orderBy?: 'ingestedAt:asc' | 'ingestedAt:desc';
}

export interface EntityQueryResult {
  entities: Entity[];
  total: number;
  limit: number;
  offset: number;
}

export interface FtsHit {
  entityId: string;
  attributeId: string;
  key: string;
  snippet: string;
  rank: number;
}

export const AttributeInputSchema = z.object({
  key: z.string().min(1),
  valueText: z.string().nullable().optional(),
  valueNumber: z.number().nullable().optional(),
  valueDate: z.coerce.date().nullable().optional(),
  valueJson: z.unknown().optional(),
  isSensitive: z.boolean().optional(),
  extractedBy: z.enum(ATTRIBUTE_SOURCES),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const EntityStatusSchema = z.enum(ENTITY_STATUSES);

export const EntityQuerySchema = z.object({
  entityType: z.string().optional(),
  status: z.union([EntityStatusSchema, z.array(EntityStatusSchema)]).optional(),
  sourceFileId: z.string().optional(),
  attributes: z
    .array(
      z.object({
        key: z.string(),
        equalsText: z.string().optional(),
        equalsNumber: z.number().optional(),
        contains: z.string().optional(),
      }),
    )
    .optional(),
  search: z.string().optional(),
  ingestedAfter: z.coerce.date().optional(),
  ingestedBefore: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
  orderBy: z.enum(['ingestedAt:asc', 'ingestedAt:desc']).optional(),
});

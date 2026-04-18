import { z } from 'zod';
import { ATTRIBUTE_SOURCES, ENTITY_STATUSES } from '../constants.ts';

export const EntityStatusSchema = z.enum(ENTITY_STATUSES);

export const EntitySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  entityType: z.string().min(1),
  name: z.string().min(1),
  sourceFileId: z.string().nullable(),
  status: EntityStatusSchema,
  classificationConfidence: z.number().min(0).max(1).nullable(),
  ingestedAt: z.coerce.date(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const AttributeSourceSchema = z.enum(ATTRIBUTE_SOURCES);

export const AttributeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  entityId: z.string().min(1),
  key: z.string().min(1),
  valueText: z.string().nullable(),
  valueNumber: z.number().nullable(),
  valueDate: z.coerce.date().nullable(),
  valueJson: z.unknown().nullable(),
  isSensitive: z.boolean(),
  extractedBy: AttributeSourceSchema,
  confidence: z.number().min(0).max(1).nullable(),
});
export type Attribute = z.infer<typeof AttributeSchema>;

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { files } from './files.ts';
import { tenants } from './tenants.ts';

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceFileId: text('source_file_id').references(() => files.id, { onDelete: 'set null' }),
    entityType: text('entity_type'),
    name: text('name'),
    status: text('status', { enum: ['raw', 'classified', 'structured', 'archived'] }).notNull(),
    classificationConfidence: real('classification_confidence'),
    ingestedAt: integer('ingested_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('entities_tenant_idx').on(t.tenantId),
    sourceFileIdx: index('entities_source_file_idx').on(t.sourceFileId),
    tenantStatusIdx: index('entities_tenant_status_idx').on(t.tenantId, t.status),
    tenantIngestedIdx: index('entities_tenant_ingested_idx').on(t.tenantId, t.ingestedAt),
  }),
);

export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;

export const attributes = sqliteTable(
  'attributes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueText: text('value_text'),
    valueNumber: real('value_number'),
    valueDate: integer('value_date', { mode: 'timestamp_ms' }),
    valueJson: text('value_json'),
    isSensitive: integer('is_sensitive', { mode: 'boolean' }).notNull().default(false),
    extractedBy: text('extracted_by', { enum: ['agent', 'user', 'structured_import'] }).notNull(),
    confidence: real('confidence'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('attributes_tenant_idx').on(t.tenantId),
    entityIdx: index('attributes_entity_idx').on(t.entityId),
    entityKeyIdx: index('attributes_entity_key_idx').on(t.entityId, t.key),
  }),
);

export type AttributeRow = typeof attributes.$inferSelect;
export type NewAttributeRow = typeof attributes.$inferInsert;

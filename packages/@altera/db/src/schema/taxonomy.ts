import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants.ts';

export const entityTaxonomy = sqliteTable(
  'entity_taxonomy',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('entity_taxonomy_tenant_idx').on(t.tenantId),
    tenantTypeUnique: uniqueIndex('entity_taxonomy_tenant_type_unique').on(
      t.tenantId,
      t.entityType,
    ),
  }),
);

export type EntityTaxonomyRow = typeof entityTaxonomy.$inferSelect;
export type NewEntityTaxonomyRow = typeof entityTaxonomy.$inferInsert;

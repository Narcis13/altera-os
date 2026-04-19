import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    metadataJson: text('metadata_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('events_tenant_idx').on(t.tenantId),
    typeIdx: index('events_type_idx').on(t.type),
    tenantCreatedIdx: index('events_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('audit_tenant_idx').on(t.tenantId),
    resourceIdx: index('audit_resource_idx').on(t.resourceType, t.resourceId),
  }),
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

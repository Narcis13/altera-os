import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants.ts';

export const docsTemplates = sqliteTable(
  'docs_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: ['report', 'form', 'hybrid'] }).notNull(),
    definition: text('definition').notNull(),
    status: text('status', { enum: ['draft', 'published', 'archived'] })
      .notNull()
      .default('draft'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('docs_templates_tenant_idx').on(t.tenantId),
    tenantKindIdx: index('docs_templates_tenant_kind_idx').on(t.tenantId, t.kind),
    tenantSlugUniq: uniqueIndex('docs_templates_tenant_slug_uniq').on(t.tenantId, t.slug),
  }),
);

export type DocsTemplateRow = typeof docsTemplates.$inferSelect;
export type NewDocsTemplateRow = typeof docsTemplates.$inferInsert;

export const docsSubmissions = sqliteTable(
  'docs_submissions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => docsTemplates.id, { onDelete: 'cascade' }),
    data: text('data').notNull(),
    valid: integer('valid', { mode: 'boolean' }).notNull().default(true),
    errors: text('errors'),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('docs_submissions_tenant_idx').on(t.tenantId),
    templateIdx: index('docs_submissions_template_idx').on(t.templateId),
  }),
);

export type DocsSubmissionRow = typeof docsSubmissions.$inferSelect;
export type NewDocsSubmissionRow = typeof docsSubmissions.$inferInsert;

export const docsRenders = sqliteTable(
  'docs_renders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: text('template_id').references(() => docsTemplates.id, {
      onDelete: 'cascade',
    }),
    data: text('data').notNull(),
    html: text('html').notNull(),
    status: text('status', { enum: ['success', 'error'] }).notNull().default('success'),
    errors: text('errors'),
    renderedAt: integer('rendered_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    publishedBy: text('published_by'),
  },
  (t) => ({
    tenantIdx: index('docs_renders_tenant_idx').on(t.tenantId),
    templateIdx: index('docs_renders_template_idx').on(t.templateId),
  }),
);

export type DocsRenderRow = typeof docsRenders.$inferSelect;
export type NewDocsRenderRow = typeof docsRenders.$inferInsert;

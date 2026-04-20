import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants.ts';

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workflowName: text('workflow_name').notNull(),
    workflowVersion: text('workflow_version').notNull(),
    workflowSource: text('workflow_source').notNull(),
    status: text('status', {
      enum: ['running', 'completed', 'failed', 'timed_out', 'paused', 'cancelled'],
    }).notNull(),
    input: text('input').notNull(),
    output: text('output'),
    state: text('state'),
    error: text('error'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    visitedSteps: integer('visited_steps').notNull().default(0),
    elapsedMs: integer('elapsed_ms').notNull().default(0),
  },
  (t) => ({
    tenantIdx: index('workflow_runs_tenant_idx').on(t.tenantId),
    tenantStatusIdx: index('workflow_runs_tenant_status_idx').on(t.tenantId, t.status),
    tenantNameIdx: index('workflow_runs_tenant_name_idx').on(t.tenantId, t.workflowName),
  }),
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;

export const workflowRunEvents = sqliteTable(
  'workflow_run_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    event: text('event').notNull(),
    stepId: text('step_id'),
    kind: text('kind'),
    status: text('status'),
    durationMs: integer('duration_ms'),
    output: text('output'),
    input: text('input'),
    meta: text('meta'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    runIdx: index('workflow_run_events_run_idx').on(t.runId),
    runSeqIdx: index('workflow_run_events_run_seq_idx').on(t.runId, t.seq),
  }),
);

export type WorkflowRunEventRow = typeof workflowRunEvents.$inferSelect;
export type NewWorkflowRunEventRow = typeof workflowRunEvents.$inferInsert;

export const workflowDefinitions = sqliteTable(
  'workflow_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    source: text('source').notNull(),
    document: text('document').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('workflow_definitions_tenant_idx').on(t.tenantId),
    tenantNameUniq: uniqueIndex('workflow_definitions_tenant_name_uniq').on(
      t.tenantId,
      t.name,
    ),
  }),
);

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;
export type NewWorkflowDefinitionRow = typeof workflowDefinitions.$inferInsert;

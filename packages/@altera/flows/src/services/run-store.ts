import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { and, desc, eq } from 'drizzle-orm';
import type {
  JsonObject,
  JsonValue,
  RunRecord,
  RunStatus,
  TraceEvent,
  WorkflowDocument,
} from '../core/types.ts';

const { workflowRuns, workflowRunEvents } = schema;

export interface RunStoreDeps {
  db: AlteraDb;
}

export interface CreateRunInput {
  tenantId: string;
  workflow: WorkflowDocument;
  source: string;
  input: JsonValue;
}

export interface FinalizeRunInput {
  status: RunStatus;
  output?: JsonValue | undefined;
  state: JsonObject;
  error?: RunRecord['error'] | undefined;
  completedAt: Date;
  visitedSteps: number;
  elapsedMs: number;
}

export function createRunStore(deps: RunStoreDeps) {
  const { db } = deps;

  return {
    create(runId: string | undefined, input: CreateRunInput): string {
      const id = runId ?? newId('workflowRun');
      db.insert(workflowRuns)
        .values({
          id,
          tenantId: input.tenantId,
          workflowName: input.workflow.name,
          workflowVersion: input.workflow.version,
          workflowSource: input.source,
          status: 'running',
          input: JSON.stringify(input.input ?? null),
          state: JSON.stringify(input.workflow.state ?? {}),
          startedAt: new Date(),
          visitedSteps: 0,
          elapsedMs: 0,
        })
        .run();
      return id;
    },

    finalize(tenantId: string, runId: string, data: FinalizeRunInput): void {
      db.update(workflowRuns)
        .set({
          status: data.status,
          output: data.output === undefined ? null : JSON.stringify(data.output),
          state: JSON.stringify(data.state),
          error: data.error ? JSON.stringify(data.error) : null,
          completedAt: data.completedAt,
          visitedSteps: data.visitedSteps,
          elapsedMs: data.elapsedMs,
        })
        .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId)))
        .run();
    },

    appendEvent(tenantId: string, runId: string, seq: number, event: TraceEvent): void {
      db.insert(workflowRunEvents)
        .values({
          id: newId('workflowEvent'),
          tenantId,
          runId,
          seq,
          event: event.event,
          stepId: event.stepId ?? null,
          kind: event.kind ?? null,
          status: event.status ?? null,
          durationMs: event.durationMs ?? null,
          output: event.output === undefined ? null : JSON.stringify(event.output),
          input: event.input === undefined ? null : JSON.stringify(event.input),
          meta: event.meta ? JSON.stringify(event.meta) : null,
          createdAt: new Date(),
        })
        .run();
    },

    getById(tenantId: string, runId: string): RunRow | undefined {
      const row = db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId)))
        .get();
      return row ? rowToRecord(row) : undefined;
    },

    listByTenant(
      tenantId: string,
      { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    ): RunRow[] {
      const rows = db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.tenantId, tenantId))
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map(rowToRecord);
    },

    listEvents(tenantId: string, runId: string): TraceEvent[] {
      const rows = db
        .select()
        .from(workflowRunEvents)
        .where(and(eq(workflowRunEvents.tenantId, tenantId), eq(workflowRunEvents.runId, runId)))
        .orderBy(workflowRunEvents.seq)
        .all();
      return rows.map((r) => ({
        event: r.event as TraceEvent['event'],
        ...(r.stepId ? { stepId: r.stepId } : {}),
        ...(r.kind ? { kind: r.kind } : {}),
        ...(r.status ? { status: r.status } : {}),
        ...(r.durationMs != null ? { durationMs: r.durationMs } : {}),
        ...(r.output ? { output: JSON.parse(r.output) as JsonValue } : {}),
        ...(r.input ? { input: JSON.parse(r.input) as JsonValue } : {}),
        ...(r.meta ? { meta: JSON.parse(r.meta) as Record<string, unknown> } : {}),
      }));
    },
  };
}

export type RunStore = ReturnType<typeof createRunStore>;

export interface RunRow {
  runId: string;
  tenantId: string;
  workflowName: string;
  workflowVersion: string;
  workflowSource: string;
  status: RunStatus;
  input: JsonValue;
  output: JsonValue | null;
  state: JsonObject;
  error: RunRecord['error'] | null;
  startedAt: Date;
  completedAt: Date | null;
  visitedSteps: number;
  elapsedMs: number;
}

function rowToRecord(row: typeof workflowRuns.$inferSelect): RunRow {
  return {
    runId: row.id,
    tenantId: row.tenantId,
    workflowName: row.workflowName,
    workflowVersion: row.workflowVersion,
    workflowSource: row.workflowSource,
    status: row.status,
    input: row.input ? (JSON.parse(row.input) as JsonValue) : null,
    output: row.output ? (JSON.parse(row.output) as JsonValue) : null,
    state: row.state ? (JSON.parse(row.state) as JsonObject) : {},
    error: row.error ? (JSON.parse(row.error) as RunRecord['error']) : null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    visitedSteps: row.visitedSteps,
    elapsedMs: row.elapsedMs,
  };
}

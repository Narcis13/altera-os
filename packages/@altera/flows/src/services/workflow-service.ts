import type { AlteraDb } from '@altera/db';
import { newId } from '@altera/db';
import type { AgentAdapterRegistry } from '../agent/contracts.ts';
import { createAgentAdapterRegistry } from '../agent/runtime.ts';
import {
  type ExecuteWorkflowInput,
  type ExecutionEnvironment,
  executeWorkflow,
} from '../core/execution-engine.ts';
import type { JsonValue, RunRecord, TraceEvent, WorkflowDocument } from '../core/types.ts';
import { parseWorkflowYaml } from '../dsl/loader.ts';
import { createBuiltinFlowTools } from '../tools/builtin.ts';
import type { FlowToolRegistry } from '../tools/contracts.ts';
import { type DefinitionStore, createDefinitionStore } from './definition-store.ts';
import { type RunRow, type RunStore, createRunStore } from './run-store.ts';

export interface WorkflowServiceDeps {
  db: AlteraDb;
  tools?: FlowToolRegistry;
  agents?: AgentAdapterRegistry;
  env?: Record<string, JsonValue>;
}

export interface RunFromYamlInput {
  tenantId: string;
  yaml: string;
  sourceLabel?: string;
  input?: JsonValue;
  persistDefinition?: boolean;
}

export interface RunByNameInput {
  tenantId: string;
  name: string;
  input?: JsonValue;
}

export function createWorkflowService(deps: WorkflowServiceDeps) {
  const runs = createRunStore({ db: deps.db });
  const definitions = createDefinitionStore({ db: deps.db });
  const tools = deps.tools ?? createBuiltinFlowTools();
  const agents = deps.agents ?? createAgentAdapterRegistry();

  async function runInternal(
    tenantId: string,
    workflow: WorkflowDocument,
    source: string,
    input: JsonValue,
  ): Promise<RunRecord> {
    const runId = newId('workflowRun');
    runs.create(runId, { tenantId, workflow, source, input });
    let seq = 0;

    const env: ExecutionEnvironment = {
      tools,
      agents,
      env: deps.env ?? {},
      idGenerator: () => runId,
      now: () => new Date(),
      onEvent: async (event: TraceEvent) => {
        const currentSeq = seq++;
        try {
          runs.appendEvent(tenantId, runId, currentSeq, event);
        } catch {
          // Swallow event-persistence errors so the run can still complete.
        }
      },
    };

    const record = await executeWorkflow(env, {
      tenantId,
      workflow,
      source,
      input,
      runId,
    });

    runs.finalize(tenantId, runId, {
      status: record.status,
      output: record.output,
      state: record.state,
      error: record.error,
      completedAt: record.completedAt ? new Date(record.completedAt) : new Date(),
      visitedSteps: record.visitedSteps,
      elapsedMs: record.elapsedMs,
    });

    return record;
  }

  return {
    tools,
    agents,
    runs,
    definitions,

    async runFromYaml(params: RunFromYamlInput): Promise<RunRecord> {
      const doc = parseWorkflowYaml(params.yaml, params.sourceLabel ?? 'inline');
      if (params.persistDefinition !== false) {
        definitions.upsert(params.tenantId, doc, params.sourceLabel ?? 'inline');
      }
      return runInternal(
        params.tenantId,
        doc,
        params.sourceLabel ?? 'inline',
        params.input ?? null,
      );
    },

    async runByName(params: RunByNameInput): Promise<RunRecord> {
      const def = definitions.getByName(params.tenantId, params.name);
      if (!def) {
        throw new Error(`Workflow '${params.name}' not found for tenant ${params.tenantId}`);
      }
      return runInternal(params.tenantId, def.document, def.source, params.input ?? null);
    },

    async runDocument(
      tenantId: string,
      workflow: WorkflowDocument,
      input?: JsonValue,
      source = 'inline',
    ): Promise<RunRecord> {
      return runInternal(tenantId, workflow, source, input ?? null);
    },

    getRun(tenantId: string, runId: string): RunRow | undefined {
      return runs.getById(tenantId, runId);
    },

    listRuns(tenantId: string, options?: { limit?: number; offset?: number }): RunRow[] {
      return runs.listByTenant(tenantId, options);
    },

    listEvents(tenantId: string, runId: string): TraceEvent[] {
      return runs.listEvents(tenantId, runId);
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
export type { DefinitionStore, RunStore };

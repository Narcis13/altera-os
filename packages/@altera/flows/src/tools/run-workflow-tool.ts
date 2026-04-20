import type { ToolDefinition } from '@altera/agent';
import { z } from 'zod';
import type { WorkflowService } from '../services/workflow-service.ts';

export interface RunWorkflowToolDeps {
  workflows: WorkflowService;
  pollIntervalMs?: number;
  defaultTimeoutMs?: number;
}

const runWorkflowSchema = z.object({
  workflow: z.string().min(1).describe('Name of the workflow registered for this tenant.'),
  params: z
    .record(z.unknown())
    .optional()
    .describe('Optional input payload passed to the workflow as `input`.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum wall-clock time to wait for the workflow to complete.'),
});

/**
 * Agent-facing `run_workflow` tool. Triggers a stored workflow by name and
 * polls the run store until it is no longer `running`, returning final status
 * and output. Polling is a formality today (runs execute synchronously), but
 * the shape matches an async runner for future extension.
 */
export function createRunWorkflowTool(deps: RunWorkflowToolDeps): ToolDefinition {
  const pollIntervalMs = deps.pollIntervalMs ?? 100;
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? 60_000;

  return {
    name: 'run_workflow',
    description:
      'Execute a stored workflow by name with the given input params, wait for it to finish, and return the final status + output (or error).',
    parameters: runWorkflowSchema,
    execute: async (input, ctx) => {
      const { workflow, params, timeoutMs } = input;
      const record = await deps.workflows.runByName({
        tenantId: ctx.tenantId,
        name: workflow,
        input: (params ?? {}) as never,
      });

      const deadline = Date.now() + (timeoutMs ?? defaultTimeoutMs);
      let current = deps.workflows.getRun(ctx.tenantId, record.runId);
      while (current && current.status === 'running' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        current = deps.workflows.getRun(ctx.tenantId, record.runId);
      }
      if (!current) {
        return JSON.stringify({
          runId: record.runId,
          status: 'unknown',
          error: { code: 'RUN_NOT_FOUND', message: 'Run vanished after dispatch' },
        });
      }
      return JSON.stringify({
        runId: current.runId,
        status: current.status,
        output: current.output,
        error: current.error,
        elapsedMs: current.elapsedMs,
        visitedSteps: current.visitedSteps,
      });
    },
  };
}

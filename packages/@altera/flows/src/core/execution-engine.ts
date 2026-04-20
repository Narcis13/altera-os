import type { AgentAdapter, AgentAdapterRegistry } from '../agent/contracts.ts';
import type { FlowTool, FlowToolRegistry } from '../tools/contracts.ts';
import { invokeFlowTool } from '../tools/runtime.ts';
import { FlowError, createFailure } from './errors.ts';
import { type ExpressionScope, evaluate, interpolateValue, isInterpolation } from './expression.ts';
import type {
  AgentStep,
  AssignStep,
  FailStep,
  ForEachStep,
  IfStep,
  JsonObject,
  JsonValue,
  NoopStep,
  ReturnStep,
  RunRecord,
  ToolStep,
  TraceEvent,
  WorkflowDocument,
  WorkflowStep,
} from './types.ts';

const DEFAULT_MAX_RUN_STEPS = 256;
const DEFAULT_MAX_RUN_DURATION_MS = 10 * 60 * 1000;

export interface ExecutionEnvironment {
  tools: FlowToolRegistry;
  agents: AgentAdapterRegistry;
  env?: Record<string, JsonValue>;
  idGenerator: () => string;
  now?: () => Date;
  onEvent?: (event: TraceEvent) => void | Promise<void>;
}

export interface ExecuteWorkflowInput {
  tenantId: string;
  workflow: WorkflowDocument;
  source?: string;
  input?: JsonValue;
  runId?: string;
  signal?: AbortSignal;
}

type RunController = {
  record: RunRecord;
  scope: ExpressionScope;
  startMs: number;
  visitedSteps: number;
  maxSteps: number;
  maxDurationMs: number;
  returned: boolean;
  env: ExecutionEnvironment;
};

export async function executeWorkflow(
  env: ExecutionEnvironment,
  input: ExecuteWorkflowInput,
): Promise<RunRecord> {
  const now = env.now ?? (() => new Date());
  const started = now();
  const state: JsonObject = deepClone(input.workflow.state ?? {}) as JsonObject;
  const runId = input.runId ?? env.idGenerator();
  const record: RunRecord = {
    runId,
    tenantId: input.tenantId,
    workflow: {
      name: input.workflow.name,
      version: input.workflow.version,
      source: input.source ?? 'inline',
    },
    status: 'running',
    startedAt: started.toISOString(),
    input: input.input ?? null,
    state,
    visitedSteps: 0,
    elapsedMs: 0,
  };

  const scope: ExpressionScope = {
    input: input.input ?? {},
    state,
    env: env.env ?? {},
    context: { runId, tenantId: input.tenantId },
  };

  const policies = input.workflow.policies ?? {};

  const controller: RunController = {
    record,
    scope,
    startMs: started.getTime(),
    visitedSteps: 0,
    maxSteps: policies.maxRunSteps ?? DEFAULT_MAX_RUN_STEPS,
    maxDurationMs: policies.maxRunDurationMs ?? DEFAULT_MAX_RUN_DURATION_MS,
    returned: false,
    env,
  };

  await emit(env, { event: 'run.started', meta: { runId } });

  try {
    await runSteps(controller, input.workflow.steps);
    if (!controller.returned && input.workflow.output !== undefined) {
      record.output = interpolateValue(input.workflow.output, controller.scope);
    }
    record.status = 'completed';
    const completed = now();
    record.completedAt = completed.toISOString();
    record.elapsedMs = completed.getTime() - controller.startMs;
    record.visitedSteps = controller.visitedSteps;
    await emit(env, {
      event: 'run.completed',
      meta: { runId, output: record.output },
    });
  } catch (err) {
    const flowErr = toFlowError(err);
    record.status = flowErr.code === 'TIMEOUT' ? 'timed_out' : 'failed';
    const completed = now();
    record.completedAt = completed.toISOString();
    record.elapsedMs = completed.getTime() - controller.startMs;
    record.visitedSteps = controller.visitedSteps;
    record.error = {
      code: flowErr.code,
      message: flowErr.message,
      ...(flowErr.stepId ? { stepId: flowErr.stepId } : {}),
    };
    await emit(env, {
      event: 'run.failed',
      meta: { runId, error: record.error },
    });
  }

  return record;
}

async function runSteps(controller: RunController, steps: WorkflowStep[]): Promise<void> {
  for (const step of steps) {
    if (controller.returned) return;
    if (controller.visitedSteps >= controller.maxSteps) {
      throw createFailure(
        'MAX_STEPS_EXCEEDED',
        `Workflow exceeded maxRunSteps=${controller.maxSteps}`,
        undefined,
        step.id,
      );
    }
    if (Date.now() - controller.startMs > controller.maxDurationMs) {
      throw createFailure(
        'TIMEOUT',
        `Workflow exceeded maxRunDurationMs=${controller.maxDurationMs}`,
        undefined,
        step.id,
      );
    }
    controller.visitedSteps++;

    if (step.when && !asBool(evaluate(step.when, controller.scope))) {
      await emit(controller.env, {
        event: 'step.skipped',
        stepId: step.id,
        kind: step.kind,
      });
      continue;
    }

    await emit(controller.env, {
      event: 'step.started',
      stepId: step.id,
      kind: step.kind,
    });
    const startedAt = Date.now();
    try {
      await runStep(controller, step);
      await emit(controller.env, {
        event: 'step.completed',
        stepId: step.id,
        kind: step.kind,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      await emit(controller.env, {
        event: 'step.failed',
        stepId: step.id,
        kind: step.kind,
        durationMs: Date.now() - startedAt,
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }
}

async function runStep(controller: RunController, step: WorkflowStep): Promise<void> {
  switch (step.kind) {
    case 'assign':
      return runAssignStep(controller, step);
    case 'tool':
      return runToolStep(controller, step);
    case 'agent':
      return runAgentStep(controller, step);
    case 'if':
      return runIfStep(controller, step);
    case 'for_each':
      return runForEachStep(controller, step);
    case 'return':
      return runReturnStep(controller, step);
    case 'fail':
      return runFailStep(step);
    case 'noop':
      return runNoopStep(step);
  }
}

function runAssignStep(controller: RunController, step: AssignStep): void {
  for (const [path, rawValue] of Object.entries(step.set)) {
    const value = interpolateValue(rawValue, controller.scope);
    assignPath(controller.scope.state as JsonObject, path, value);
  }
}

async function runToolStep(controller: RunController, step: ToolStep): Promise<void> {
  const tool = controller.env.tools.get(step.tool);
  if (!tool) {
    throw createFailure(
      'UNKNOWN_TOOL',
      `Tool '${step.tool}' is not registered`,
      undefined,
      step.id,
    );
  }
  const input = (step.input ? interpolateValue(step.input, controller.scope) : {}) as JsonValue;
  await emit(controller.env, {
    event: 'tool.called',
    stepId: step.id,
    kind: 'tool',
    meta: { tool: step.tool },
    input,
  });
  const result = await invokeFlowTool(
    tool,
    input,
    {
      tenantId: controller.record.tenantId,
      runId: controller.record.runId,
      stepId: step.id,
    },
    step.timeoutMs,
  );
  if (!result.ok) {
    await emit(controller.env, {
      event: 'tool.failed',
      stepId: step.id,
      kind: 'tool',
      meta: { tool: step.tool, error: result.error },
    });
    throw createFailure(result.error.code, result.error.message, result.error.details, step.id);
  }
  await emit(controller.env, {
    event: 'tool.completed',
    stepId: step.id,
    kind: 'tool',
    meta: { tool: step.tool },
    output: result.output as JsonValue,
  });
  persistSaveOrAppend(controller, step.save, step.append, result.output as JsonValue, tool);
}

async function runAgentStep(controller: RunController, step: AgentStep): Promise<void> {
  const providerName =
    step.provider ?? (controller.env.env?.defaultAgentProvider as string | undefined) ?? 'mock';
  const adapter = controller.env.agents.get(providerName);
  if (!adapter) {
    throw createFailure(
      'UNKNOWN_AGENT_PROVIDER',
      `Agent provider '${providerName}' is not registered`,
      undefined,
      step.id,
    );
  }
  const model =
    step.model ??
    (controller.env.env?.defaultAgentModel as string | undefined) ??
    'claude-sonnet-4-5';
  const resolvedInput = step.input
    ? (interpolateValue(step.input, controller.scope) as JsonValue)
    : undefined;
  const objective = resolveTemplateString(step.objective, controller.scope);
  const instructions = step.instructions
    ? resolveTemplateString(step.instructions, controller.scope)
    : undefined;

  await emit(controller.env, {
    event: 'agent.called',
    stepId: step.id,
    kind: 'agent',
    meta: { provider: providerName, model },
  });

  const result = await adapter.runStructured({
    runId: controller.record.runId,
    stepId: step.id,
    tenantId: controller.record.tenantId,
    provider: providerName,
    model,
    objective,
    ...(instructions ? { instructions } : {}),
    ...(resolvedInput !== undefined ? { input: resolvedInput } : {}),
    ...(step.outputSchema ? { outputSchema: step.outputSchema } : {}),
    ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
    prompt: '',
    attempt: 1,
  });

  if (!result.ok) {
    await emit(controller.env, {
      event: 'agent.failed',
      stepId: step.id,
      kind: 'agent',
      meta: { provider: providerName, model, error: result.error },
    });
    throw createFailure(result.error.code, result.error.message, result.error.details, step.id);
  }
  await emit(controller.env, {
    event: 'agent.completed',
    stepId: step.id,
    kind: 'agent',
    meta: { provider: providerName, model },
    output: result.output,
  });
  if (step.save) {
    assignPath(controller.scope.state as JsonObject, step.save, result.output);
  }
}

async function runIfStep(controller: RunController, step: IfStep): Promise<void> {
  const branch = asBool(evaluate(step.condition, controller.scope)) ? step.then : step.else;
  if (branch && branch.length > 0) await runSteps(controller, branch);
}

async function runForEachStep(controller: RunController, step: ForEachStep): Promise<void> {
  const itemsRaw = evaluate(step.items, controller.scope);
  if (!Array.isArray(itemsRaw)) {
    throw createFailure(
      'FOR_EACH_NOT_ARRAY',
      `for_each.items did not evaluate to an array (got ${typeof itemsRaw})`,
      undefined,
      step.id,
    );
  }
  const previous = (controller.scope as Record<string, unknown>)[step.as];
  try {
    for (const item of itemsRaw) {
      (controller.scope as Record<string, unknown>)[step.as] = item;
      await runSteps(controller, step.steps);
      if (controller.returned) break;
    }
  } finally {
    (controller.scope as Record<string, unknown>)[step.as] = previous;
  }
}

function runReturnStep(controller: RunController, step: ReturnStep): void {
  if (step.output !== undefined) {
    controller.record.output = interpolateValue(step.output, controller.scope);
  } else {
    controller.record.output = null;
  }
  controller.returned = true;
}

function runFailStep(step: FailStep): never {
  throw createFailure(
    step.error ?? 'WORKFLOW_FAIL_STEP',
    step.message ?? `Workflow failed at step ${step.id}`,
    undefined,
    step.id,
  );
}

function runNoopStep(_step: NoopStep): void {
  /* intentional no-op */
}

function persistSaveOrAppend(
  controller: RunController,
  savePath: string | undefined,
  appendPath: string | undefined,
  value: JsonValue,
  _tool: FlowTool,
): void {
  if (savePath) {
    assignPath(controller.scope.state as JsonObject, savePath, value);
  }
  if (appendPath) {
    const existing = readPath(controller.scope.state as JsonObject, appendPath);
    const list = Array.isArray(existing) ? [...existing, value] : [value];
    assignPath(controller.scope.state as JsonObject, appendPath, list);
  }
}

function assignPath(root: JsonObject, path: string, value: JsonValue): void {
  const segments = path.split('.');
  let current: Record<string, JsonValue> = root as Record<string, JsonValue>;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    const next = current[key];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: JsonObject = {};
      current[key] = fresh;
      current = fresh as Record<string, JsonValue>;
    } else {
      current = next as Record<string, JsonValue>;
    }
  }
  current[segments[segments.length - 1]!] = value;
}

function readPath(root: JsonObject, path: string): JsonValue | undefined {
  const segments = path.split('.');
  let current: JsonValue | undefined = root;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as JsonObject)[seg];
  }
  return current;
}

function resolveTemplateString(value: string, scope: ExpressionScope): string {
  if (isInterpolation(value)) {
    const resolved = evaluate(value, scope);
    return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
  }
  return value;
}

function asBool(value: unknown): boolean {
  return Boolean(value);
}

function toFlowError(err: unknown): FlowError {
  if (err instanceof FlowError) return err;
  if (err instanceof Error) return new FlowError('WORKFLOW_ERROR', err.message);
  return new FlowError('WORKFLOW_ERROR', String(err));
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function emit(env: ExecutionEnvironment, event: TraceEvent): Promise<void> {
  if (!env.onEvent) return;
  await env.onEvent(event);
}

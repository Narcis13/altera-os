export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: JsonValue[];
  additionalProperties?: boolean | JsonSchema;
}

export const WORKFLOW_STEP_KINDS = [
  'assign',
  'tool',
  'agent',
  'if',
  'for_each',
  'return',
  'fail',
  'noop',
] as const;

export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

export interface WorkflowDefaults {
  model?: string;
  timeoutMs?: number;
  maxStepRetries?: number;
}

export interface WorkflowPolicies {
  allowTools?: string[];
  maxRunSteps?: number;
  maxRunDurationMs?: number;
}

export interface BaseStep {
  id: string;
  kind: WorkflowStepKind;
  name?: string;
  description?: string;
  when?: string;
  timeoutMs?: number;
}

export interface AssignStep extends BaseStep {
  kind: 'assign';
  set: Record<string, unknown>;
}

export interface ToolStep extends BaseStep {
  kind: 'tool';
  tool: string;
  input?: Record<string, unknown>;
  save?: string;
  append?: string;
}

export interface AgentStep extends BaseStep {
  kind: 'agent';
  provider?: string;
  model?: string;
  objective: string;
  instructions?: string;
  input?: Record<string, unknown>;
  outputSchema?: JsonSchema;
  save?: string;
}

export interface IfStep extends BaseStep {
  kind: 'if';
  condition: string;
  then: WorkflowStep[];
  else?: WorkflowStep[];
}

export interface ForEachStep extends BaseStep {
  kind: 'for_each';
  items: string;
  as: string;
  steps: WorkflowStep[];
}

export interface ReturnStep extends BaseStep {
  kind: 'return';
  output?: unknown;
}

export interface FailStep extends BaseStep {
  kind: 'fail';
  message?: string;
  error?: string;
}

export interface NoopStep extends BaseStep {
  kind: 'noop';
}

export type WorkflowStep =
  | AssignStep
  | ToolStep
  | AgentStep
  | IfStep
  | ForEachStep
  | ReturnStep
  | FailStep
  | NoopStep;

export interface WorkflowDocument {
  version: string;
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  defaults?: WorkflowDefaults;
  policies?: WorkflowPolicies;
  state?: Record<string, JsonValue>;
  steps: WorkflowStep[];
  output?: unknown;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'paused' | 'cancelled';

export interface RunRecord {
  runId: string;
  tenantId: string;
  workflow: { name: string; version: string; source: string };
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  input: JsonValue;
  output?: JsonValue;
  state: JsonObject;
  visitedSteps: number;
  elapsedMs: number;
  error?: { code: string; message: string; stepId?: string };
}

export interface TraceEvent {
  event:
    | 'run.started'
    | 'run.completed'
    | 'run.failed'
    | 'step.started'
    | 'step.completed'
    | 'step.skipped'
    | 'step.failed'
    | 'tool.called'
    | 'tool.completed'
    | 'tool.failed'
    | 'agent.called'
    | 'agent.completed'
    | 'agent.failed';
  stepId?: string;
  kind?: string;
  status?: string;
  durationMs?: number;
  output?: JsonValue;
  input?: JsonValue;
  meta?: Record<string, unknown>;
}

import type { JsonSchema, JsonValue } from '../core/types.ts';

export interface StructuredAgentRequest {
  runId: string;
  stepId: string;
  tenantId: string;
  provider: string;
  model: string;
  objective: string;
  instructions?: string;
  input?: JsonValue;
  outputSchema?: JsonSchema;
  timeoutMs?: number;
  prompt: string;
  attempt: number;
}

export type StructuredAgentResult =
  | {
      ok: true;
      output: JsonValue;
      rawOutput?: string;
      meta?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
      rawOutput?: string;
      meta?: Record<string, unknown>;
    };

export interface AgentAdapter {
  name: string;
  runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult>;
}

export type AgentAdapterRegistry = Map<string, AgentAdapter>;

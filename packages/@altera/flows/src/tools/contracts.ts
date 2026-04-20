import type { JsonSchema, JsonValue } from '../core/types.ts';

export type ToolSideEffect = 'none' | 'read' | 'write' | 'external';

export interface FlowToolContext {
  tenantId: string;
  runId: string;
  stepId: string;
  signal?: AbortSignal;
}

export type FlowToolResult<T = JsonValue> =
  | { ok: true; output: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface FlowTool<Input = JsonValue, Output = JsonValue> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  sideEffect: ToolSideEffect;
  execute: (input: Input, ctx: FlowToolContext) => Promise<FlowToolResult<Output>>;
}

export type FlowToolRegistry = Map<string, FlowTool>;

export function defineFlowTools(tools: FlowTool[]): FlowToolRegistry {
  const map = new Map<string, FlowTool>();
  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`Duplicate flow tool: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }
  return map;
}

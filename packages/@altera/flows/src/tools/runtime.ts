import { createFailure } from '../core/errors.ts';
import type { JsonValue } from '../core/types.ts';
import type { FlowTool, FlowToolContext, FlowToolResult } from './contracts.ts';

export async function invokeFlowTool(
  tool: FlowTool,
  input: JsonValue,
  ctx: FlowToolContext,
  timeoutMs?: number,
): Promise<FlowToolResult> {
  const task = async (): Promise<FlowToolResult> => {
    try {
      return await tool.execute(input, ctx);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'TOOL_RUNTIME_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  };

  if (!timeoutMs) return task();

  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        createFailure(
          'TIMEOUT',
          `Tool '${tool.name}' timed out after ${timeoutMs}ms`,
          undefined,
          ctx.stepId,
        ),
      );
    }, timeoutMs);
    task()
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

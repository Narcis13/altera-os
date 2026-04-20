import type { JsonValue } from '../core/types.ts';
import type { AgentAdapter, StructuredAgentResult } from './contracts.ts';

/**
 * Deterministic adapter used for tests and dry-runs. If the input provides
 * `_mockOutput`, that value is returned as structured output.
 */
export const mockAgentAdapter: AgentAdapter = {
  name: 'mock',
  async runStructured(req): Promise<StructuredAgentResult> {
    const input = (req.input ?? {}) as Record<string, JsonValue>;
    const candidate = input._mockOutput;
    if (candidate !== undefined) {
      return { ok: true, output: candidate, rawOutput: JSON.stringify(candidate) };
    }
    const output: JsonValue = { echoed: true, objective: req.objective };
    return { ok: true, output, rawOutput: JSON.stringify(output) };
  },
};

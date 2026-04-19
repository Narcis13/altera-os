import type { ToolRegistry } from './registry.ts';
import type {
  AgentMessage,
  AgentRunInput,
  AgentRunResult,
  LlmProvider,
  ProviderToolSpec,
} from './types.ts';

export interface RunAgentOptions {
  provider: LlmProvider;
  tools: ToolRegistry;
  input: AgentRunInput;
  onEvent?: (event: AgentRuntimeEvent) => void;
}

export type AgentRuntimeEvent =
  | { type: 'iteration.start'; iteration: number }
  | { type: 'provider.response'; iteration: number; stopReason: string }
  | { type: 'tool.call'; iteration: number; toolName: string; input: unknown }
  | { type: 'tool.result'; iteration: number; toolName: string; output: string; isError: boolean }
  | { type: 'run.finish'; iterations: number; stopReason: string };

const DEFAULT_MAX_ITERATIONS = 10;

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const { provider, tools, input, onEvent } = opts;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const model = input.model ?? provider.defaultModel();
  const messages: AgentMessage[] = [...input.messages];
  const toolSpecs: ProviderToolSpec[] = tools.toProviderSpecs();
  const toolsUsed: string[] = [];

  let finalContent: string | null = null;
  let iterations = 0;
  let stopReason: AgentRunResult['stopReason'] = 'end_turn';

  while (iterations < maxIterations) {
    iterations++;
    onEvent?.({ type: 'iteration.start', iteration: iterations });

    const chatOpts: Parameters<LlmProvider['chat']>[1] = {
      model,
      ...(input.system !== undefined ? { system: input.system } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(toolSpecs.length > 0 ? { tools: toolSpecs } : {}),
      ...(input.toolContext.signal ? { signal: input.toolContext.signal } : {}),
    };

    const response = await provider.chat(messages, chatOpts);
    stopReason = response.stopReason;
    onEvent?.({ type: 'provider.response', iteration: iterations, stopReason });

    messages.push({
      role: 'assistant',
      content: response.content,
      ...(response.toolUses.length > 0 ? { toolUses: response.toolUses } : {}),
    });

    if (response.toolUses.length === 0) {
      finalContent = response.content;
      break;
    }

    for (const tu of response.toolUses) {
      toolsUsed.push(tu.name);
      onEvent?.({
        type: 'tool.call',
        iteration: iterations,
        toolName: tu.name,
        input: tu.input,
      });
      const result = await tools.execute(tu.name, tu.input, input.toolContext);
      const isError = result.startsWith('Error') || result.startsWith('Invalid parameters');
      onEvent?.({
        type: 'tool.result',
        iteration: iterations,
        toolName: tu.name,
        output: result,
        isError,
      });
      messages.push({
        role: 'tool',
        content: null,
        toolResult: { toolUseId: tu.id, content: result, ...(isError ? { isError: true } : {}) },
      });
    }

    if (response.stopReason !== 'tool_use') {
      finalContent = response.content;
      break;
    }
  }

  onEvent?.({ type: 'run.finish', iterations, stopReason });

  return {
    finalContent,
    messages,
    toolsUsed,
    iterations,
    stopReason,
  };
}

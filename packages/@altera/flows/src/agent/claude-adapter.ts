import type { AgentMessage, LlmProvider } from '@altera/agent';
import { sanitizeText } from '@altera/agent';
import type { JsonValue } from '../core/types.ts';
import type { AgentAdapter, StructuredAgentRequest, StructuredAgentResult } from './contracts.ts';
import { buildStructuredPrompt, repairStructuredOutput } from './runtime.ts';

export interface CreateClaudeAdapterOptions {
  provider: LlmProvider;
  /** Name exposed to DSL workflows (e.g. "claude"). */
  name?: string;
  /** When true (default), incoming prompts are sanitized for PII before being sent to Claude. */
  sanitize?: boolean;
  /** Upper bound on output tokens per call. */
  maxTokens?: number;
  system?: string;
}

/**
 * Wraps an @altera/agent LlmProvider (e.g. AnthropicProvider) as an AgentAdapter
 * suitable for glyphrail-port workflow agent steps.
 *
 * Sanitization is enabled by default: emails, phone numbers, IBANs, CUIs, and
 * CNPs in the prompt are replaced with placeholders before the Claude call.
 * Model replies are not un-sanitized; downstream consumers decide how to map
 * placeholders back.
 */
export function createClaudeAdapter(options: CreateClaudeAdapterOptions): AgentAdapter {
  const { provider, name = 'claude', sanitize = true, maxTokens = 4096, system } = options;

  return {
    name,
    async runStructured(request: StructuredAgentRequest): Promise<StructuredAgentResult> {
      const rawPrompt = buildStructuredPrompt({
        objective: request.objective,
        ...(request.instructions ? { instructions: request.instructions } : {}),
        ...(request.input !== undefined ? { input: request.input } : {}),
        ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
      });

      const prompt = sanitize ? sanitizeText(rawPrompt).sanitized : rawPrompt;

      const messages: AgentMessage[] = [{ role: 'user', content: prompt }];

      const controller = request.timeoutMs ? new AbortController() : undefined;
      const timer = request.timeoutMs
        ? setTimeout(() => controller?.abort(), request.timeoutMs)
        : undefined;

      try {
        const response = await provider.chat(messages, {
          model: request.model,
          maxTokens,
          ...(system ? { system } : {}),
          ...(controller ? { signal: controller.signal } : {}),
        });

        const text = response.content ?? '';
        const repaired = repairStructuredOutput(text);
        if (repaired === undefined) {
          return {
            ok: false,
            error: {
              code: 'AGENT_OUTPUT_PARSE_ERROR',
              message: 'Claude response could not be parsed as JSON',
            },
            rawOutput: text,
            meta: {
              provider: name,
              model: request.model,
              sanitized: sanitize,
              ...(response.usage ? { usage: response.usage } : {}),
            },
          };
        }

        return {
          ok: true,
          output: repaired as JsonValue,
          rawOutput: text,
          meta: {
            provider: name,
            model: request.model,
            sanitized: sanitize,
            ...(response.usage ? { usage: response.usage } : {}),
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'AGENT_RUNTIME_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
          meta: { provider: name, model: request.model },
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

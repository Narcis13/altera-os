import type {
  AgentMessage,
  LlmProvider,
  ProviderChatOptions,
  ProviderResponse,
  ToolUse,
} from '../types.ts';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-5';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: 'text'; text: string }>;
  is_error?: boolean;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage?: { input_tokens: number; output_tokens: number };
}

function mapMessages(messages: AgentMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content ?? '' }] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.toolUses) {
        for (const tu of m.toolUses) {
          blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        }
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (m.role === 'tool' && m.toolResult) {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolResult.toolUseId,
            content: m.toolResult.content,
            ...(m.toolResult.isError ? { is_error: true } : {}),
          },
        ],
      });
    }
  }
  return out;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey) throw new Error('AnthropicProvider: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.model = opts.defaultModel ?? DEFAULT_MODEL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  defaultModel(): string {
    return this.model;
  }

  async chat(messages: AgentMessage[], options: ProviderChatOptions): Promise<ProviderResponse> {
    const systemFromMessages = messages.find((m) => m.role === 'system' && m.content);
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: mapMessages(messages),
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const system = options.system ?? systemFromMessages?.content ?? undefined;
    if (system) body.system = system;

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    };
    if (options.signal) init.signal = options.signal;

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, init);
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errBody}`);
    }
    const data = (await res.json()) as AnthropicResponse;

    let text: string | null = null;
    const toolUses: ToolUse[] = [];
    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        text = text === null ? block.text : `${text}\n${block.text}`;
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolUses.push({ id: block.id, name: block.name, input: block.input ?? {} });
      }
    }

    const stopReason: ProviderResponse['stopReason'] = data.stop_reason ?? 'end_turn';

    const response: ProviderResponse = {
      content: text,
      toolUses,
      stopReason,
      raw: data,
    };
    if (data.usage) {
      response.usage = {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      };
    }
    return response;
  }
}

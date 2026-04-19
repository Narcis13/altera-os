import type {
  AgentMessage,
  LlmProvider,
  ProviderChatOptions,
  ProviderResponse,
} from '../types.ts';

export interface MockCall {
  messages: AgentMessage[];
  options: ProviderChatOptions;
}

export type MockScript = (call: MockCall, callIndex: number) => ProviderResponse;

export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly calls: MockCall[] = [];
  private readonly script: MockScript | ProviderResponse[];
  private readonly model: string;

  constructor(script: MockScript | ProviderResponse[], defaultModel = 'mock-model') {
    this.script = script;
    this.model = defaultModel;
  }

  defaultModel(): string {
    return this.model;
  }

  async chat(messages: AgentMessage[], options: ProviderChatOptions): Promise<ProviderResponse> {
    const call: MockCall = { messages: JSON.parse(JSON.stringify(messages)), options };
    const idx = this.calls.length;
    this.calls.push(call);
    if (typeof this.script === 'function') {
      return this.script(call, idx);
    }
    const scripted = this.script[idx];
    if (!scripted) {
      return { content: '(no scripted response)', toolUses: [], stopReason: 'end_turn' };
    }
    return scripted;
  }
}

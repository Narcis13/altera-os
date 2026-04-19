import type { z, ZodSchema } from 'zod';

export type AgentRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface AgentMessage {
  role: AgentRole;
  content: string | null;
  toolUses?: ToolUse[];
  toolResult?: ToolResult;
}

export interface ToolDefinition<S extends ZodSchema = ZodSchema> {
  name: string;
  description: string;
  parameters: S;
  execute(input: z.infer<S>, ctx: ToolContext): Promise<string> | string;
}

export interface ToolContext {
  tenantId: string;
  userId?: string | null;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ProviderChatOptions {
  model: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ProviderToolSpec[];
  signal?: AbortSignal;
}

export interface ProviderToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ProviderResponse {
  content: string | null;
  toolUses: ToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  raw?: unknown;
}

export interface LlmProvider {
  readonly name: string;
  defaultModel(): string;
  chat(messages: AgentMessage[], options: ProviderChatOptions): Promise<ProviderResponse>;
}

export interface AgentRunInput {
  messages: AgentMessage[];
  system?: string;
  model?: string;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  toolContext: ToolContext;
}

export interface AgentRunResult {
  finalContent: string | null;
  messages: AgentMessage[];
  toolsUsed: string[];
  iterations: number;
  stopReason: ProviderResponse['stopReason'];
}

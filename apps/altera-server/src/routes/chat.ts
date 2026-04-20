import {
  AnthropicProvider,
  MockProvider,
  ToolRegistry,
  createClassifyEntityTool,
  createQueryEntitiesTool,
  createSanitizeThenCallTool,
  createSetAttributeTool,
  runAgent,
  type AgentMessage,
  type AgentRuntimeEvent,
  type LlmProvider,
} from '@altera/agent';
import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import type { EventBus } from '@altera/events';
import { Hono } from 'hono';
import { z } from 'zod';

export interface ChatRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
  bus?: EventBus;
  anthropic?: {
    apiKey: string | null;
    model: string;
    enabled: boolean;
  };
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string().nullable().optional(),
  toolUses: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        input: z.record(z.unknown()),
      }),
    )
    .optional(),
  toolResult: z
    .object({
      toolUseId: z.string(),
      content: z.string(),
      isError: z.boolean().optional(),
    })
    .optional(),
});

const chatBodySchema = z.object({
  messages: z.array(messageSchema).min(1),
  system: z.string().optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
});

const DEFAULT_SYSTEM =
  'You are robun, the Altera OS assistant. You help users explore their entities, attributes, and tenant data via the available tools. Reply concisely.';

function buildProvider(deps: ChatRoutesDeps): {
  provider: LlmProvider;
  isMock: boolean;
  model: string;
} {
  if (deps.anthropic?.enabled && deps.anthropic.apiKey) {
    return {
      provider: new AnthropicProvider({
        apiKey: deps.anthropic.apiKey,
        defaultModel: deps.anthropic.model,
      }),
      isMock: false,
      model: deps.anthropic.model,
    };
  }
  const responses = [
    {
      content:
        "I'm running in offline/mock mode (set ANTHROPIC_API_KEY to enable real chat). " +
        'I can echo your request and list the tools available, but no real LLM calls are made.',
      toolUses: [],
      stopReason: 'end_turn' as const,
    },
  ];
  return {
    provider: new MockProvider(responses),
    isMock: true,
    model: 'mock',
  };
}

export function chatRoutes(deps: ChatRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.get('/status', (c) => {
    const enabled = !!(deps.anthropic?.enabled && deps.anthropic.apiKey);
    return c.json({
      enabled,
      provider: enabled ? 'anthropic' : 'mock',
      model: enabled ? deps.anthropic?.model ?? null : null,
    });
  });

  app.post('/messages', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid chat body', parsed.error.issues);

    const tools = new ToolRegistry();
    tools.registerAll([
      createQueryEntitiesTool({ db: deps.db }),
      createSetAttributeTool({ db: deps.db }),
      createClassifyEntityTool({ db: deps.db }),
      createSanitizeThenCallTool(),
    ]);

    const { provider, isMock, model } = buildProvider(deps);

    const messages: AgentMessage[] = parsed.data.messages.map((m) => {
      const out: AgentMessage = {
        role: m.role,
        content: m.content ?? null,
      };
      if (m.toolUses) out.toolUses = m.toolUses;
      if (m.toolResult) out.toolResult = m.toolResult;
      return out;
    });

    const runtimeEvents: AgentRuntimeEvent[] = [];
    const result = await runAgent({
      provider,
      tools,
      input: {
        messages,
        system: parsed.data.system ?? DEFAULT_SYSTEM,
        toolContext: {
          tenantId: principal.tenantId,
          userId: principal.userId,
        },
        ...(parsed.data.maxIterations ? { maxIterations: parsed.data.maxIterations } : {}),
        model,
      },
      onEvent: (ev) => {
        runtimeEvents.push(ev);
      },
    });

    return c.json({
      provider: isMock ? 'mock' : 'anthropic',
      model,
      finalContent: result.finalContent,
      messages: result.messages,
      toolsUsed: result.toolsUsed,
      iterations: result.iterations,
      stopReason: result.stopReason,
      events: runtimeEvents,
    });
  });

  return app;
}

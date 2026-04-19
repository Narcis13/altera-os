import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { MockProvider } from './providers/mock.ts';
import { ToolRegistry } from './registry.ts';
import { runAgent } from './loop.ts';
import type { ToolContext, ToolDefinition } from './types.ts';

const CTX: ToolContext = { tenantId: 'tnt_test' };

function echoTool(): ToolDefinition {
  return {
    name: 'echo',
    description: 'echo the input message',
    parameters: z.object({ message: z.string() }),
    execute: async (input) => `echoed: ${input.message}`,
  };
}

describe('ToolRegistry', () => {
  test('register/has/names', () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    expect(reg.has('echo')).toBe(true);
    expect(reg.names()).toEqual(['echo']);
    expect(reg.size()).toBe(1);
  });

  test('double-register throws', () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    expect(() => reg.register(echoTool())).toThrow(/already registered/);
  });

  test('execute runs through Zod validation', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const ok = await reg.execute('echo', { message: 'hi' }, CTX);
    expect(ok).toBe('echoed: hi');
    const bad = await reg.execute('echo', { wrong: 1 }, CTX);
    expect(bad).toMatch(/Invalid parameters/);
  });

  test('execute returns error for missing tool', async () => {
    const reg = new ToolRegistry();
    const out = await reg.execute('nope', {}, CTX);
    expect(out).toMatch(/not found/);
  });

  test('toProviderSpecs emits JSON Schema', () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const specs = reg.toProviderSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0]!.name).toBe('echo');
    expect(specs[0]!.inputSchema).toBeTruthy();
  });
});

describe('runAgent', () => {
  test('single-turn with no tools returns final content', async () => {
    const provider = new MockProvider([
      { content: 'hello back', toolUses: [], stopReason: 'end_turn' },
    ]);
    const reg = new ToolRegistry();

    const result = await runAgent({
      provider,
      tools: reg,
      input: {
        messages: [{ role: 'user', content: 'hi' }],
        toolContext: CTX,
      },
    });

    expect(result.finalContent).toBe('hello back');
    expect(result.toolsUsed).toEqual([]);
    expect(result.iterations).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  test('invokes tool then returns final response', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());

    const provider = new MockProvider([
      {
        content: null,
        toolUses: [{ id: 'tu_1', name: 'echo', input: { message: 'ping' } }],
        stopReason: 'tool_use',
      },
      { content: 'done', toolUses: [], stopReason: 'end_turn' },
    ]);

    const result = await runAgent({
      provider,
      tools: reg,
      input: {
        messages: [{ role: 'user', content: 'use the echo tool' }],
        toolContext: CTX,
      },
    });

    expect(result.toolsUsed).toEqual(['echo']);
    expect(result.finalContent).toBe('done');
    expect(result.iterations).toBe(2);

    const secondCall = provider.calls[1]!;
    const lastMsg = secondCall.messages.at(-1);
    expect(lastMsg?.role).toBe('tool');
    expect(lastMsg?.toolResult?.content).toBe('echoed: ping');
  });

  test('emits runtime events via onEvent callback', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());

    const provider = new MockProvider([
      {
        content: null,
        toolUses: [{ id: 'tu_1', name: 'echo', input: { message: 'x' } }],
        stopReason: 'tool_use',
      },
      { content: 'ok', toolUses: [], stopReason: 'end_turn' },
    ]);

    const events: string[] = [];
    await runAgent({
      provider,
      tools: reg,
      input: {
        messages: [{ role: 'user', content: 'go' }],
        toolContext: CTX,
      },
      onEvent: (e) => events.push(e.type),
    });

    expect(events).toContain('iteration.start');
    expect(events).toContain('tool.call');
    expect(events).toContain('tool.result');
    expect(events[events.length - 1]).toBe('run.finish');
  });

  test('respects maxIterations', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());

    const provider = new MockProvider(() => ({
      content: null,
      toolUses: [{ id: 'tu_x', name: 'echo', input: { message: 'x' } }],
      stopReason: 'tool_use',
    }));

    const result = await runAgent({
      provider,
      tools: reg,
      input: {
        messages: [{ role: 'user', content: 'loop' }],
        toolContext: CTX,
        maxIterations: 3,
      },
    });
    expect(result.iterations).toBe(3);
    expect(provider.calls).toHaveLength(3);
  });
});

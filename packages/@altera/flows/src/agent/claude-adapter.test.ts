import { describe, expect, test } from 'bun:test';
import { MockProvider } from '@altera/agent';
import { executeWorkflow } from '../core/execution-engine.ts';
import { parseWorkflowYaml } from '../dsl/loader.ts';
import { createBuiltinFlowTools } from '../tools/builtin.ts';
import { createClaudeAdapter } from './claude-adapter.ts';
import { createAgentAdapterRegistry, registerAgentAdapter } from './runtime.ts';

describe('S6.5 Claude adapter for glyphrail', () => {
  test('sanitizes prompt before calling provider and parses JSON response', async () => {
    const provider = new MockProvider((call) => {
      const text = (call.messages[0]?.content ?? '') as string;
      expect(text).toContain('[EMAIL_1]');
      expect(text).not.toContain('alice@example.com');
      return {
        content: '{"classification":"invoice","confidence":0.9}',
        toolUses: [],
        stopReason: 'end_turn',
      };
    });
    const adapter = createClaudeAdapter({ provider, name: 'claude' });
    const result = await adapter.runStructured({
      runId: 'run_1',
      stepId: 'step_1',
      tenantId: 'tnt_1',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      objective: 'Classify this text for tenant alice@example.com',
      prompt: '',
      attempt: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ classification: 'invoice', confidence: 0.9 });
      expect(result.meta?.sanitized).toBe(true);
    }
  });

  test('executeWorkflow uses the Claude adapter for agent steps', async () => {
    const provider = new MockProvider([
      {
        content: '{"intent":"greeting"}',
        toolUses: [],
        stopReason: 'end_turn',
      },
    ]);
    const adapters = createAgentAdapterRegistry();
    registerAgentAdapter(adapters, createClaudeAdapter({ provider, name: 'claude' }));

    const workflow = parseWorkflowYaml(`
version: "1.0"
name: classify
steps:
  - id: classify
    kind: agent
    provider: claude
    model: claude-sonnet-4-5
    objective: Classify the input
    input:
      text: \${input.text}
    outputSchema:
      type: object
      properties:
        intent: { type: string }
    save: classification
  - id: finish
    kind: return
    output: \${state.classification}
`);

    const record = await executeWorkflow(
      {
        tools: createBuiltinFlowTools(),
        agents: adapters,
        env: {},
        idGenerator: () => 'run_static',
      },
      {
        tenantId: 'tnt_1',
        workflow,
        input: { text: 'Hi there!' },
      },
    );
    expect(record.status).toBe('completed');
    expect(record.output).toEqual({ intent: 'greeting' });
    expect(provider.calls).toHaveLength(1);
  });
});

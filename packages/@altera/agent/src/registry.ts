import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ProviderToolSpec, ToolContext, ToolDefinition } from './types.ts';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: ToolDefinition[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  size(): number {
    return this.tools.size;
  }

  toProviderSpecs(): ProviderToolSpec[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.parameters, { target: 'openApi3' }),
    }));
  }

  async execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: tool '${name}' not found`;
    let parsed: unknown;
    try {
      parsed = tool.parameters.parse(rawInput ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        return `Invalid parameters for ${name}: ${err.errors
          .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('; ')}`;
      }
      return `Invalid parameters for ${name}: ${(err as Error).message}`;
    }
    try {
      const out = await tool.execute(parsed as never, ctx);
      return typeof out === 'string' ? out : JSON.stringify(out);
    } catch (err) {
      return `Error executing ${name}: ${(err as Error).message}`;
    }
  }
}

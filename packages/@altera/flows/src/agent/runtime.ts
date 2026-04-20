import type { JsonValue } from '../core/types.ts';
import type { AgentAdapter, AgentAdapterRegistry } from './contracts.ts';
import { mockAgentAdapter } from './mock-adapter.ts';

export function createAgentAdapterRegistry(): AgentAdapterRegistry {
  const map: AgentAdapterRegistry = new Map();
  map.set(mockAgentAdapter.name, mockAgentAdapter);
  return map;
}

export function registerAgentAdapter(registry: AgentAdapterRegistry, adapter: AgentAdapter): void {
  registry.set(adapter.name, adapter);
}

export function buildStructuredPrompt(input: {
  objective: string;
  instructions?: string;
  input?: JsonValue;
  outputSchema?: unknown;
}): string {
  const sections: string[] = [];
  sections.push(`Objective:\n${input.objective}`);
  if (input.instructions?.trim()) {
    sections.push(`Instructions:\n${input.instructions.trim()}`);
  }
  sections.push(`Input JSON:\n${JSON.stringify(input.input ?? {}, null, 2)}`);
  if (input.outputSchema) {
    sections.push(
      `You MUST respond with a single valid JSON value matching this schema:\n${JSON.stringify(
        input.outputSchema,
        null,
        2,
      )}\nRespond with ONLY the JSON value, no markdown fences, no commentary.`,
    );
  } else {
    sections.push('Respond with ONLY a valid JSON value. No markdown fences, no commentary.');
  }
  return sections.join('\n\n');
}

export function repairStructuredOutput(raw: string): JsonValue | undefined {
  const candidates = collectCandidates(raw);
  for (const c of candidates) {
    try {
      return JSON.parse(c) as JsonValue;
    } catch {
      continue;
    }
  }
  return undefined;
}

function collectCandidates(raw: string): string[] {
  const out = new Set<string>();
  const trimmed = raw.trim();
  if (!trimmed) return [];
  out.add(trimmed);
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) out.add(fenceMatch[1].trim());
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const starts = [objectStart, arrayStart].filter((n) => n >= 0);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) out.add(trimmed.slice(start, end + 1));
  }
  return [...out];
}

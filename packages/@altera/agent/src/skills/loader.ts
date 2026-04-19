import { readFileSync } from 'node:fs';
import type { SkillDefinition } from './types.ts';

interface Frontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  default_taxonomy?: string[];
  max_iterations?: number;
  model?: string;
}

export function parseSkillMarkdown(raw: string): SkillDefinition {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Skill file is missing frontmatter block');
  }
  const frontmatter = parseYamlSubset(match[1] ?? '') as Frontmatter;
  const body = (match[2] ?? '').trim();

  if (!frontmatter.name) throw new Error('Skill frontmatter missing "name"');
  if (!frontmatter.description) throw new Error('Skill frontmatter missing "description"');

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    tools: frontmatter.tools ?? [],
    defaultTaxonomy: frontmatter.default_taxonomy ?? [],
    maxIterations: frontmatter.max_iterations ?? 5,
    ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
    systemPrompt: body,
  };
}

export function loadSkillFromFile(path: string): SkillDefinition {
  const raw = readFileSync(path, 'utf-8');
  return parseSkillMarkdown(raw);
}

function parseYamlSubset(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split('\n');
  let currentKey: string | null = null;
  let currentArr: string[] | null = null;

  for (const raw of lines) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;

    const listMatch = raw.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey && currentArr) {
      currentArr.push(stripQuotes(listMatch[1]!.trim()));
      continue;
    }

    const kvMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kvMatch) {
      if (currentKey && currentArr) out[currentKey] = currentArr;
      currentKey = kvMatch[1]!;
      currentArr = null;
      const val = kvMatch[2]!.trim();
      if (val === '') {
        currentArr = [];
      } else if (/^-?\d+(\.\d+)?$/.test(val)) {
        out[currentKey] = Number(val);
      } else {
        out[currentKey] = stripQuotes(val);
      }
    }
  }
  if (currentKey && currentArr) out[currentKey] = currentArr;
  return out;
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

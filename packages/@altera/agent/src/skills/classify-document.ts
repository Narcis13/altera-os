import { resolve } from 'node:path';
import { loadSkillFromFile } from './loader.ts';
import type { SkillDefinition } from './types.ts';

const SKILL_PATH = resolve(import.meta.dir, './classify-document.md');

let cached: SkillDefinition | null = null;

export function loadClassifyDocumentSkill(): SkillDefinition {
  if (!cached) cached = loadSkillFromFile(SKILL_PATH);
  return cached;
}

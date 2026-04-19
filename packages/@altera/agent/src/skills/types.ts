export interface SkillDefinition {
  name: string;
  description: string;
  tools: string[];
  defaultTaxonomy: string[];
  maxIterations: number;
  model?: string;
  systemPrompt: string;
}

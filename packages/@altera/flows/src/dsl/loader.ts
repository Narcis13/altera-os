import { createFailure } from '../core/errors.ts';
import type { WorkflowDocument } from '../core/types.ts';
import { validateWorkflow } from './validation.ts';

export function parseWorkflowYaml(yaml: string, sourceLabel = 'workflow'): WorkflowDocument {
  let raw: unknown;
  try {
    raw = (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(yaml);
  } catch (err) {
    throw createFailure(
      'WORKFLOW_PARSE_ERROR',
      `Failed to parse YAML from ${sourceLabel}`,
      err instanceof Error ? err.message : err,
    );
  }
  return validateWorkflow(raw);
}

export async function loadWorkflowFile(path: string): Promise<WorkflowDocument> {
  const content = await Bun.file(path).text();
  return parseWorkflowYaml(content, path);
}

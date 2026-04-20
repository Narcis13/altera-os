import { z } from 'zod';
import { createFailure } from '../core/errors.ts';
import type { WorkflowDocument } from '../core/types.ts';

const jsonSchemaSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      type: z
        .enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
        .optional(),
      properties: z.record(jsonSchemaSchema).optional(),
      items: jsonSchemaSchema.optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(z.unknown()).optional(),
      additionalProperties: z.union([z.boolean(), jsonSchemaSchema]).optional(),
    })
    .passthrough(),
);

const stepBase = {
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  when: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
};

const stepSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      ...stepBase,
      kind: z.literal('assign'),
      set: z.record(z.unknown()),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('tool'),
      tool: z.string().min(1),
      input: z.record(z.unknown()).optional(),
      save: z.string().optional(),
      append: z.string().optional(),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('agent'),
      provider: z.string().optional(),
      model: z.string().optional(),
      objective: z.string().min(1),
      instructions: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      outputSchema: jsonSchemaSchema.optional(),
      save: z.string().optional(),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('if'),
      condition: z.string(),
      then: z.array(stepSchema),
      else: z.array(stepSchema).optional(),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('for_each'),
      items: z.string(),
      as: z.string(),
      steps: z.array(stepSchema),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('return'),
      output: z.unknown().optional(),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('fail'),
      message: z.string().optional(),
      error: z.string().optional(),
    }),
    z.object({
      ...stepBase,
      kind: z.literal('noop'),
    }),
  ]),
);

const workflowSchema = z.object({
  version: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: jsonSchemaSchema.optional(),
  outputSchema: jsonSchemaSchema.optional(),
  defaults: z
    .object({
      model: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
      maxStepRetries: z.number().int().nonnegative().optional(),
    })
    .optional(),
  policies: z
    .object({
      allowTools: z.array(z.string()).optional(),
      maxRunSteps: z.number().int().positive().optional(),
      maxRunDurationMs: z.number().int().positive().optional(),
    })
    .optional(),
  state: z.record(z.unknown()).optional(),
  steps: z.array(stepSchema).min(1),
  output: z.unknown().optional(),
});

export function validateWorkflow(raw: unknown): WorkflowDocument {
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    throw createFailure(
      'WORKFLOW_VALIDATION_ERROR',
      'Workflow document failed validation',
      parsed.error.issues,
    );
  }
  return parsed.data as WorkflowDocument;
}

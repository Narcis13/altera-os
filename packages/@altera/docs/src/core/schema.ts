import { z } from 'zod';

const comparisonOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
]);

const fieldConditionSchema = z.object({
  field: z.string(),
  op: comparisonOpSchema,
  value: z.unknown().optional(),
});

const conditionSchema: z.ZodType = z.lazy(() =>
  z.union([
    fieldConditionSchema,
    z.object({
      logic: z.enum(['and', 'or']),
      conditions: z.array(conditionSchema),
    }),
  ]),
);

const choiceOptionSchema = z.object({ value: z.string(), label: z.string() });

const fieldConstraintsSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  min_length: z.number().optional(),
  max_length: z.number().optional(),
  pattern: z.string().optional(),
  options: z.array(z.string()).optional(),
});

const documentComponentSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  mode: z.enum(['read', 'input']),

  bind: z.record(z.string()).optional(),
  variant: z.string().optional(),
  props: z.record(z.unknown()).optional(),

  label: z.string().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(choiceOptionSchema).optional(),
  constraints: fieldConstraintsSchema.optional(),
  default_value: z.unknown().optional(),
  required_when: conditionSchema.optional(),

  visible_when: conditionSchema.optional(),
});

const documentSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  layout: z.enum(['stack', 'columns']).optional(),
  columns: z.number().int().min(2).max(4).optional(),
  skip_when: conditionSchema.optional(),
  components: z.array(documentComponentSchema).min(1),
});

const documentThemeSchema = z
  .object({
    fontFamily: z.string().optional(),
    fontSize: z
      .object({
        base: z.string().optional(),
        heading: z.string().optional(),
        small: z.string().optional(),
        label: z.string().optional(),
      })
      .optional(),
    colors: z
      .object({
        primary: z.string().optional(),
        secondary: z.string().optional(),
        accent: z.string().optional(),
        border: z.string().optional(),
        background: z.string().optional(),
      })
      .optional(),
    spacing: z
      .object({
        section: z.string().optional(),
        component: z.string().optional(),
        cell: z.string().optional(),
      })
      .optional(),
    table: z
      .object({
        headerBg: z.string().optional(),
        borderColor: z.string().optional(),
        stripedRows: z.boolean().optional(),
      })
      .optional(),
    page: z
      .object({
        format: z.string().optional(),
        orientation: z.string().optional(),
        margin: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const documentSettingsSchema = z
  .object({
    submit_label: z.string().optional(),
    success_message: z.string().optional(),
    allow_partial: z.boolean().optional(),
    paginated: z.boolean().optional(),
  })
  .optional();

export const documentDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(['report', 'form', 'hybrid']),
  theme: documentThemeSchema,
  sections: z.array(documentSectionSchema).min(1),
  settings: documentSettingsSchema,
  metadata: z.record(z.unknown()).optional(),
});

export type DocumentDefinitionInput = z.infer<typeof documentDefinitionSchema>;

import { z } from 'zod';

export const TenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase alphanumeric with dashes'),
  settings: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const CreateTenantInput = TenantSchema.pick({ name: true, slug: true }).extend({
  settings: z.record(z.unknown()).optional(),
});
export type CreateTenantInput = z.infer<typeof CreateTenantInput>;

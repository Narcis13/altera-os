import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, USER_ROLES } from '../constants.ts';

export const UserRoleSchema = z.enum(USER_ROLES);

export const UserSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  username: z.string().min(2).max(64),
  email: z.string().email(),
  role: UserRoleSchema,
  createdAt: z.coerce.date(),
});

export type User = z.infer<typeof UserSchema>;

export const PublicUserSchema = UserSchema;
export type PublicUser = User;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);

export const RegisterInput = z.object({
  tenantSlug: z.string().min(2),
  username: z.string().min(2).max(64),
  email: z.string().email(),
  password: PasswordSchema,
  role: UserRoleSchema.optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  tenantSlug: z.string().min(2),
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

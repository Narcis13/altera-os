import { describe, expect, test } from 'bun:test';
import { LoginInput, RegisterInput, TenantSchema, UserSchema } from './index.ts';

describe('TenantSchema', () => {
  test('accepts valid tenant', () => {
    const parsed = TenantSchema.parse({
      id: 'tnt_1',
      name: 'Acme Hospital',
      slug: 'acme',
      settings: {},
      createdAt: new Date(),
    });
    expect(parsed.slug).toBe('acme');
  });

  test('rejects invalid slug', () => {
    expect(() =>
      TenantSchema.parse({
        id: 'tnt_1',
        name: 'x',
        slug: 'Bad Slug',
        settings: {},
        createdAt: new Date(),
      }),
    ).toThrow();
  });
});

describe('RegisterInput', () => {
  test('requires min 12-char password', () => {
    const res = RegisterInput.safeParse({
      tenantSlug: 'acme',
      username: 'narcis',
      email: 'n@example.com',
      password: 'short',
    });
    expect(res.success).toBe(false);
  });

  test('accepts strong password', () => {
    const res = RegisterInput.safeParse({
      tenantSlug: 'acme',
      username: 'narcis',
      email: 'n@example.com',
      password: 'correct-horse-battery-staple',
    });
    expect(res.success).toBe(true);
  });
});

describe('UserSchema & LoginInput', () => {
  test('UserSchema validates shape', () => {
    const parsed = UserSchema.parse({
      id: 'usr_1',
      tenantId: 'tnt_1',
      username: 'narcis',
      email: 'n@example.com',
      role: 'admin',
      createdAt: new Date(),
    });
    expect(parsed.role).toBe('admin');
  });

  test('LoginInput validates required fields', () => {
    const res = LoginInput.safeParse({
      tenantSlug: 'acme',
      usernameOrEmail: 'narcis',
      password: 'xxx',
    });
    expect(res.success).toBe(true);
  });
});

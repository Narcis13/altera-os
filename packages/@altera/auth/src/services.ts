import {
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type UserRole,
  conflict,
  notFound,
  unauthorized,
  validationError,
} from '@altera/core';
import { type AlteraDb, newId, schema } from '@altera/db';
import { and, eq } from 'drizzle-orm';
import {
  type AccessClaims,
  type JwtConfig,
  hashRefreshToken,
  newRefreshTokenRaw,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from './jwt.ts';
import { hashPassword, verifyPassword } from './passwords.ts';

export interface AuthDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

function toPublicUser(row: schema.UserRow): PublicUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    username: row.username,
    email: row.email,
    role: row.role as UserRole,
    createdAt: row.createdAt,
  };
}

export async function registerUser(deps: AuthDeps, input: RegisterInput): Promise<PublicUser> {
  const tenant = deps.db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, input.tenantSlug))
    .get();

  if (!tenant) throw notFound('Tenant not found');

  const existing = deps.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenant.id), eq(schema.users.username, input.username)))
    .get();
  if (existing) throw conflict('Username already taken in this tenant');

  const emailConflict = deps.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenant.id), eq(schema.users.email, input.email)))
    .get();
  if (emailConflict) throw conflict('Email already taken in this tenant');

  const id = newId('user');
  const passwordHash = await hashPassword(input.password);
  const createdAt = new Date();

  deps.db
    .insert(schema.users)
    .values({
      id,
      tenantId: tenant.id,
      username: input.username,
      email: input.email,
      passwordHash,
      role: input.role ?? 'user',
      createdAt,
    })
    .run();

  return {
    id,
    tenantId: tenant.id,
    username: input.username,
    email: input.email,
    role: input.role ?? 'user',
    createdAt,
  };
}

export async function loginUser(deps: AuthDeps, input: LoginInput): Promise<LoginResult> {
  const tenant = deps.db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, input.tenantSlug))
    .get();
  if (!tenant) throw unauthorized('Invalid credentials');

  const user = deps.db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.tenantId, tenant.id),
        // Match by username OR email
        eq(schema.users.username, input.usernameOrEmail),
      ),
    )
    .get();

  const userByEmail = user
    ? undefined
    : deps.db
        .select()
        .from(schema.users)
        .where(
          and(eq(schema.users.tenantId, tenant.id), eq(schema.users.email, input.usernameOrEmail)),
        )
        .get();

  const found = user ?? userByEmail;
  if (!found) throw unauthorized('Invalid credentials');

  const ok = await verifyPassword(input.password, found.passwordHash);
  if (!ok) throw unauthorized('Invalid credentials');

  const claims: Omit<AccessClaims, 'typ'> = {
    sub: found.id,
    tid: found.tenantId,
    role: found.role as UserRole,
    username: found.username,
  };

  const accessToken = await signAccessToken(deps.jwt, claims);
  const refreshRaw = newRefreshTokenRaw();
  const refreshToken = await signRefreshToken(deps.jwt, claims);

  const accessTtl = deps.jwt.accessTtlSec ?? 86_400;
  const refreshTtl = deps.jwt.refreshTtlSec ?? 604_800;
  const now = Date.now();
  const refreshExpiresAt = new Date(now + refreshTtl * 1000);
  const accessExpiresAt = new Date(now + accessTtl * 1000);

  deps.db
    .insert(schema.sessions)
    .values({
      id: newId('session'),
      userId: found.id,
      tokenHash: refreshRaw.hash,
      expiresAt: refreshExpiresAt,
      ip: null,
      userAgent: null,
      createdAt: new Date(now),
    })
    .run();

  return {
    user: toPublicUser(found),
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
  };
}

export async function logout(deps: AuthDeps, refreshToken: string): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  deps.db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hash)).run();
}

export async function resolveAccessToken(deps: AuthDeps, token: string): Promise<AccessClaims> {
  const claims = await verifyToken(deps.jwt, token);
  if (claims.typ !== 'access') throw unauthorized('Token is not an access token');
  return claims;
}

export async function getUserById(
  deps: AuthDeps,
  userId: string,
  tenantId: string,
): Promise<PublicUser | null> {
  const row = deps.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, tenantId)))
    .get();
  return row ? toPublicUser(row) : null;
}

export function assertPasswordStrength(pw: string): void {
  if (pw.length < 12) throw validationError('Password too short (min 12 chars)');
}

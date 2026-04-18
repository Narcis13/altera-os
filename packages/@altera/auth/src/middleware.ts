import { type AuthPrincipal, type UserRole, forbidden, unauthorized } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { schema } from '@altera/db';
import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { JwtConfig } from './jwt.ts';
import { verifyToken } from './jwt.ts';

export interface AuthMiddlewareDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

declare module 'hono' {
  interface ContextVariableMap {
    principal: AuthPrincipal;
    tenantId: string;
    tenantSlug: string;
  }
}

function bearer(c: Context): string | null {
  const hdr = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!hdr) return null;
  const match = hdr.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}

export function requireAuth(deps: AuthMiddlewareDeps): MiddlewareHandler {
  return async (c, next) => {
    const token = bearer(c);
    if (!token) throw unauthorized('Missing bearer token');

    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(deps.jwt, token);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    if (claims.typ !== 'access') throw unauthorized('Wrong token type');

    c.set('principal', {
      userId: claims.sub,
      username: claims.username,
      role: claims.role,
      tenantId: claims.tid,
    });
    c.set('tenantId', claims.tid);
    await next();
  };
}

export function requireRole(...allowed: UserRole[]): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get('principal');
    if (!principal) throw unauthorized('Not authenticated');
    if (!allowed.includes(principal.role)) throw forbidden('Role not permitted');
    await next();
  };
}

/**
 * Resolves the tenant slug from `X-Tenant` header or JWT, and validates existence.
 * Attaches `tenantSlug` to the context alongside `tenantId`.
 */
export function withTenant(deps: AuthMiddlewareDeps): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get('principal');
    if (!principal) throw unauthorized('Not authenticated');

    const tenant = deps.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, principal.tenantId))
      .get();
    if (!tenant) throw unauthorized('Tenant no longer exists');

    const headerSlug = c.req.header('x-tenant') ?? c.req.header('X-Tenant');
    if (headerSlug && headerSlug !== tenant.slug) {
      throw unauthorized('Tenant header mismatch');
    }

    c.set('tenantSlug', tenant.slug);
    await next();
  };
}

/**
 * Utility — restrict a lookup to a given tenant.
 */
export function enforceTenant<T extends { tenantId: string }>(row: T | null, tenantId: string): T {
  if (!row) throw unauthorized('Resource not found');
  if (row.tenantId !== tenantId) throw forbidden('Cross-tenant access denied');
  return row;
}

export { and, eq };

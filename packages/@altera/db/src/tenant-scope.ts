import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AlteraDb } from './client.ts';
import * as schema from './schema/index.ts';

/**
 * Scoped query builder — always adds `tenant_id = ?` to the WHERE clause.
 * Prevents accidental cross-tenant reads at dev-time.
 */
export interface TenantScopedDb {
  readonly tenantId: string;
  readonly db: AlteraDb;
  where<TTenantId extends { tenantId: unknown }>(column: TTenantId['tenantId']): SQL;
  eq<T>(column: T, value: unknown): SQL;
}

export function withTenant(db: AlteraDb, tenantId: string): TenantScopedDb {
  if (!tenantId) {
    throw new Error('withTenant requires a non-empty tenantId');
  }
  return {
    tenantId,
    db,
    where(column) {
      return eq(column as never, tenantId);
    },
    eq(column, value) {
      return sql`${column} = ${value}`;
    },
  };
}

export { schema };

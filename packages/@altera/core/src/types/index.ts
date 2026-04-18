import type { UserRole } from '../constants.ts';

export interface TenantScope {
  tenantId: string;
  tenantSlug: string;
}

export interface AuthPrincipal {
  userId: string;
  username: string;
  role: UserRole;
  tenantId: string;
}

export interface ActionContext {
  principal: AuthPrincipal;
  tenant: TenantScope;
  requestId: string;
  now: Date;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

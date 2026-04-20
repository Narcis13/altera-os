export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: {
    id: string;
    tenantId: string;
    username: string;
    email: string;
    role: 'admin' | 'user' | 'agent';
    createdAt: string;
  };
}

const STORAGE_KEY = 'altera.session';

export const sessionStore = {
  get(): Session | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(s: Session): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  },
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = sessionStore.get();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (session) headers.set('authorization', `Bearer ${session.accessToken}`);

  const res = await fetch(path, { ...init, headers });
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err = (body as ApiError).error ?? {
      code: `HTTP_${res.status}`,
      message: typeof body === 'string' ? body : 'Request failed',
    };
    throw Object.assign(new Error(err.message), err);
  }
  return body as T;
}

export interface FileListItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  hashSha256: string;
  uploadedAt: string;
}

export interface FileListResponse {
  files: FileListItem[];
  limit: number;
  offset: number;
}

export type EntityStatus = 'raw' | 'classified' | 'structured' | 'archived';

export interface EntityListItem {
  id: string;
  entityType: string | null;
  name: string | null;
  status: EntityStatus;
  classificationConfidence: number | null;
  sourceFileId: string | null;
  ingestedAt: string;
}

export interface EntityListResponse {
  entities: EntityListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface EntityListParams {
  entityType?: string;
  status?: EntityStatus[];
  search?: string;
  sourceFileId?: string;
  orderBy?: 'ingestedAt:asc' | 'ingestedAt:desc';
  limit?: number;
  offset?: number;
}

export interface EntityAttribute {
  id: string;
  key: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueJson: unknown;
  isSensitive: boolean;
  extractedBy: 'agent' | 'user' | 'structured_import';
  confidence: number | null;
  createdAt: string;
}

export interface EntityDetailResponse {
  entity: EntityListItem;
  attributes: EntityAttribute[];
}

export interface EntitySearchHit {
  entityId: string;
  attributeId: string;
  key: string;
  snippet: string;
  rank: number;
}

export interface EntitySearchResponse {
  query: string;
  hits: EntitySearchHit[];
}

export interface TaxonomyEntry {
  entityType: string;
  description: string | null;
  createdAt?: string;
}

export type TaxonomyEntryInput = { entityType: string; description?: string };

export interface TaxonomyResponse {
  entries: TaxonomyEntry[];
  defaults: string[];
}

export interface FileDetail {
  file: FileListItem & { storagePath: string };
  entity: {
    id: string;
    status: string;
    entityType: string | null;
    name: string | null;
    ingestedAt: string;
  } | null;
  rawText: string | null;
  parseMetadata: unknown;
}

export interface DashboardStats {
  tenant: {
    id: string;
    slug: string;
    name: string;
    createdAt: string;
    userCount: number;
  } | null;
  counts: {
    files: number;
    entities: number;
    templates: number;
    renders: number;
    workflows: number;
  };
  entitiesByType: Array<{ entityType: string; count: number }>;
  activeWorkflows: Array<{
    id: string;
    workflowName: string;
    status: string;
    startedAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    type: string;
    createdAt: string;
    payload: unknown;
  }>;
}

export interface DocsTemplateListItem {
  id: string;
  slug: string;
  kind: 'report' | 'form' | 'hybrid';
  status: 'draft' | 'published' | 'archived';
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocsTemplateDetail {
  id: string;
  slug: string;
  kind: 'report' | 'form' | 'hybrid';
  status: 'draft' | 'published' | 'archived';
  definition: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface DocsRenderListItem {
  id: string;
  templateId: string | null;
  status: 'success' | 'error';
  renderedAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface DocsRenderDetail extends DocsRenderListItem {
  html: string;
  errors: unknown[];
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  toolResult?: { toolUseId: string; content: string; isError?: boolean };
}

export type AgentRuntimeEvent =
  | { type: 'iteration.start'; iteration: number }
  | { type: 'provider.response'; iteration: number; stopReason: string }
  | { type: 'tool.call'; iteration: number; toolName: string; input: unknown }
  | {
      type: 'tool.result';
      iteration: number;
      toolName: string;
      output: string;
      isError: boolean;
    }
  | { type: 'run.finish'; iterations: number; stopReason: string };

export interface ChatStatus {
  enabled: boolean;
  provider: 'anthropic' | 'mock';
  model: string | null;
}

export interface ChatResponse {
  provider: 'anthropic' | 'mock';
  model: string;
  finalContent: string | null;
  messages: AgentMessage[];
  toolsUsed: string[];
  iterations: number;
  stopReason: string;
  events: AgentRuntimeEvent[];
}

export const api = {
  login(input: { tenantSlug: string; usernameOrEmail: string; password: string }) {
    return request<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  logout(refreshToken: string) {
    return request<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  me() {
    return request<{ user: Session['user']; tenantSlug: string }>('/api/me');
  },

  health() {
    return request<{ ok: boolean; service: string }>('/api/health');
  },

  debugEmit(input: { type: string; payload?: unknown }) {
    return request<{ id: string; type: string; createdAt: string }>('/api/events/debug-emit', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listFiles(input: { limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.offset !== undefined) params.set('offset', String(input.offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<FileListResponse>(`/api/files${qs}`);
  },

  getFile(id: string) {
    return request<FileDetail>(`/api/files/${id}`);
  },

  listEntities(input: EntityListParams = {}) {
    const params = new URLSearchParams();
    if (input.entityType) params.set('entityType', input.entityType);
    if (input.status) {
      for (const s of input.status) params.append('status', s);
    }
    if (input.search) params.set('search', input.search);
    if (input.sourceFileId) params.set('sourceFileId', input.sourceFileId);
    if (input.orderBy) params.set('orderBy', input.orderBy);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.offset !== undefined) params.set('offset', String(input.offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<EntityListResponse>(`/api/entities${qs}`);
  },

  getEntity(id: string) {
    return request<EntityDetailResponse>(`/api/entities/${id}`);
  },

  searchEntities(q: string, limit = 25) {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return request<EntitySearchResponse>(`/api/entities/search?${params.toString()}`);
  },

  getTaxonomy() {
    return request<TaxonomyResponse>('/api/taxonomy');
  },

  putTaxonomy(input: { entries: TaxonomyEntryInput[]; replace?: boolean }) {
    return request<{ entries: TaxonomyEntry[] }>('/api/taxonomy', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  getDashboardStats() {
    return request<DashboardStats>('/api/dashboard/stats');
  },

  listTemplates(kind?: 'report' | 'form' | 'hybrid') {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    return request<{ templates: DocsTemplateListItem[] }>(`/api/docs/templates${qs}`);
  },

  getTemplate(id: string) {
    return request<{ template: DocsTemplateDetail }>(`/api/docs/templates/${id}`);
  },

  createTemplate(input: { slug: string; kind: 'report' | 'form' | 'hybrid'; definition: unknown }) {
    return request<{ template: DocsTemplateDetail }>('/api/docs/templates', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateTemplate(
    id: string,
    input: {
      slug?: string;
      definition?: unknown;
      status?: 'draft' | 'published' | 'archived';
    },
  ) {
    return request<{ template: DocsTemplateDetail }>(`/api/docs/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  renderTemplate(input: {
    templateId?: string;
    definition?: unknown;
    data: Record<string, unknown>;
    persist?: boolean;
  }) {
    return request<{
      render: DocsRenderListItem | null;
      html: string;
      errors: unknown[];
    }>('/api/docs/render', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listRenders(input: { templateId?: string; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (input.templateId) params.set('templateId', input.templateId);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.offset !== undefined) params.set('offset', String(input.offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{
      items: DocsRenderListItem[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/docs/renders${qs}`);
  },

  getRender(id: string) {
    return request<{ render: DocsRenderDetail }>(`/api/docs/renders/${id}`);
  },

  publishRender(id: string) {
    return request<{ render: DocsRenderListItem }>(`/api/docs/renders/${id}/publish`, {
      method: 'POST',
    });
  },

  chatStatus() {
    return request<ChatStatus>('/api/chat/status');
  },

  chat(input: { messages: AgentMessage[]; system?: string; maxIterations?: number }) {
    return request<ChatResponse>('/api/chat/messages', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async uploadFile(file: File): Promise<FileListItem> {
    const session = sessionStore.get();
    const fd = new FormData();
    fd.set('file', file);
    const headers: HeadersInit = {};
    if (session) headers.authorization = `Bearer ${session.accessToken}`;
    const res = await fetch('/api/files/upload', { method: 'POST', headers, body: fd });
    const body = await res.json();
    if (!res.ok) {
      const err = (body as ApiError).error ?? {
        code: `HTTP_${res.status}`,
        message: 'Upload failed',
      };
      throw Object.assign(new Error(err.message), err);
    }
    return body as FileListItem;
  },
};

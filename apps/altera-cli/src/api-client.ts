export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: {
    id: string;
    tenantId: string;
    username: string;
    email: string;
    role: string;
    createdAt: string;
  };
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      (typeof body === 'string' ? body : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return body as T;
}

export function login(
  apiUrl: string,
  input: { tenantSlug: string; usernameOrEmail: string; password: string },
): Promise<LoginResponse> {
  return call<LoginResponse>(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function logout(apiUrl: string, refreshToken: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`${apiUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
}

export function me(apiUrl: string, accessToken: string) {
  return call<{ user: LoginResponse['user']; tenantSlug: string }>(`${apiUrl}/api/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export interface UploadedFile {
  id: string;
  tenantId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  hashSha256: string;
  storagePath: string;
  uploadedAt: string;
}

export async function uploadFile(
  apiUrl: string,
  accessToken: string,
  input: { filename: string; data: Uint8Array; mimeType: string },
): Promise<UploadedFile> {
  const blob = new Blob([new Uint8Array(input.data)], { type: input.mimeType });
  const form = new FormData();
  form.set('file', blob, input.filename);
  return call<UploadedFile>(`${apiUrl}/api/files/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
}

export interface EntityListItem {
  id: string;
  entityType: string | null;
  name: string | null;
  status: string;
  sourceFileId: string | null;
  ingestedAt: string;
}

export function listEntities(
  apiUrl: string,
  accessToken: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ entities: EntityListItem[]; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  if (opts.offset !== undefined) qs.set('offset', String(opts.offset));
  const tail = qs.toString() ? `?${qs.toString()}` : '';
  return call(`${apiUrl}/api/entities${tail}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export interface EntityDetail {
  entity: EntityListItem & {
    classificationConfidence: number | null;
  };
  attributes: Array<{
    id: string;
    key: string;
    valueText: string | null;
    valueNumber: number | null;
    valueDate: string | null;
    valueJson: unknown;
    isSensitive: boolean;
    extractedBy: string;
    confidence: number | null;
    createdAt: string;
  }>;
}

export function getEntity(
  apiUrl: string,
  accessToken: string,
  id: string,
): Promise<EntityDetail> {
  return call(`${apiUrl}/api/entities/${id}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

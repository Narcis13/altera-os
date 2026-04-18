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

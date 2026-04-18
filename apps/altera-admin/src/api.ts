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
};

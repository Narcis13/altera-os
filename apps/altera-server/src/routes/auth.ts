import { type JwtConfig, RateLimiter, loginUser, logout, registerUser } from '@altera/auth';
import { LoginInput, RegisterInput, rateLimited, unauthorized } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { Hono } from 'hono';
import { z } from 'zod';

export interface AuthRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

const RefreshInput = z.object({ refreshToken: z.string().min(10) });

export function authRoutes(deps: AuthRoutesDeps): Hono {
  const app = new Hono();

  const loginLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });
  const registerLimiter = new RateLimiter({ windowMs: 60_000, max: 5 });

  app.post('/register', async (c) => {
    const ip = c.req.header('x-forwarded-for') ?? 'local';
    const rl = registerLimiter.check(`register:${ip}`);
    if (!rl.allowed) throw rateLimited('Too many registrations');

    const body = RegisterInput.parse(await c.req.json());
    const user = await registerUser(deps, body);
    return c.json({ user }, 201);
  });

  app.post('/login', async (c) => {
    const ip = c.req.header('x-forwarded-for') ?? 'local';
    const rl = loginLimiter.check(`login:${ip}`);
    if (!rl.allowed) throw rateLimited('Too many login attempts');

    const body = LoginInput.parse(await c.req.json());
    const result = await loginUser(deps, body);
    return c.json({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessExpiresAt: result.accessExpiresAt.toISOString(),
      refreshExpiresAt: result.refreshExpiresAt.toISOString(),
    });
  });

  app.post('/logout', async (c) => {
    const body = RefreshInput.parse(await c.req.json());
    await logout(deps, body.refreshToken);
    return c.json({ ok: true });
  });

  // Lightweight probe — verifies bearer without hitting DB.
  app.get('/ping', (c) => {
    const h = c.req.header('authorization');
    if (!h) throw unauthorized();
    return c.json({ ok: true });
  });

  return app;
}

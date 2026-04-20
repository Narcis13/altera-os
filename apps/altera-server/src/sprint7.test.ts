import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { buildApp } from './app.ts';
import type { ServerConfig } from './config.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../migrations');

let tmpDir: string;
let dbPath: string;

const baseConfig: ServerConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: '',
  dataDir: './data',
  maxUploadBytes: 10 * 1024 * 1024,
  jwtSecret: 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  jwtAccessTtlSec: 60,
  jwtRefreshTtlSec: 120,
  corsOrigins: ['*'],
  logLevel: 'error',
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'altera-srv-sprint7-'));
  dbPath = join(tmpDir, 'test.db');
  runMigrations({ dbUrl: dbPath, migrationsDir: MIGRATIONS_DIR, silent: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function bootstrap() {
  const { db } = createDb({ url: dbPath });
  db.insert(schema.tenants)
    .values({
      id: newId('tenant'),
      name: 'Acme',
      slug: 'acme',
      settingsJson: '{}',
      createdAt: new Date(),
    })
    .run();
  const app = buildApp({ db, config: { ...baseConfig, databaseUrl: dbPath } });

  await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantSlug: 'acme',
      username: 'alice',
      email: 'alice@acme.test',
      password: 'correct-horse-battery-staple',
    }),
  });
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantSlug: 'acme',
      usernameOrEmail: 'alice',
      password: 'correct-horse-battery-staple',
    }),
  });
  const body = (await login.json()) as { accessToken: string };
  return { app, db, accessToken: body.accessToken };
}

const templateDefinition = {
  id: 'doc-1',
  version: 1,
  title: 'Monthly Report',
  kind: 'report',
  sections: [
    {
      id: 'intro',
      components: [
        {
          id: 'title',
          type: 'heading',
          mode: 'read',
          bind: { content: 'title' },
          props: { level: 1 },
        },
        {
          id: 'summary',
          type: 'text',
          mode: 'read',
          bind: { content: 'summary' },
        },
      ],
    },
  ],
};

describe('S7.3 — dashboard stats endpoint', () => {
  test('returns counts, tenant info, and recent events', async () => {
    const { app, accessToken } = await bootstrap();
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const tplRes = await app.request('/api/docs/templates', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'dashboard-tpl',
        kind: 'report',
        definition: templateDefinition,
      }),
    });
    expect(tplRes.status).toBe(201);

    const renderRes = await app.request('/api/docs/render', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: ((await tplRes.json()) as { template: { id: string } }).template.id,
        data: { title: 'Hi', summary: 'There' },
      }),
    });
    expect(renderRes.status).toBe(200);

    const stats = await app.request('/api/dashboard/stats', { headers });
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as {
      tenant: { slug: string; userCount: number } | null;
      counts: {
        files: number;
        entities: number;
        templates: number;
        renders: number;
        workflows: number;
      };
      entitiesByType: Array<{ entityType: string; count: number }>;
      activeWorkflows: unknown[];
      recentEvents: Array<{ type: string }>;
    };
    expect(body.tenant?.slug).toBe('acme');
    expect(body.tenant?.userCount).toBe(1);
    expect(body.counts.templates).toBe(1);
    expect(body.counts.renders).toBe(1);
    expect(body.counts.files).toBe(0);
    expect(Array.isArray(body.entitiesByType)).toBe(true);
    expect(Array.isArray(body.activeWorkflows)).toBe(true);
    expect(Array.isArray(body.recentEvents)).toBe(true);
  });

  test('rejects unauthenticated requests', async () => {
    const { app } = await bootstrap();
    const res = await app.request('/api/dashboard/stats');
    expect(res.status).toBe(401);
  });
});

describe('S7.5 — render → preview → publish flow', () => {
  test('publishing a successful render stamps published_at and emits report.published', async () => {
    const { app, accessToken } = await bootstrap();
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const tpl = await app.request('/api/docs/templates', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'publish-tpl',
        kind: 'report',
        definition: templateDefinition,
      }),
    });
    const tplId = ((await tpl.json()) as { template: { id: string } }).template.id;

    const render = await app.request('/api/docs/render', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: tplId,
        data: { title: 'Published Thing', summary: 'Body' },
      }),
    });
    const renderBody = (await render.json()) as {
      render: { id: string; status: string };
      html: string;
    };
    expect(renderBody.render.status).toBe('success');
    expect(renderBody.html).toContain('Published Thing');

    const list = await app.request('/api/docs/renders', { headers });
    const listBody = (await list.json()) as { items: Array<{ id: string; publishedAt: string | null }> };
    expect(listBody.items.length).toBe(1);
    expect(listBody.items[0]?.publishedAt).toBeNull();

    const pub = await app.request(`/api/docs/renders/${renderBody.render.id}/publish`, {
      method: 'POST',
      headers,
    });
    expect(pub.status).toBe(200);
    const pubBody = (await pub.json()) as {
      render: { id: string; publishedAt: string | null; publishedBy: string | null };
    };
    expect(pubBody.render.publishedAt).toBeTruthy();
    expect(pubBody.render.publishedBy).toBeTruthy();

    const detail = await app.request(`/api/docs/renders/${renderBody.render.id}`, { headers });
    const detailBody = (await detail.json()) as {
      render: { publishedAt: string | null; html: string };
    };
    expect(detailBody.render.publishedAt).toBeTruthy();
    expect(detailBody.render.html).toContain('Published Thing');
  });

  test('publish rejects renders with status=error', async () => {
    const { app, accessToken } = await bootstrap();
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const requireDef = {
      id: 'doc-req',
      version: 1,
      title: 'Req',
      kind: 'report',
      sections: [
        {
          id: 'main',
          components: [
            {
              id: 'broken',
              type: 'definitely-not-a-real-component-type',
              mode: 'read',
              bind: { content: 'foo' },
            },
          ],
        },
      ],
    };

    const render = await app.request('/api/docs/render', {
      method: 'POST',
      headers,
      body: JSON.stringify({ definition: requireDef, data: {}, persist: true }),
    });
    const renderBody = (await render.json()) as {
      render: { id: string; status: string } | null;
      errors: unknown[];
    };
    expect(renderBody.render?.status).toBe('error');
    expect(renderBody.errors.length).toBeGreaterThan(0);

    const pub = await app.request(`/api/docs/renders/${renderBody.render?.id}/publish`, {
      method: 'POST',
      headers,
    });
    expect(pub.status).toBe(400);
  });
});

describe('S7.2 — chat HTTP endpoint', () => {
  test('returns mock-mode reply when ANTHROPIC_API_KEY is unset', async () => {
    const { app, accessToken } = await bootstrap();
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const status = await app.request('/api/chat/status', { headers });
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      enabled: boolean;
      provider: string;
    };
    expect(statusBody.enabled).toBe(false);
    expect(statusBody.provider).toBe('mock');

    const res = await app.request('/api/chat/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello robun' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider: string;
      finalContent: string | null;
      iterations: number;
      events: Array<{ type: string }>;
    };
    expect(body.provider).toBe('mock');
    expect(body.finalContent).toMatch(/mock mode/);
    expect(body.iterations).toBeGreaterThanOrEqual(1);
    expect(body.events.some((e) => e.type === 'run.finish')).toBe(true);
  });

  test('chat requires authentication', async () => {
    const { app } = await bootstrap();
    const res = await app.request('/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(401);
  });
});

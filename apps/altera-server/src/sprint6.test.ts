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
  tmpDir = mkdtempSync(join(tmpdir(), 'altera-srv-sprint6-'));
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
  return { app, accessToken: body.accessToken };
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

describe('S6.3 — docs HTTP API', () => {
  test('create template + render HTML via API', async () => {
    const { app, accessToken } = await bootstrap();
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const create = await app.request('/api/docs/templates', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        slug: 'monthly-report',
        kind: 'report',
        definition: templateDefinition,
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { template: { id: string; slug: string } };
    expect(created.template.slug).toBe('monthly-report');

    const render = await app.request('/api/docs/render', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: created.template.id,
        data: { title: 'April Report', summary: 'All metrics are up.' },
      }),
    });
    expect(render.status).toBe(200);
    const rendered = (await render.json()) as {
      html: string;
      errors: unknown[];
      render: { id: string; status: string } | null;
    };
    expect(rendered.html).toContain('<!DOCTYPE html>');
    expect(rendered.html).toContain('April Report');
    expect(rendered.html).toContain('All metrics are up.');
    expect(rendered.errors).toEqual([]);
    expect(rendered.render?.status).toBe('success');
  });
});

describe('S6.4 + S6.6 — flows HTTP API', () => {
  test('run a workflow adhoc and fetch its run', async () => {
    const { app, accessToken } = await bootstrap();
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    };

    const yaml = `
version: "1.0"
name: add
steps:
  - id: compute
    kind: assign
    set:
      total: "\${input.a + input.b}"
  - id: finish
    kind: return
    output:
      total: \${state.total}
`;

    const run = await app.request('/api/flows/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ yaml, input: { a: 10, b: 32 } }),
    });
    expect(run.status).toBe(200);
    const runBody = (await run.json()) as {
      run: {
        id: string;
        status: string;
        output: { total: number } | null;
      };
    };
    expect(runBody.run.status).toBe('completed');
    expect(runBody.run.output?.total).toBe(42);

    const fetched = await app.request(`/api/flows/runs/${runBody.run.id}`, {
      headers,
    });
    expect(fetched.status).toBe(200);
    const fetchedBody = (await fetched.json()) as {
      run: { status: string; output: { total: number } };
    };
    expect(fetchedBody.run.status).toBe('completed');
    expect(fetchedBody.run.output.total).toBe(42);

    const defs = await app.request('/api/flows/definitions', { headers });
    const defsBody = (await defs.json()) as { definitions: Array<{ name: string }> };
    expect(defsBody.definitions.find((d) => d.name === 'add')).toBeDefined();

    const rerun = await app.request('/api/flows/definitions/add/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: { a: 1, b: 1 } }),
    });
    expect(rerun.status).toBe(200);
    const rerunBody = (await rerun.json()) as { run: { output: { total: number } } };
    expect(rerunBody.run.output.total).toBe(2);
  });
});

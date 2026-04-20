import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { createWorkflowService } from './workflow-service.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-flows-'));
  dbPath = join(tmp, 'test.db');
  runMigrations({ dbUrl: dbPath, migrationsDir: MIGRATIONS_DIR, silent: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function bootstrapTenant(db: ReturnType<typeof createDb>['db']): string {
  const tenantId = newId('tenant');
  db.insert(schema.tenants)
    .values({
      id: tenantId,
      name: 'Acme',
      slug: 'acme',
      settingsJson: '{}',
      createdAt: new Date(),
    })
    .run();
  return tenantId;
}

const simpleYaml = `
version: "1.0"
name: demo-greeting
description: Greets the caller
steps:
  - id: set-msg
    kind: assign
    set:
      greeting: "\${'Hello, ' + input.name}"
  - id: echo-it
    kind: tool
    tool: echo
    input:
      greeting: \${state.greeting}
    save: echoed
  - id: done
    kind: return
    output:
      greeting: \${state.greeting}
      echoed: \${state.echoed}
`;

describe('S6.4 workflow service', () => {
  test('loads YAML, executes, persists run in DB', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    try {
      const tenantId = bootstrapTenant(db);
      const service = createWorkflowService({ db });

      const record = await service.runFromYaml({
        tenantId,
        yaml: simpleYaml,
        input: { name: 'Ada' },
      });

      expect(record.status).toBe('completed');
      expect(record.output).toEqual({
        greeting: 'Hello, Ada',
        echoed: { greeting: 'Hello, Ada' },
      });

      const row = service.getRun(tenantId, record.runId);
      expect(row?.status).toBe('completed');
      expect(row?.workflowName).toBe('demo-greeting');

      const events = service.listEvents(tenantId, record.runId);
      expect(events.find((e) => e.event === 'run.started')).toBeDefined();
      expect(events.find((e) => e.event === 'run.completed')).toBeDefined();
      expect(events.some((e) => e.event === 'tool.completed')).toBe(true);

      const definitionRow = service.definitions.getByName(tenantId, 'demo-greeting');
      expect(definitionRow?.version).toBe('1.0');
    } finally {
      sqlite.close();
    }
  });

  test('fails gracefully on unknown tool and records error', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    try {
      const tenantId = bootstrapTenant(db);
      const service = createWorkflowService({ db });

      const record = await service.runFromYaml({
        tenantId,
        yaml: `
version: "1.0"
name: bad-workflow
steps:
  - id: boom
    kind: tool
    tool: does-not-exist
`,
      });
      expect(record.status).toBe('failed');
      expect(record.error?.code).toBe('UNKNOWN_TOOL');
      const row = service.getRun(tenantId, record.runId);
      expect(row?.status).toBe('failed');
      expect(row?.error?.code).toBe('UNKNOWN_TOOL');
    } finally {
      sqlite.close();
    }
  });

  test('runs the built-in render-document tool end-to-end', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    try {
      const tenantId = bootstrapTenant(db);
      const service = createWorkflowService({ db });
      // Make sure components are registered for renderDocument
      const { registerReadOnlyComponents, clearRegistry } = await import('@altera/docs');
      clearRegistry();
      registerReadOnlyComponents();

      const yaml = `
version: "1.0"
name: render-demo
steps:
  - id: render
    kind: tool
    tool: render-document
    input:
      definition:
        id: d1
        version: 1
        title: Report
        kind: report
        sections:
          - id: s1
            components:
              - id: h
                type: heading
                mode: read
                bind: { content: title }
      data:
        title: "Hello Render"
    save: rendered
  - id: out
    kind: return
    output: \${state.rendered}
`;

      const record = await service.runFromYaml({
        tenantId,
        yaml,
      });
      expect(record.status).toBe('completed');
      const out = record.output as { html: string };
      expect(out.html).toContain('<!DOCTYPE html>');
      expect(out.html).toContain('Hello Render');
    } finally {
      sqlite.close();
    }
  });

  test('runByName fetches stored definition and executes it', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    try {
      const tenantId = bootstrapTenant(db);
      const service = createWorkflowService({ db });
      service.definitions.upsertFromYaml(tenantId, simpleYaml, 'fixture');

      const record = await service.runByName({
        tenantId,
        name: 'demo-greeting',
        input: { name: 'Grace' },
      });
      expect(record.status).toBe('completed');
      expect((record.output as { greeting: string }).greeting).toBe('Hello, Grace');
    } finally {
      sqlite.close();
    }
  });
});

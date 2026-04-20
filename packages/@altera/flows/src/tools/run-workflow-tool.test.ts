import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, newId, runMigrations, schema } from '@altera/db';
import { createWorkflowService } from '../services/workflow-service.ts';
import { createRunWorkflowTool } from './run-workflow-tool.ts';

const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../../migrations');

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'altera-flows-tool-'));
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

describe('S6.6 run_workflow tool', () => {
  test('agent can trigger a workflow by name and read its result', async () => {
    const { db, sqlite } = createDb({ url: dbPath });
    try {
      const tenantId = bootstrapTenant(db);
      const service = createWorkflowService({ db });

      service.definitions.upsertFromYaml(
        tenantId,
        `
version: "1.0"
name: add-numbers
steps:
  - id: compute
    kind: assign
    set:
      total: "\${input.a + input.b}"
  - id: done
    kind: return
    output:
      total: \${state.total}
`,
        'fixture',
      );

      const tool = createRunWorkflowTool({ workflows: service });
      const parsed = tool.parameters.parse({
        workflow: 'add-numbers',
        params: { a: 2, b: 3 },
      });
      const out = await tool.execute(parsed as never, { tenantId });
      const body = JSON.parse(out) as {
        status: string;
        output: { total: number } | null;
        runId: string;
      };
      expect(body.status).toBe('completed');
      expect(body.output?.total).toBe(5);
      expect(body.runId).toMatch(/^run_/);
    } finally {
      sqlite.close();
    }
  });
});

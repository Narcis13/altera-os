import { AnthropicProvider } from '@altera/agent';
import { type JwtConfig, requireAuth } from '@altera/auth';
import { notFound, validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import {
  type WorkflowService,
  createClaudeAdapter,
  createWorkflowService,
  registerAgentAdapter,
} from '@altera/flows';
import { Hono } from 'hono';
import { z } from 'zod';

export interface FlowsRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
  anthropic?: {
    apiKey: string | null;
    model: string;
    enabled: boolean;
  };
}

const createDefinitionSchema = z.object({
  yaml: z.string().min(1),
  source: z.string().min(1).optional(),
});

const runAdhocSchema = z.object({
  yaml: z.string().min(1),
  input: z.record(z.unknown()).optional(),
  persistDefinition: z.boolean().optional(),
});

const runByNameSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

export function flowsRoutes(deps: FlowsRoutesDeps): Hono {
  const service = buildWorkflowService(deps);

  const app = new Hono();
  app.use('*', requireAuth(deps));

  app.get('/definitions', (c) => {
    const principal = c.get('principal');
    const items = service.definitions.list(principal.tenantId);
    return c.json({
      definitions: items.map((d) => ({
        id: d.id,
        name: d.name,
        version: d.version,
        source: d.source,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
    });
  });

  app.post('/definitions', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = createDefinitionSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid workflow definition', parsed.error.issues);

    try {
      const def = service.definitions.upsertFromYaml(
        principal.tenantId,
        parsed.data.yaml,
        parsed.data.source ?? 'api',
      );
      return c.json(
        {
          definition: {
            id: def.id,
            name: def.name,
            version: def.version,
            source: def.source,
            createdAt: def.createdAt.toISOString(),
            updatedAt: def.updatedAt.toISOString(),
          },
        },
        201,
      );
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown };
      throw validationError(e.message ?? 'Failed to parse workflow', e.details ?? e.code);
    }
  });

  app.get('/definitions/:name', (c) => {
    const principal = c.get('principal');
    const def = service.definitions.getByName(principal.tenantId, c.req.param('name'));
    if (!def) throw notFound('Workflow definition not found');
    return c.json({
      definition: {
        id: def.id,
        name: def.name,
        version: def.version,
        source: def.source,
        document: def.document,
        createdAt: def.createdAt.toISOString(),
        updatedAt: def.updatedAt.toISOString(),
      },
    });
  });

  app.post('/runs', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = runAdhocSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid workflow run body', parsed.error.issues);

    try {
      const record = await service.runFromYaml({
        tenantId: principal.tenantId,
        yaml: parsed.data.yaml,
        input: (parsed.data.input ?? null) as never,
        persistDefinition: parsed.data.persistDefinition,
      });
      return c.json({ run: serializeRun(record) });
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown };
      throw validationError(e.message ?? 'Failed to run workflow', e.details ?? e.code);
    }
  });

  app.post('/definitions/:name/runs', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = runByNameSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid workflow run body', parsed.error.issues);

    const def = service.definitions.getByName(principal.tenantId, c.req.param('name'));
    if (!def) throw notFound('Workflow definition not found');

    const record = await service.runByName({
      tenantId: principal.tenantId,
      name: def.name,
      input: (parsed.data.input ?? null) as never,
    });
    return c.json({ run: serializeRun(record) });
  });

  app.get('/runs', (c) => {
    const principal = c.get('principal');
    const limit = Number.parseInt(c.req.query('limit') ?? '20', 10) || 20;
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const rows = service.listRuns(principal.tenantId, { limit, offset });
    return c.json({
      items: rows.map((r) => ({
        id: r.runId,
        workflowName: r.workflowName,
        workflowVersion: r.workflowVersion,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        visitedSteps: r.visitedSteps,
        elapsedMs: r.elapsedMs,
      })),
      limit,
      offset,
    });
  });

  app.get('/runs/:id', (c) => {
    const principal = c.get('principal');
    const row = service.getRun(principal.tenantId, c.req.param('id'));
    if (!row) throw notFound('Workflow run not found');
    return c.json({
      run: {
        id: row.runId,
        workflowName: row.workflowName,
        workflowVersion: row.workflowVersion,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        visitedSteps: row.visitedSteps,
        elapsedMs: row.elapsedMs,
        input: row.input,
        output: row.output,
        state: row.state,
        error: row.error,
      },
    });
  });

  app.get('/runs/:id/events', (c) => {
    const principal = c.get('principal');
    const row = service.getRun(principal.tenantId, c.req.param('id'));
    if (!row) throw notFound('Workflow run not found');
    const events = service.listEvents(principal.tenantId, row.runId);
    return c.json({ events });
  });

  return app;
}

function serializeRun(record: {
  runId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  input: unknown;
  output?: unknown;
  state: unknown;
  visitedSteps: number;
  elapsedMs: number;
  error?: unknown;
  workflow: { name: string; version: string; source: string };
}) {
  return {
    id: record.runId,
    status: record.status,
    workflow: record.workflow,
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? null,
    input: record.input,
    output: record.output ?? null,
    state: record.state,
    visitedSteps: record.visitedSteps,
    elapsedMs: record.elapsedMs,
    error: record.error ?? null,
  };
}

function buildWorkflowService(deps: FlowsRoutesDeps): WorkflowService {
  const service = createWorkflowService({ db: deps.db });
  if (deps.anthropic?.enabled && deps.anthropic.apiKey) {
    const provider = new AnthropicProvider({
      apiKey: deps.anthropic.apiKey,
      defaultModel: deps.anthropic.model,
    });
    const adapter = createClaudeAdapter({ provider, name: 'claude' });
    registerAgentAdapter(service.agents, adapter);
  }
  return service;
}

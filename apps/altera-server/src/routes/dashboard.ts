import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { type AlteraDb, schema } from '@altera/db';
import { Hono } from 'hono';
import { and, count, desc, eq, sql } from 'drizzle-orm';

export interface DashboardRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
}

const ACTIVE_WORKFLOW_STATUSES = ['running', 'paused'] as const;

export function dashboardRoutes(deps: DashboardRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.get('/stats', (c) => {
    const principal = c.get('principal');
    const tenantId = principal.tenantId;

    const tenant = deps.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .get();

    const userCount = deps.db
      .select({ n: count() })
      .from(schema.users)
      .where(eq(schema.users.tenantId, tenantId))
      .get()?.n ?? 0;

    const fileCount = deps.db
      .select({ n: count() })
      .from(schema.files)
      .where(eq(schema.files.tenantId, tenantId))
      .get()?.n ?? 0;

    const entityRows = deps.db
      .select({
        entityType: schema.entities.entityType,
        n: count(),
      })
      .from(schema.entities)
      .where(eq(schema.entities.tenantId, tenantId))
      .groupBy(schema.entities.entityType)
      .all();

    const entitiesByType = entityRows.map((r) => ({
      entityType: r.entityType ?? 'unclassified',
      count: r.n,
    }));
    const entityTotal = entitiesByType.reduce((acc, r) => acc + r.count, 0);

    const recentEvents = deps.db
      .select({
        id: schema.events.id,
        type: schema.events.type,
        createdAt: schema.events.createdAt,
        payloadJson: schema.events.payloadJson,
      })
      .from(schema.events)
      .where(eq(schema.events.tenantId, tenantId))
      .orderBy(desc(schema.events.createdAt))
      .limit(10)
      .all();

    const activeWorkflows = deps.db
      .select({
        id: schema.workflowRuns.id,
        workflowName: schema.workflowRuns.workflowName,
        status: schema.workflowRuns.status,
        startedAt: schema.workflowRuns.startedAt,
      })
      .from(schema.workflowRuns)
      .where(
        and(
          eq(schema.workflowRuns.tenantId, tenantId),
          sql`${schema.workflowRuns.status} IN ('running','paused')`,
        ),
      )
      .orderBy(desc(schema.workflowRuns.startedAt))
      .limit(10)
      .all();

    const workflowDefCount = deps.db
      .select({ n: count() })
      .from(schema.workflowDefinitions)
      .where(eq(schema.workflowDefinitions.tenantId, tenantId))
      .get()?.n ?? 0;

    const templateCount = deps.db
      .select({ n: count() })
      .from(schema.docsTemplates)
      .where(eq(schema.docsTemplates.tenantId, tenantId))
      .get()?.n ?? 0;

    const renderCount = deps.db
      .select({ n: count() })
      .from(schema.docsRenders)
      .where(eq(schema.docsRenders.tenantId, tenantId))
      .get()?.n ?? 0;

    return c.json({
      tenant: tenant
        ? {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            createdAt: tenant.createdAt.toISOString(),
            userCount,
          }
        : null,
      counts: {
        files: fileCount,
        entities: entityTotal,
        templates: templateCount,
        renders: renderCount,
        workflows: workflowDefCount,
      },
      entitiesByType,
      activeWorkflows: activeWorkflows.map((w) => ({
        id: w.id,
        workflowName: w.workflowName,
        status: w.status,
        startedAt: w.startedAt.toISOString(),
      })),
      recentEvents: recentEvents.map((e) => {
        let payload: unknown = null;
        try {
          payload = JSON.parse(e.payloadJson);
        } catch {
          /* ignore */
        }
        return {
          id: e.id,
          type: e.type,
          createdAt: e.createdAt.toISOString(),
          payload,
        };
      }),
    });
  });

  return app;
}

import { type JwtConfig, requireAuth } from '@altera/auth';
import { notFound, validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import type { EventBus } from '@altera/events';
import {
  createRenderService,
  createSubmissionService,
  createTemplateService,
  documentDefinitionSchema,
  registerReadOnlyComponents,
  renderDocument,
  validateSubmission,
  type DocumentDefinition,
} from '@altera/docs';
import { Hono } from 'hono';
import { z } from 'zod';

let componentsRegistered = false;
function ensureComponentsRegistered() {
  if (!componentsRegistered) {
    try {
      registerReadOnlyComponents();
    } catch {
      // already registered (e.g. multiple buildApp calls in tests)
    }
    componentsRegistered = true;
  }
}

export interface DocsRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
  bus?: EventBus;
}

const createTemplateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'slug must be alphanumeric/hyphen/underscore'),
  kind: z.enum(['report', 'form', 'hybrid']),
  definition: documentDefinitionSchema,
});

const updateTemplateSchema = z.object({
  status: z.enum(['draft', 'published', 'archived']).optional(),
  slug: z.string().min(1).optional(),
  definition: documentDefinitionSchema.optional(),
});

const renderSchema = z.object({
  templateId: z.string().optional(),
  definition: documentDefinitionSchema.optional(),
  data: z.record(z.unknown()).default({}),
  persist: z.boolean().optional(),
});

const submitSchema = z.object({
  data: z.record(z.unknown()),
});

export function docsRoutes(deps: DocsRoutesDeps): Hono {
  ensureComponentsRegistered();

  const templates = createTemplateService(deps.db);
  const submissions = createSubmissionService(deps.db);
  const renders = createRenderService({ db: deps.db, templates });

  const app = new Hono();
  app.use('*', requireAuth(deps));

  app.get('/templates', (c) => {
    const principal = c.get('principal');
    const kindParam = c.req.query('kind');
    const kind =
      kindParam === 'report' || kindParam === 'form' || kindParam === 'hybrid'
        ? kindParam
        : undefined;
    const items = templates.list(principal.tenantId, kind);
    return c.json({
      templates: items.map((t) => ({
        id: t.id,
        slug: t.slug,
        kind: t.kind,
        status: t.status,
        title: t.definition.title,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  });

  app.post('/templates', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = createTemplateSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid template body', parsed.error.issues);

    const existing = templates.getBySlug(principal.tenantId, parsed.data.slug);
    if (existing) throw validationError('Slug already used', { slug: parsed.data.slug });

    const created = templates.create(
      principal.tenantId,
      parsed.data.slug,
      parsed.data.kind,
      parsed.data.definition as DocumentDefinition,
    );
    return c.json(
      {
        template: {
          id: created.id,
          slug: created.slug,
          kind: created.kind,
          status: created.status,
          definition: created.definition,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      201,
    );
  });

  app.get('/templates/:id', (c) => {
    const principal = c.get('principal');
    const tpl = templates.getById(principal.tenantId, c.req.param('id'));
    if (!tpl) throw notFound('Template not found');
    return c.json({
      template: {
        id: tpl.id,
        slug: tpl.slug,
        kind: tpl.kind,
        status: tpl.status,
        definition: tpl.definition,
        createdAt: tpl.createdAt.toISOString(),
        updatedAt: tpl.updatedAt.toISOString(),
      },
    });
  });

  app.patch('/templates/:id', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = updateTemplateSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid template body', parsed.error.issues);

    const updated = templates.update(principal.tenantId, c.req.param('id'), {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.slug ? { slug: parsed.data.slug } : {}),
      ...(parsed.data.definition
        ? { definition: parsed.data.definition as DocumentDefinition }
        : {}),
    });
    if (!updated) throw notFound('Template not found');
    return c.json({
      template: {
        id: updated.id,
        slug: updated.slug,
        kind: updated.kind,
        status: updated.status,
        definition: updated.definition,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  });

  app.post('/render', async (c) => {
    const principal = c.get('principal');
    const body = await c.req.json().catch(() => null);
    const parsed = renderSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid render body', parsed.error.issues);

    if (parsed.data.templateId) {
      const { render, html, errors } = renders.renderFromTemplate(
        principal.tenantId,
        parsed.data.templateId,
        parsed.data.data,
        { persist: parsed.data.persist !== false },
      );
      return c.json({
        render: render
          ? {
              id: render.id,
              templateId: render.templateId,
              status: render.status,
              renderedAt: render.renderedAt.toISOString(),
            }
          : null,
        html,
        errors,
      });
    }

    if (parsed.data.definition) {
      const result = renderDocument(
        parsed.data.definition as DocumentDefinition,
        parsed.data.data,
      );
      const status: 'success' | 'error' = result.errors.length === 0 ? 'success' : 'error';
      const render =
        parsed.data.persist === true
          ? renders.persist(
              principal.tenantId,
              null,
              parsed.data.data,
              result.html,
              status,
              result.errors,
            )
          : null;
      return c.json({
        render: render
          ? {
              id: render.id,
              templateId: null,
              status: render.status,
              renderedAt: render.renderedAt.toISOString(),
            }
          : null,
        html: result.html,
        errors: result.errors,
      });
    }

    throw validationError('Either templateId or definition is required');
  });

  app.get('/renders/:id', (c) => {
    const principal = c.get('principal');
    const render = renders.getById(principal.tenantId, c.req.param('id'));
    if (!render) throw notFound('Render not found');
    const accept = c.req.header('accept') ?? '';
    if (accept.includes('text/html')) {
      return c.html(render.html);
    }
    return c.json({
      render: {
        id: render.id,
        templateId: render.templateId,
        status: render.status,
        renderedAt: render.renderedAt.toISOString(),
        publishedAt: render.publishedAt ? render.publishedAt.toISOString() : null,
        publishedBy: render.publishedBy,
        html: render.html,
        errors: render.errors ?? [],
      },
    });
  });

  app.get('/renders', (c) => {
    const principal = c.get('principal');
    const templateId = c.req.query('templateId') ?? undefined;
    const limit = Number.parseInt(c.req.query('limit') ?? '20', 10) || 20;
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const result = renders.list(principal.tenantId, templateId, { limit, offset });
    return c.json({
      items: result.items.map((r) => ({
        id: r.id,
        templateId: r.templateId,
        status: r.status,
        renderedAt: r.renderedAt.toISOString(),
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        publishedBy: r.publishedBy,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  app.post('/renders/:id/publish', async (c) => {
    const principal = c.get('principal');
    const render = renders.publish(
      principal.tenantId,
      c.req.param('id'),
      principal.userId ?? null,
    );
    if (!render) throw notFound('Render not found');
    if (render.status !== 'success') {
      throw validationError('Cannot publish a render with status=error');
    }
    if (deps.bus) {
      await deps.bus.emit({
        tenantId: principal.tenantId,
        userId: principal.userId ?? null,
        type: 'report.published',
        payload: { reportId: render.id, destination: 'inline' },
      });
    }
    return c.json({
      render: {
        id: render.id,
        templateId: render.templateId,
        status: render.status,
        renderedAt: render.renderedAt.toISOString(),
        publishedAt: render.publishedAt ? render.publishedAt.toISOString() : null,
        publishedBy: render.publishedBy,
      },
    });
  });

  app.delete('/templates/:id', (c) => {
    const principal = c.get('principal');
    const ok = templates.delete(principal.tenantId, c.req.param('id'));
    if (!ok) throw notFound('Template not found');
    return c.json({ ok: true });
  });

  app.post('/templates/:id/submissions', async (c) => {
    const principal = c.get('principal');
    const tpl = templates.getById(principal.tenantId, c.req.param('id'));
    if (!tpl) throw notFound('Template not found');
    const body = await c.req.json().catch(() => null);
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) throw validationError('Invalid submission body', parsed.error.issues);

    const validationResult = validateSubmission(tpl.definition, parsed.data.data);
    const submission = submissions.create(
      principal.tenantId,
      tpl.id,
      parsed.data.data,
      validationResult.valid,
      validationResult.errors,
    );
    return c.json(
      {
        submission: {
          id: submission.id,
          templateId: submission.templateId,
          valid: submission.valid,
          errors: submission.errors,
          submittedAt: submission.submittedAt.toISOString(),
        },
        validation: validationResult,
      },
      submission.valid ? 201 : 400,
    );
  });

  app.get('/submissions', (c) => {
    const principal = c.get('principal');
    const templateId = c.req.query('templateId') ?? undefined;
    const limit = Number.parseInt(c.req.query('limit') ?? '20', 10) || 20;
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const result = submissions.list(principal.tenantId, templateId, { limit, offset });
    return c.json({
      items: result.items.map((s) => ({
        id: s.id,
        templateId: s.templateId,
        valid: s.valid,
        submittedAt: s.submittedAt.toISOString(),
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  return app;
}

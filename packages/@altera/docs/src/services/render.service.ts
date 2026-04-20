import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { and, count, eq } from 'drizzle-orm';
import type { RenderError } from '../core/types.ts';
import { renderDocument } from '../engine/render.ts';
import type { TemplateService } from './template.service.ts';

const { docsRenders } = schema;

export interface DocsRender {
  id: string;
  tenantId: string;
  templateId: string | null;
  data: Record<string, unknown>;
  html: string;
  status: 'success' | 'error';
  errors: RenderError[] | null;
  renderedAt: Date;
}

function rowToRender(row: typeof docsRenders.$inferSelect): DocsRender {
  return {
    id: row.id,
    tenantId: row.tenantId,
    templateId: row.templateId ?? null,
    data: JSON.parse(row.data) as Record<string, unknown>,
    html: row.html,
    status: row.status,
    errors: row.errors ? (JSON.parse(row.errors) as RenderError[]) : null,
    renderedAt: row.renderedAt,
  };
}

export interface RenderServiceDeps {
  db: AlteraDb;
  templates: TemplateService;
}

export function createRenderService(deps: RenderServiceDeps) {
  const { db, templates } = deps;
  return {
    persist(
      tenantId: string,
      templateId: string | null,
      data: Record<string, unknown>,
      html: string,
      status: 'success' | 'error',
      errors?: RenderError[],
    ): DocsRender {
      const id = newId('docRender');
      const now = new Date();
      db.insert(docsRenders)
        .values({
          id,
          tenantId,
          templateId,
          data: JSON.stringify(data),
          html,
          status,
          errors: errors && errors.length > 0 ? JSON.stringify(errors) : null,
          renderedAt: now,
        })
        .run();
      return {
        id,
        tenantId,
        templateId,
        data,
        html,
        status,
        errors: errors ?? null,
        renderedAt: now,
      };
    },

    renderFromTemplate(
      tenantId: string,
      templateId: string,
      data: Record<string, unknown>,
      options?: { persist?: boolean },
    ): { render: DocsRender | null; html: string; errors: RenderError[] } {
      const tpl = templates.getById(tenantId, templateId);
      if (!tpl) {
        throw new Error(`Template not found: ${templateId}`);
      }
      const result = renderDocument(tpl.definition, data);
      const status: 'success' | 'error' = result.errors.length === 0 ? 'success' : 'error';
      const render = options?.persist === false
        ? null
        : this.persist(tenantId, tpl.id, data, result.html, status, result.errors);
      return { render, html: result.html, errors: result.errors };
    },

    getById(tenantId: string, id: string): DocsRender | undefined {
      const row = db
        .select()
        .from(docsRenders)
        .where(and(eq(docsRenders.id, id), eq(docsRenders.tenantId, tenantId)))
        .get();
      return row ? rowToRender(row) : undefined;
    },

    list(
      tenantId: string,
      templateId?: string,
      { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    ): { items: DocsRender[]; total: number; limit: number; offset: number } {
      const where = templateId
        ? and(
            eq(docsRenders.tenantId, tenantId),
            eq(docsRenders.templateId, templateId),
          )
        : eq(docsRenders.tenantId, tenantId);

      const rows = db
        .select()
        .from(docsRenders)
        .where(where)
        .limit(limit)
        .offset(offset)
        .all();

      const totalRow = db
        .select({ total: count() })
        .from(docsRenders)
        .where(where)
        .get();
      const total = totalRow?.total ?? 0;

      return { items: rows.map(rowToRender), total, limit, offset };
    },
  };
}

export type RenderService = ReturnType<typeof createRenderService>;

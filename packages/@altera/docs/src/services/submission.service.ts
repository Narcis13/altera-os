import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { and, count, eq } from 'drizzle-orm';
import type { FieldError } from '../core/types.ts';

const { docsSubmissions } = schema;

export interface DocsSubmission {
  id: string;
  tenantId: string;
  templateId: string;
  data: Record<string, unknown>;
  valid: boolean;
  errors: FieldError[] | null;
  submittedAt: Date;
}

function rowToSubmission(
  row: typeof docsSubmissions.$inferSelect,
): DocsSubmission {
  return {
    id: row.id,
    tenantId: row.tenantId,
    templateId: row.templateId,
    data: JSON.parse(row.data) as Record<string, unknown>,
    valid: row.valid,
    errors: row.errors ? (JSON.parse(row.errors) as FieldError[]) : null,
    submittedAt: row.submittedAt,
  };
}

export function createSubmissionService(db: AlteraDb) {
  return {
    create(
      tenantId: string,
      templateId: string,
      data: Record<string, unknown>,
      valid: boolean,
      errors?: FieldError[],
    ): DocsSubmission {
      const id = newId('docSubmission');
      const now = new Date();
      db.insert(docsSubmissions)
        .values({
          id,
          tenantId,
          templateId,
          data: JSON.stringify(data),
          valid,
          errors: errors ? JSON.stringify(errors) : null,
          submittedAt: now,
        })
        .run();
      return {
        id,
        tenantId,
        templateId,
        data,
        valid,
        errors: errors ?? null,
        submittedAt: now,
      };
    },

    getById(tenantId: string, id: string): DocsSubmission | undefined {
      const row = db
        .select()
        .from(docsSubmissions)
        .where(and(eq(docsSubmissions.id, id), eq(docsSubmissions.tenantId, tenantId)))
        .get();
      return row ? rowToSubmission(row) : undefined;
    },

    list(
      tenantId: string,
      templateId?: string,
      { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    ): { items: DocsSubmission[]; total: number; limit: number; offset: number } {
      const where = templateId
        ? and(
            eq(docsSubmissions.tenantId, tenantId),
            eq(docsSubmissions.templateId, templateId),
          )
        : eq(docsSubmissions.tenantId, tenantId);

      const rows = db
        .select()
        .from(docsSubmissions)
        .where(where)
        .limit(limit)
        .offset(offset)
        .all();

      const totalRow = db
        .select({ total: count() })
        .from(docsSubmissions)
        .where(where)
        .get();
      const total = totalRow?.total ?? 0;

      return { items: rows.map(rowToSubmission), total, limit, offset };
    },
  };
}

export type SubmissionService = ReturnType<typeof createSubmissionService>;

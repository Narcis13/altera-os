import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { and, eq } from 'drizzle-orm';
import type { DocumentDefinition } from '../core/types.ts';

const { docsTemplates } = schema;

export interface DocsTemplate {
  id: string;
  tenantId: string;
  slug: string;
  kind: 'report' | 'form' | 'hybrid';
  definition: DocumentDefinition;
  status: 'draft' | 'published' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

function rowToTemplate(row: typeof docsTemplates.$inferSelect): DocsTemplate {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    kind: row.kind,
    definition: JSON.parse(row.definition) as DocumentDefinition,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createTemplateService(db: AlteraDb) {
  return {
    create(
      tenantId: string,
      slug: string,
      kind: 'report' | 'form' | 'hybrid',
      definition: DocumentDefinition,
    ): DocsTemplate {
      const id = newId('docTemplate');
      const now = new Date();
      db.insert(docsTemplates)
        .values({
          id,
          tenantId,
          slug,
          kind,
          definition: JSON.stringify(definition),
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return {
        id,
        tenantId,
        slug,
        kind,
        definition,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
    },

    getById(tenantId: string, id: string): DocsTemplate | undefined {
      const row = db
        .select()
        .from(docsTemplates)
        .where(and(eq(docsTemplates.id, id), eq(docsTemplates.tenantId, tenantId)))
        .get();
      return row ? rowToTemplate(row) : undefined;
    },

    getBySlug(tenantId: string, slug: string): DocsTemplate | undefined {
      const row = db
        .select()
        .from(docsTemplates)
        .where(and(eq(docsTemplates.slug, slug), eq(docsTemplates.tenantId, tenantId)))
        .get();
      return row ? rowToTemplate(row) : undefined;
    },

    list(tenantId: string, kind?: 'report' | 'form' | 'hybrid'): DocsTemplate[] {
      const where = kind
        ? and(eq(docsTemplates.tenantId, tenantId), eq(docsTemplates.kind, kind))
        : eq(docsTemplates.tenantId, tenantId);
      const rows = db.select().from(docsTemplates).where(where).all();
      return rows.map(rowToTemplate);
    },

    update(
      tenantId: string,
      id: string,
      data: {
        status?: 'draft' | 'published' | 'archived';
        definition?: DocumentDefinition;
        slug?: string;
      },
    ): DocsTemplate | undefined {
      const existing = this.getById(tenantId, id);
      if (!existing) return undefined;

      const updates: Partial<typeof docsTemplates.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (data.status) updates.status = data.status;
      if (data.definition) updates.definition = JSON.stringify(data.definition);
      if (data.slug) updates.slug = data.slug;

      db.update(docsTemplates)
        .set(updates)
        .where(and(eq(docsTemplates.id, id), eq(docsTemplates.tenantId, tenantId)))
        .run();

      return this.getById(tenantId, id);
    },

    delete(tenantId: string, id: string): boolean {
      const existing = this.getById(tenantId, id);
      if (!existing) return false;
      db.delete(docsTemplates)
        .where(and(eq(docsTemplates.id, id), eq(docsTemplates.tenantId, tenantId)))
        .run();
      return true;
    },
  };
}

export type TemplateService = ReturnType<typeof createTemplateService>;

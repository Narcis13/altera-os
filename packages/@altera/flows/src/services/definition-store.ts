import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { and, eq } from 'drizzle-orm';
import type { WorkflowDocument } from '../core/types.ts';
import { parseWorkflowYaml } from '../dsl/loader.ts';
import { validateWorkflow } from '../dsl/validation.ts';

const { workflowDefinitions } = schema;

export interface DefinitionStoreDeps {
  db: AlteraDb;
}

export interface WorkflowDefinitionRecord {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  source: string;
  document: WorkflowDocument;
  createdAt: Date;
  updatedAt: Date;
}

function rowToRecord(row: typeof workflowDefinitions.$inferSelect): WorkflowDefinitionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    version: row.version,
    source: row.source,
    document: JSON.parse(row.document) as WorkflowDocument,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDefinitionStore(deps: DefinitionStoreDeps) {
  const { db } = deps;

  return {
    upsertFromYaml(tenantId: string, yaml: string, label = 'inline'): WorkflowDefinitionRecord {
      const document = parseWorkflowYaml(yaml, label);
      return this.upsert(tenantId, document, yaml);
    },

    upsert(
      tenantId: string,
      document: WorkflowDocument,
      source?: string,
    ): WorkflowDefinitionRecord {
      const validated = validateWorkflow(document);
      const now = new Date();
      const existing = this.getByName(tenantId, validated.name);
      if (existing) {
        db.update(workflowDefinitions)
          .set({
            version: validated.version,
            source: source ?? existing.source,
            document: JSON.stringify(validated),
            updatedAt: now,
          })
          .where(
            and(
              eq(workflowDefinitions.tenantId, tenantId),
              eq(workflowDefinitions.id, existing.id),
            ),
          )
          .run();
        return {
          ...existing,
          version: validated.version,
          source: source ?? existing.source,
          document: validated,
          updatedAt: now,
        };
      }

      const id = newId('workflowDef');
      db.insert(workflowDefinitions)
        .values({
          id,
          tenantId,
          name: validated.name,
          version: validated.version,
          source: source ?? 'inline',
          document: JSON.stringify(validated),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return {
        id,
        tenantId,
        name: validated.name,
        version: validated.version,
        source: source ?? 'inline',
        document: validated,
        createdAt: now,
        updatedAt: now,
      };
    },

    getByName(tenantId: string, name: string): WorkflowDefinitionRecord | undefined {
      const row = db
        .select()
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.name, name)))
        .get();
      return row ? rowToRecord(row) : undefined;
    },

    list(tenantId: string): WorkflowDefinitionRecord[] {
      const rows = db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.tenantId, tenantId))
        .all();
      return rows.map(rowToRecord);
    },

    delete(tenantId: string, name: string): boolean {
      const existing = this.getByName(tenantId, name);
      if (!existing) return false;
      db.delete(workflowDefinitions)
        .where(
          and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.id, existing.id)),
        )
        .run();
      return true;
    },
  };
}

export type DefinitionStore = ReturnType<typeof createDefinitionStore>;

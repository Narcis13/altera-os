import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import { getAttributes, getEntity } from '@altera/eav';
import type { AnyEnvelope, EventBus } from '@altera/events';
import { and, eq } from 'drizzle-orm';
import { runAgent } from '../loop.ts';
import { ToolRegistry } from '../registry.ts';
import { loadClassifyDocumentSkill } from '../skills/classify-document.ts';
import type { SkillDefinition } from '../skills/types.ts';
import {
  createClassifyEntityTool,
  createQueryEntitiesTool,
  createSanitizeThenCallTool,
  createSetAttributeTool,
} from '../tools/eav-tools.ts';
import type { AgentMessage, LlmProvider, ToolContext } from '../types.ts';

export interface ClassifySubscriberOptions {
  db: AlteraDb;
  bus: EventBus;
  provider: LlmProvider;
  skill?: SkillDefinition;
  model?: string;
  maxRawTextChars?: number;
  logger?: Pick<Console, 'error' | 'warn' | 'info'>;
}

const DEFAULT_MAX_RAW_TEXT_CHARS = 8000;

export class ClassifySubscriber {
  private readonly db: AlteraDb;
  private readonly bus: EventBus;
  private readonly provider: LlmProvider;
  private readonly skill: SkillDefinition;
  private readonly model: string | undefined;
  private readonly maxRawTextChars: number;
  private readonly logger: Pick<Console, 'error' | 'warn' | 'info'>;
  private readonly tools: ToolRegistry;
  private unsubscribe: (() => void) | null = null;
  private readonly pending = new Set<Promise<void>>();

  constructor(opts: ClassifySubscriberOptions) {
    this.db = opts.db;
    this.bus = opts.bus;
    this.provider = opts.provider;
    this.skill = opts.skill ?? loadClassifyDocumentSkill();
    this.model = opts.model;
    this.maxRawTextChars = opts.maxRawTextChars ?? DEFAULT_MAX_RAW_TEXT_CHARS;
    this.logger = opts.logger ?? console;

    this.tools = new ToolRegistry();
    this.tools.registerAll([
      createQueryEntitiesTool({ db: this.db }),
      createSetAttributeTool({ db: this.db }),
      createClassifyEntityTool({ db: this.db }),
      createSanitizeThenCallTool(),
    ]);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe('entity.created', (env) => {
      const task = this.handle(env).catch((err) => {
        this.logger.error('[classify-subscriber] failed:', err);
      });
      this.pending.add(task);
      task.finally(() => this.pending.delete(task));
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(Array.from(this.pending));
    }
  }

  private async handle(env: AnyEnvelope): Promise<void> {
    if (env.type !== 'entity.created') return;
    const entityId = (env.payload as { entityId?: string }).entityId;
    if (!entityId) return;

    const entity = getEntity({ db: this.db, tenantId: env.tenantId }, entityId);
    if (!entity) return;
    if (entity.status !== 'raw') return;

    const attrs = getAttributes({ db: this.db, tenantId: env.tenantId }, entityId);
    const rawAttr = attrs.find((a) => a.key === 'raw_text');
    const rawText = rawAttr?.valueText;
    if (!rawText || rawText.trim().length === 0) {
      this.logger.info?.(
        `[classify-subscriber] skipping ${entityId}: no raw_text attribute`,
      );
      return;
    }

    const taxonomy = this.loadTaxonomy(env.tenantId);
    const userMessage = buildUserPrompt({
      entityId,
      entityName: entity.name,
      sourceFileId: entity.sourceFileId,
      rawText: rawText.slice(0, this.maxRawTextChars),
      taxonomy,
    });

    const toolContext: ToolContext = {
      tenantId: env.tenantId,
      userId: env.userId ?? null,
    };
    const messages: AgentMessage[] = [{ role: 'user', content: userMessage }];

    const result = await runAgent({
      provider: this.provider,
      tools: this.tools,
      input: {
        messages,
        system: this.skill.systemPrompt,
        maxIterations: this.skill.maxIterations,
        toolContext,
        ...(this.model ? { model: this.model } : this.skill.model ? { model: this.skill.model } : {}),
      },
    });

    const finalEntity = getEntity({ db: this.db, tenantId: env.tenantId }, entityId);
    if (!finalEntity || finalEntity.status !== 'classified' || !finalEntity.entityType) {
      this.logger.warn?.(
        `[classify-subscriber] agent did not classify ${entityId} (tools used: ${result.toolsUsed.join(', ') || 'none'})`,
      );
      return;
    }

    await this.bus.emit({
      tenantId: env.tenantId,
      userId: env.userId ?? null,
      type: 'entity.classified',
      payload: {
        entityId: finalEntity.id,
        classification: finalEntity.entityType,
        ...(finalEntity.classificationConfidence !== null
          ? { confidence: finalEntity.classificationConfidence }
          : {}),
      },
      metadata: {
        skill: this.skill.name,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed,
      },
    });
  }

  private loadTaxonomy(tenantId: string): string[] {
    try {
      const rows = this.db
        .select({ entityType: schema.entityTaxonomy.entityType })
        .from(schema.entityTaxonomy)
        .where(eq(schema.entityTaxonomy.tenantId, tenantId))
        .all();
      if (rows.length > 0) return rows.map((r) => r.entityType);
    } catch (err) {
      this.logger.warn?.('[classify-subscriber] taxonomy lookup failed:', err);
    }
    return this.skill.defaultTaxonomy;
  }
}

export function upsertTenantTaxonomy(
  db: AlteraDb,
  tenantId: string,
  entries: Array<{ entityType: string; description?: string }>,
): void {
  for (const entry of entries) {
    const existing = db
      .select()
      .from(schema.entityTaxonomy)
      .where(
        and(
          eq(schema.entityTaxonomy.tenantId, tenantId),
          eq(schema.entityTaxonomy.entityType, entry.entityType),
        ),
      )
      .get();
    if (existing) {
      if (entry.description && entry.description !== existing.description) {
        db.update(schema.entityTaxonomy)
          .set({ description: entry.description })
          .where(eq(schema.entityTaxonomy.id, existing.id))
          .run();
      }
      continue;
    }
    db.insert(schema.entityTaxonomy)
      .values({
        id: newId('entity'),
        tenantId,
        entityType: entry.entityType,
        description: entry.description ?? null,
        createdAt: new Date(),
      })
      .run();
  }
}

function buildUserPrompt(input: {
  entityId: string;
  entityName: string | null;
  sourceFileId: string | null;
  rawText: string;
  taxonomy: string[];
}): string {
  const taxonomyList = input.taxonomy.map((t) => `- ${t}`).join('\n');
  const header = [
    `entity_id: ${input.entityId}`,
    input.entityName ? `entity_name: ${input.entityName}` : null,
    input.sourceFileId ? `source_file_id: ${input.sourceFileId}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    'Classify the entity below.',
    '',
    header,
    '',
    'allowed_taxonomy:',
    taxonomyList,
    '',
    'raw_text (truncated):',
    '"""',
    input.rawText,
    '"""',
    '',
    'Call classify_entity with your decision, then respond briefly.',
  ].join('\n');
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import type { AnyEnvelope, EventBus, FileUploadedPayload } from '@altera/events';
import { and, eq } from 'drizzle-orm';
import { parseFile } from './parser.ts';

export interface IngestWorkerOptions {
  db: AlteraDb;
  bus: EventBus;
  dataDir: string;
  logger?: Pick<Console, 'error' | 'warn' | 'info'>;
}

export class IngestWorker {
  private readonly db: AlteraDb;
  private readonly bus: EventBus;
  private readonly dataDir: string;
  private readonly logger: Pick<Console, 'error' | 'warn' | 'info'>;
  private unsubscribe: (() => void) | null = null;
  private readonly pending = new Set<Promise<void>>();

  constructor(opts: IngestWorkerOptions) {
    this.db = opts.db;
    this.bus = opts.bus;
    this.dataDir = opts.dataDir;
    this.logger = opts.logger ?? console;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe('file.uploaded', (env) => {
      const task = this.handle(env).catch((err) => {
        this.logger.error('[ingest-worker] failed to process file.uploaded:', err);
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
    if (env.type !== 'file.uploaded') return;
    const payload = env.payload as FileUploadedPayload;

    const file = this.db
      .select()
      .from(schema.files)
      .where(
        and(eq(schema.files.id, payload.fileId), eq(schema.files.tenantId, env.tenantId)),
      )
      .get();
    if (!file) {
      this.logger.warn(`[ingest-worker] file not found: ${payload.fileId}`);
      return;
    }

    const existing = this.db
      .select()
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.tenantId, env.tenantId),
          eq(schema.entities.sourceFileId, file.id),
        ),
      )
      .get();
    if (existing) return;

    const absPath = resolve(this.dataDir, file.storagePath);
    const buffer = new Uint8Array(await readFile(absPath));

    let text = '';
    let metadata: Record<string, unknown> = {};
    let pages: number | undefined;
    try {
      const parsed = await parseFile(buffer, {
        filename: file.name,
        declaredMime: file.mimeType,
      });
      text = parsed.text;
      metadata = parsed.metadata ?? {};
      pages = parsed.pages;
    } catch (err) {
      metadata = { parseError: (err as Error).message };
    }

    const entityId = newId('entity');
    const now = new Date();
    this.db
      .insert(schema.entities)
      .values({
        id: entityId,
        tenantId: env.tenantId,
        sourceFileId: file.id,
        entityType: null,
        name: file.name,
        status: 'raw',
        classificationConfidence: null,
        ingestedAt: now,
      })
      .run();

    const attrRows = [
      {
        id: newId('attribute'),
        tenantId: env.tenantId,
        entityId,
        key: 'raw_text',
        valueText: text,
        valueNumber: null,
        valueDate: null,
        valueJson: null,
        isSensitive: false,
        extractedBy: 'structured_import' as const,
        confidence: null,
        createdAt: now,
      },
      {
        id: newId('attribute'),
        tenantId: env.tenantId,
        entityId,
        key: 'parse_metadata',
        valueText: null,
        valueNumber: null,
        valueDate: null,
        valueJson: JSON.stringify({ ...metadata, ...(pages !== undefined ? { pages } : {}) }),
        isSensitive: false,
        extractedBy: 'structured_import' as const,
        confidence: null,
        createdAt: now,
      },
      {
        id: newId('attribute'),
        tenantId: env.tenantId,
        entityId,
        key: 'source_file_id',
        valueText: file.id,
        valueNumber: null,
        valueDate: null,
        valueJson: null,
        isSensitive: false,
        extractedBy: 'structured_import' as const,
        confidence: null,
        createdAt: now,
      },
    ];
    this.db.insert(schema.attributes).values(attrRows).run();

    await this.bus.emit({
      tenantId: env.tenantId,
      userId: env.userId ?? null,
      type: 'entity.created',
      payload: {
        entityId,
        entityType: 'raw',
      },
      metadata: { sourceFileId: file.id },
    });
  }
}

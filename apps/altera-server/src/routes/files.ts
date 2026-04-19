import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type JwtConfig, requireAuth, withTenant } from '@altera/auth';
import { conflict, notFound, validationError } from '@altera/core';
import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import type { EventBus } from '@altera/events';
import { MIME_EXTENSION, detectMime } from '@altera/ingest';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

export interface FilesRoutesDeps {
  db: AlteraDb;
  jwt: JwtConfig;
  bus: EventBus;
  dataDir: string;
  maxUploadBytes: number;
}

function extensionFor(mime: string, filename: string): string {
  const lower = filename.toLowerCase();
  const idx = lower.lastIndexOf('.');
  if (idx >= 0 && idx < lower.length - 1) return lower.slice(idx + 1);
  return MIME_EXTENSION[mime] ?? 'bin';
}

function sanitizeFilename(name: string): string {
  const base = name.split('/').pop()?.split('\\').pop() ?? name;
  return base.slice(0, 255);
}

export function filesRoutes(deps: FilesRoutesDeps): Hono {
  const app = new Hono();
  app.use('*', requireAuth(deps));
  app.use('*', withTenant(deps));

  app.post('/upload', async (c) => {
    const form = await c.req.formData().catch(() => {
      throw validationError('Expected multipart/form-data body');
    });
    const file = form.get('file');
    if (!(file instanceof File)) throw validationError('Missing "file" field');
    if (file.size === 0) throw validationError('File is empty');
    if (file.size > deps.maxUploadBytes) {
      throw validationError('File exceeds maximum size', {
        maxBytes: deps.maxUploadBytes,
        got: file.size,
      });
    }

    const principal = c.get('principal');
    const filename = sanitizeFilename(file.name || 'upload.bin');
    const buffer = new Uint8Array(await file.arrayBuffer());

    const declaredMime = file.type && file.type.length > 0 ? file.type : undefined;
    const opts: { filename: string; declaredMime?: string } = { filename };
    if (declaredMime) opts.declaredMime = declaredMime;
    const mimeType = detectMime(buffer, opts);

    const hash = createHash('sha256').update(buffer).digest('hex');
    const ext = extensionFor(mimeType, filename);

    const existing = deps.db
      .select()
      .from(schema.files)
      .where(
        and(
          eq(schema.files.tenantId, principal.tenantId),
          eq(schema.files.hashSha256, hash),
        ),
      )
      .get();
    if (existing) {
      throw conflict('File already uploaded for this tenant', { fileId: existing.id });
    }

    const relPath = `${principal.tenantId}/files/${hash.slice(0, 2)}/${hash}.${ext}`;
    const absPath = resolve(deps.dataDir, relPath);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, buffer);

    const fileId = newId('file');
    const now = new Date();
    deps.db
      .insert(schema.files)
      .values({
        id: fileId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        name: filename,
        mimeType,
        sizeBytes: file.size,
        storagePath: relPath,
        hashSha256: hash,
        uploadedAt: now,
      })
      .run();

    await deps.bus.emit({
      tenantId: principal.tenantId,
      userId: principal.userId,
      type: 'file.uploaded',
      payload: {
        fileId,
        name: filename,
        mimeType,
        sizeBytes: file.size,
        hashSha256: hash,
      },
      metadata: { source: 'api' },
    });

    return c.json(
      {
        id: fileId,
        tenantId: principal.tenantId,
        name: filename,
        mimeType,
        sizeBytes: file.size,
        hashSha256: hash,
        storagePath: relPath,
        uploadedAt: now.toISOString(),
      },
      201,
    );
  });

  app.get('/', (c) => {
    const principal = c.get('principal');
    const url = new URL(c.req.url);
    const limit = Math.min(
      Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
      200,
    );
    const offset = Math.max(
      Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0,
      0,
    );

    const rows = deps.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.tenantId, principal.tenantId))
      .orderBy(desc(schema.files.uploadedAt))
      .limit(limit)
      .offset(offset)
      .all();

    return c.json({
      files: rows.map((r) => ({
        id: r.id,
        name: r.name,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        hashSha256: r.hashSha256,
        uploadedAt: r.uploadedAt.toISOString(),
      })),
      limit,
      offset,
    });
  });

  app.get('/:id', (c) => {
    const principal = c.get('principal');
    const id = c.req.param('id');

    const file = deps.db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.id, id), eq(schema.files.tenantId, principal.tenantId)))
      .get();
    if (!file) throw notFound('File not found');

    const entity = deps.db
      .select()
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.tenantId, principal.tenantId),
          eq(schema.entities.sourceFileId, file.id),
        ),
      )
      .get();

    let rawText: string | null = null;
    let parseMetadata: unknown = null;
    if (entity) {
      const attrs = deps.db
        .select()
        .from(schema.attributes)
        .where(eq(schema.attributes.entityId, entity.id))
        .all();
      const rawAttr = attrs.find((a) => a.key === 'raw_text');
      const metaAttr = attrs.find((a) => a.key === 'parse_metadata');
      rawText = rawAttr?.valueText ?? null;
      if (metaAttr?.valueJson) {
        try {
          parseMetadata = JSON.parse(metaAttr.valueJson);
        } catch {
          parseMetadata = null;
        }
      }
    }

    return c.json({
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        hashSha256: file.hashSha256,
        storagePath: file.storagePath,
        uploadedAt: file.uploadedAt.toISOString(),
      },
      entity: entity
        ? {
            id: entity.id,
            status: entity.status,
            entityType: entity.entityType,
            name: entity.name,
            ingestedAt: entity.ingestedAt.toISOString(),
          }
        : null,
      rawText,
      parseMetadata,
    });
  });

  return app;
}

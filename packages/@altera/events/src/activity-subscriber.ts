import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import type { EventBus } from './bus.ts';
import type { AnyEnvelope } from './types.ts';

export interface ActivitySubscriberOptions {
  db: AlteraDb;
  bus: EventBus;
}

interface ResourceRef {
  resourceType: string;
  resourceId: string | null;
}

function resolveResource(envelope: AnyEnvelope): ResourceRef {
  const payload = envelope.payload as unknown as Record<string, unknown>;
  switch (envelope.type) {
    case 'file.uploaded':
      return { resourceType: 'file', resourceId: String(payload.fileId ?? '') || null };
    case 'entity.created':
    case 'entity.classified':
      return { resourceType: 'entity', resourceId: String(payload.entityId ?? '') || null };
    case 'workflow.started':
    case 'workflow.completed':
      return { resourceType: 'workflow', resourceId: String(payload.runId ?? '') || null };
    case 'report.rendered':
    case 'report.published':
      return { resourceType: 'report', resourceId: String(payload.reportId ?? '') || null };
    default:
      return { resourceType: 'event', resourceId: null };
  }
}

export class ActivitySubscriber {
  private readonly db: AlteraDb;
  private readonly bus: EventBus;
  private unsub?: () => void;

  constructor(opts: ActivitySubscriberOptions) {
    this.db = opts.db;
    this.bus = opts.bus;
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.bus.subscribe('*', (envelope) => this.write(envelope));
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = undefined;
    }
  }

  private write(envelope: AnyEnvelope): void {
    const ref = resolveResource(envelope);
    this.db
      .insert(schema.auditLog)
      .values({
        id: newId('audit'),
        tenantId: envelope.tenantId,
        userId: envelope.userId ?? null,
        action: envelope.type,
        resourceType: ref.resourceType,
        resourceId: ref.resourceId,
        beforeJson: null,
        afterJson: JSON.stringify(envelope.payload),
        createdAt: envelope.createdAt,
      })
      .run();
  }
}

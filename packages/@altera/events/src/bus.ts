import type { AlteraDb } from '@altera/db';
import { newId, schema } from '@altera/db';
import type {
  AlteraEvent,
  AnyEnvelope,
  EventEnvelope,
  EventListener,
  EventTopic,
  EventType,
} from './types.ts';

export interface EventBusOptions {
  db?: AlteraDb;
  persist?: boolean;
}

export interface EmitInput<E extends AlteraEvent = AlteraEvent> {
  tenantId: string;
  userId?: string | null;
  type: E['type'];
  payload: E extends { type: infer T; payload: infer P } ? (T extends E['type'] ? P : never) : never;
  metadata?: Record<string, unknown>;
}

export class EventBus {
  private readonly listeners = new Map<EventTopic, Set<EventListener>>();
  private readonly db?: AlteraDb;
  private readonly persist: boolean;

  constructor(opts: EventBusOptions = {}) {
    this.db = opts.db;
    this.persist = opts.persist ?? Boolean(opts.db);
    if (this.persist && !this.db) {
      throw new Error('EventBus: persist=true requires a db');
    }
  }

  subscribe(topic: EventTopic, listener: EventListener): () => void {
    let bucket = this.listeners.get(topic);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(topic, bucket);
    }
    bucket.add(listener);
    return () => this.unsubscribe(topic, listener);
  }

  unsubscribe(topic: EventTopic, listener: EventListener): void {
    const bucket = this.listeners.get(topic);
    if (!bucket) return;
    bucket.delete(listener);
    if (bucket.size === 0) this.listeners.delete(topic);
  }

  async emit<E extends AlteraEvent>(input: EmitInput<E>): Promise<EventEnvelope<E>> {
    const envelope = {
      id: newId('event'),
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      type: input.type,
      payload: input.payload,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      createdAt: new Date(),
    } as unknown as EventEnvelope<E>;

    if (this.persist && this.db) {
      this.db
        .insert(schema.events)
        .values({
          id: envelope.id,
          tenantId: envelope.tenantId,
          userId: envelope.userId ?? null,
          type: envelope.type,
          payloadJson: JSON.stringify(envelope.payload),
          metadataJson: envelope.metadata ? JSON.stringify(envelope.metadata) : null,
          createdAt: envelope.createdAt,
        })
        .run();
    }

    const generic = envelope as unknown as AnyEnvelope;
    await this.dispatch(envelope.type, generic);
    await this.dispatch('*', generic);

    return envelope;
  }

  private async dispatch(topic: EventTopic, envelope: AnyEnvelope): Promise<void> {
    const bucket = this.listeners.get(topic);
    if (!bucket || bucket.size === 0) return;
    const fns = Array.from(bucket);
    await Promise.all(
      fns.map(async (fn) => {
        try {
          await fn(envelope);
        } catch (err) {
          console.error(`[event-bus] listener for "${topic}" threw:`, err);
        }
      }),
    );
  }

  listenerCount(topic: EventTopic): number {
    return this.listeners.get(topic)?.size ?? 0;
  }

  topics(): EventTopic[] {
    return Array.from(this.listeners.keys());
  }
}

export function isEventType(value: string): value is EventType {
  return (
    value === 'file.uploaded' ||
    value === 'entity.created' ||
    value === 'entity.classified' ||
    value === 'workflow.started' ||
    value === 'workflow.completed' ||
    value === 'report.rendered' ||
    value === 'report.published'
  );
}

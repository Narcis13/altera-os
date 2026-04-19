import type { EventBus } from './bus.ts';
import type { AnyEnvelope, EventTopic } from './types.ts';

export interface SseConnection {
  id: string;
  tenantId: string;
  topics: Set<EventTopic>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  lastEventId?: string;
}

export interface SseSubscribeOptions {
  tenantId: string;
  topics?: EventTopic[];
  lastEventId?: string;
  /**
   * Heartbeat interval (ms). Browsers and proxies time out idle SSE; ping every N seconds.
   */
  heartbeatMs?: number;
}

const enc = new TextEncoder();

function format(event: string, id: string, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return enc.encode(`id: ${id}\nevent: ${event}\ndata: ${payload}\n\n`);
}

function formatRaw(comment: string): Uint8Array {
  return enc.encode(`: ${comment}\n\n`);
}

export class SseManager {
  private readonly bus: EventBus;
  private readonly conns = new Map<string, SseConnection>();
  private busUnsub?: () => void;
  private nextId = 0;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  start(): void {
    if (this.busUnsub) return;
    this.busUnsub = this.bus.subscribe('*', (envelope) => this.fanout(envelope));
  }

  stop(): void {
    this.busUnsub?.();
    this.busUnsub = undefined;
    for (const c of this.conns.values()) {
      try {
        c.controller.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
  }

  connectionCount(tenantId?: string): number {
    if (!tenantId) return this.conns.size;
    let n = 0;
    for (const c of this.conns.values()) if (c.tenantId === tenantId) n++;
    return n;
  }

  /**
   * Returns a Response with an SSE stream. The connection is registered with
   * the manager and unregistered when the underlying stream is canceled.
   */
  subscribe(opts: SseSubscribeOptions): Response {
    const id = `sse_${++this.nextId}`;
    const topics = new Set<EventTopic>(opts.topics?.length ? opts.topics : ['*']);
    const heartbeatMs = opts.heartbeatMs ?? 25_000;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const conn: SseConnection = {
          id,
          tenantId: opts.tenantId,
          topics,
          controller,
          ...(opts.lastEventId ? { lastEventId: opts.lastEventId } : {}),
        };
        this.conns.set(id, conn);
        controller.enqueue(format('ready', id, { connectionId: id, tenantId: opts.tenantId }));
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(formatRaw('ping'));
          } catch {
            /* closed */
          }
        }, heartbeatMs);
      },
      cancel: () => {
        if (heartbeat) clearInterval(heartbeat);
        this.conns.delete(id);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  }

  private fanout(envelope: AnyEnvelope): void {
    for (const conn of this.conns.values()) {
      if (conn.tenantId !== envelope.tenantId) continue;
      if (!conn.topics.has('*') && !conn.topics.has(envelope.type)) continue;
      try {
        conn.controller.enqueue(
          format(envelope.type, envelope.id, {
            id: envelope.id,
            type: envelope.type,
            tenantId: envelope.tenantId,
            userId: envelope.userId,
            payload: envelope.payload,
            metadata: envelope.metadata,
            createdAt: envelope.createdAt.toISOString(),
          }),
        );
      } catch {
        this.conns.delete(conn.id);
      }
    }
  }
}

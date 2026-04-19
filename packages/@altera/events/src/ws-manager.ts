import type { ServerWebSocket } from 'bun';
import type { EventBus } from './bus.ts';
import type { AnyEnvelope, EventTopic } from './types.ts';

export interface WsClientData {
  id: string;
  tenantId: string;
  topics: Set<EventTopic>;
}

export interface WsServerMessage {
  type: 'ready' | 'event' | 'pong' | 'error' | 'subscribed' | 'unsubscribed';
  payload?: unknown;
}

export interface WsClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  topics?: string[];
}

export interface WsAttachOptions {
  tenantId: string;
  topics?: EventTopic[];
}

export class WsManager {
  private readonly bus: EventBus;
  private readonly conns = new Map<string, ServerWebSocket<WsClientData>>();
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
    for (const ws of this.conns.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
  }

  connectionCount(tenantId?: string): number {
    if (!tenantId) return this.conns.size;
    let n = 0;
    for (const ws of this.conns.values()) if (ws.data.tenantId === tenantId) n++;
    return n;
  }

  /**
   * Build a `data` payload for `server.upgrade(req, { data })` so the WS
   * handlers can read tenantId/topics off `ws.data`.
   */
  newClientData(opts: WsAttachOptions): WsClientData {
    return {
      id: `ws_${++this.nextId}`,
      tenantId: opts.tenantId,
      topics: new Set(opts.topics?.length ? opts.topics : ['*']),
    };
  }

  onOpen(ws: ServerWebSocket<WsClientData>): void {
    this.conns.set(ws.data.id, ws);
    this.send(ws, {
      type: 'ready',
      payload: { connectionId: ws.data.id, tenantId: ws.data.tenantId },
    });
  }

  onClose(ws: ServerWebSocket<WsClientData>): void {
    this.conns.delete(ws.data.id);
  }

  onMessage(ws: ServerWebSocket<WsClientData>, raw: string | Buffer): void {
    let parsed: WsClientMessage;
    try {
      parsed = JSON.parse(raw.toString()) as WsClientMessage;
    } catch {
      this.send(ws, { type: 'error', payload: { message: 'Invalid JSON' } });
      return;
    }

    if (parsed.type === 'ping') {
      this.send(ws, { type: 'pong' });
      return;
    }

    if (parsed.type === 'subscribe' && Array.isArray(parsed.topics)) {
      for (const t of parsed.topics) ws.data.topics.add(t as EventTopic);
      this.send(ws, { type: 'subscribed', payload: { topics: Array.from(ws.data.topics) } });
      return;
    }

    if (parsed.type === 'unsubscribe' && Array.isArray(parsed.topics)) {
      for (const t of parsed.topics) ws.data.topics.delete(t as EventTopic);
      this.send(ws, { type: 'unsubscribed', payload: { topics: Array.from(ws.data.topics) } });
      return;
    }

    this.send(ws, { type: 'error', payload: { message: 'Unknown message type' } });
  }

  private send(ws: ServerWebSocket<WsClientData>, msg: WsServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      this.conns.delete(ws.data.id);
    }
  }

  private fanout(envelope: AnyEnvelope): void {
    const msg: WsServerMessage = {
      type: 'event',
      payload: {
        id: envelope.id,
        type: envelope.type,
        tenantId: envelope.tenantId,
        userId: envelope.userId,
        payload: envelope.payload,
        metadata: envelope.metadata,
        createdAt: envelope.createdAt.toISOString(),
      },
    };
    const json = JSON.stringify(msg);
    for (const ws of this.conns.values()) {
      if (ws.data.tenantId !== envelope.tenantId) continue;
      if (!ws.data.topics.has('*') && !ws.data.topics.has(envelope.type)) continue;
      try {
        ws.send(json);
      } catch {
        this.conns.delete(ws.data.id);
      }
    }
  }
}

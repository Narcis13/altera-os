import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { EventBus } from './bus.ts';
import { WsManager, type WsClientData, type WsServerMessage } from './ws-manager.ts';

let server: Server<WsClientData>;
let bus: EventBus;
let wss: WsManager;
let port: number | string;

beforeAll(() => {
  bus = new EventBus();
  wss = new WsManager(bus);
  wss.start();

  server = Bun.serve<WsClientData>({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      const tenantId = url.searchParams.get('tenant') ?? 't1';
      const topics = (url.searchParams.get('topics') ?? '*')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const data = wss.newClientData({ tenantId, topics: topics as never });
      if (srv.upgrade(req, { data })) return undefined;
      return new Response('upgrade failed', { status: 400 });
    },
    websocket: {
      open(ws) {
        wss.onOpen(ws);
      },
      message(ws, message) {
        wss.onMessage(ws, message as string | Buffer);
      },
      close(ws) {
        wss.onClose(ws);
      },
    },
  });
  port = server.port ?? 0;
});

afterAll(() => {
  wss.stop();
  server.stop(true);
});

function openSocket(path: string): Promise<{ ws: WebSocket; messages: WsServerMessage[] }> {
  return new Promise((resolveP, rejectP) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const messages: WsServerMessage[] = [];
    ws.addEventListener('message', (e) => {
      try {
        messages.push(JSON.parse(String(e.data)) as WsServerMessage);
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener('open', () => resolveP({ ws, messages }));
    ws.addEventListener('error', (e) => rejectP(e));
  });
}

async function waitFor<T>(
  pred: () => T | undefined,
  timeoutMs = 1000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = pred();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

describe('WsManager', () => {
  test('open connection receives "ready" then events for matching tenant', async () => {
    const { ws, messages } = await openSocket('/ws?tenant=t1');
    await waitFor(() => messages.find((m) => m.type === 'ready'));
    expect(wss.connectionCount('t1')).toBeGreaterThanOrEqual(1);

    await bus.emit({
      tenantId: 't1',
      type: 'file.uploaded',
      payload: {
        fileId: 'fil_1',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        hashSha256: 'h',
      },
    });

    const evMsg = await waitFor(() =>
      messages.find(
        (m) => m.type === 'event' && (m.payload as { type: string }).type === 'file.uploaded',
      ),
    );
    expect((evMsg.payload as { payload: { fileId: string } }).payload.fileId).toBe('fil_1');

    ws.close();
  });

  test('events from a different tenant are filtered out', async () => {
    const { ws, messages } = await openSocket('/ws?tenant=tA');
    await waitFor(() => messages.find((m) => m.type === 'ready'));
    const baseline = messages.filter((m) => m.type === 'event').length;

    await bus.emit({
      tenantId: 'tB',
      type: 'entity.created',
      payload: { entityId: 'ent_x', entityType: 'doc' },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.filter((m) => m.type === 'event').length).toBe(baseline);

    await bus.emit({
      tenantId: 'tA',
      type: 'entity.created',
      payload: { entityId: 'ent_a', entityType: 'doc' },
    });
    await waitFor(() =>
      messages.find(
        (m) => m.type === 'event' && (m.payload as { type: string }).type === 'entity.created',
      ),
    );

    ws.close();
  });

  test('subscribe message narrows topics', async () => {
    const { ws, messages } = await openSocket('/ws?tenant=tC&topics=workflow.completed');
    await waitFor(() => messages.find((m) => m.type === 'ready'));

    await bus.emit({
      tenantId: 'tC',
      type: 'workflow.started',
      payload: { workflowId: 'w', runId: 'r' },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.filter((m) => m.type === 'event').length).toBe(0);

    await bus.emit({
      tenantId: 'tC',
      type: 'workflow.completed',
      payload: { workflowId: 'w', runId: 'r', status: 'success' },
    });
    await waitFor(() =>
      messages.find(
        (m) =>
          m.type === 'event' && (m.payload as { type: string }).type === 'workflow.completed',
      ),
    );

    ws.close();
  });

  test('ping → pong', async () => {
    const { ws, messages } = await openSocket('/ws?tenant=tP');
    await waitFor(() => messages.find((m) => m.type === 'ready'));
    ws.send(JSON.stringify({ type: 'ping' }));
    await waitFor(() => messages.find((m) => m.type === 'pong'));
    ws.close();
  });
});

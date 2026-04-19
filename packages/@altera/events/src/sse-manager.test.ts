import { describe, expect, test } from 'bun:test';
import { EventBus } from './bus.ts';
import { SseManager } from './sse-manager.ts';

const dec = new TextDecoder();

interface ParsedSse {
  id?: string;
  event?: string;
  data?: string;
}

function parseSse(chunk: string): ParsedSse[] {
  const events: ParsedSse[] = [];
  for (const block of chunk.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    const ev: ParsedSse = {};
    for (const line of trimmed.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k === 'id') ev.id = v;
      else if (k === 'event') ev.event = v;
      else if (k === 'data') ev.data = v;
    }
    if (ev.event) events.push(ev);
  }
  return events;
}

async function readChunks(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<string> {
  let out = '';
  for (let i = 0; i < n; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out += dec.decode(value);
  }
  return out;
}

describe('SseManager', () => {
  test('subscriber receives events for matching tenant + topic', async () => {
    const bus = new EventBus();
    const sse = new SseManager(bus);
    sse.start();

    const res = sse.subscribe({ tenantId: 't1', topics: ['file.uploaded'], heartbeatMs: 60_000 });
    const reader = res.body!.getReader();

    // Read the initial "ready" event.
    const ready = await readChunks(reader, 1);
    expect(parseSse(ready)[0]!.event).toBe('ready');
    expect(sse.connectionCount('t1')).toBe(1);

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

    const chunk = await readChunks(reader, 1);
    const events = parseSse(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('file.uploaded');
    const data = JSON.parse(events[0]!.data as string);
    expect(data.payload.fileId).toBe('fil_1');

    await reader.cancel();
    sse.stop();
  });

  test('events from a different tenant are filtered out', async () => {
    const bus = new EventBus();
    const sse = new SseManager(bus);
    sse.start();

    const res = sse.subscribe({ tenantId: 't1', heartbeatMs: 60_000 });
    const reader = res.body!.getReader();
    await readChunks(reader, 1); // ready

    await bus.emit({
      tenantId: 't2', // different tenant
      type: 'file.uploaded',
      payload: {
        fileId: 'fil_x',
        name: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        hashSha256: 'h',
      },
    });
    await bus.emit({
      tenantId: 't1',
      type: 'entity.created',
      payload: { entityId: 'ent_1', entityType: 'doc' },
    });

    const chunk = await readChunks(reader, 1);
    const events = parseSse(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('entity.created');

    await reader.cancel();
    sse.stop();
  });

  test('topic filter excludes other event types', async () => {
    const bus = new EventBus();
    const sse = new SseManager(bus);
    sse.start();

    const res = sse.subscribe({
      tenantId: 't1',
      topics: ['workflow.completed'],
      heartbeatMs: 60_000,
    });
    const reader = res.body!.getReader();
    await readChunks(reader, 1); // ready

    await bus.emit({
      tenantId: 't1',
      type: 'workflow.started',
      payload: { workflowId: 'w', runId: 'r' },
    });
    await bus.emit({
      tenantId: 't1',
      type: 'workflow.completed',
      payload: { workflowId: 'w', runId: 'r', status: 'success' },
    });

    const chunk = await readChunks(reader, 1);
    const events = parseSse(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('workflow.completed');

    await reader.cancel();
    sse.stop();
  });

  test('cancel removes the connection', async () => {
    const bus = new EventBus();
    const sse = new SseManager(bus);
    sse.start();
    const res = sse.subscribe({ tenantId: 't1', heartbeatMs: 60_000 });
    const reader = res.body!.getReader();
    await readChunks(reader, 1);
    expect(sse.connectionCount('t1')).toBe(1);
    await reader.cancel();
    // Give the cancel callback a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(sse.connectionCount('t1')).toBe(0);
    sse.stop();
  });
});

import { useEffect, useRef, useState } from 'react';
import { sessionStore } from './api';

export type RealtimeTransport = 'sse' | 'ws';

export interface RealtimeEvent {
  id: string;
  type: string;
  tenantId: string;
  userId?: string | null;
  payload: unknown;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RealtimeOptions {
  topics?: string[];
  transport?: RealtimeTransport;
  bufferSize?: number;
}

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface RealtimeState {
  status: RealtimeStatus;
  events: RealtimeEvent[];
  error: string | null;
  transport: RealtimeTransport;
  clear: () => void;
}

const DEFAULT_BUFFER = 100;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useRealtime(opts: RealtimeOptions = {}): RealtimeState {
  const transport: RealtimeTransport = opts.transport ?? 'sse';
  const topicsKey = (opts.topics ?? []).join(',');
  const bufferSize = opts.bufferSize ?? DEFAULT_BUFFER;

  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const closedRef = useRef(false);
  const sseRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    closedRef.current = false;
    const session = sessionStore.get();
    if (!session) {
      setStatus('error');
      setError('Not authenticated');
      return;
    }

    function pushEvent(ev: RealtimeEvent) {
      setEvents((prev) => {
        const next = [ev, ...prev];
        return next.length > bufferSize ? next.slice(0, bufferSize) : next;
      });
    }

    function scheduleReconnect() {
      if (closedRef.current) return;
      const attempt = ++retryRef.current;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
      timerRef.current = setTimeout(connect, delay);
    }

    function connect() {
      setStatus('connecting');
      setError(null);
      const topicQuery = topicsKey ? `&topics=${encodeURIComponent(topicsKey)}` : '';

      if (transport === 'sse') {
        const url = `/api/events/stream?access_token=${encodeURIComponent(
          session!.accessToken,
        )}${topicQuery}`;
        const es = new EventSource(url);
        sseRef.current = es;

        es.addEventListener('open', () => {
          setStatus('open');
          retryRef.current = 0;
        });
        es.addEventListener('error', () => {
          setStatus('error');
          setError('SSE connection error');
          es.close();
          sseRef.current = null;
          scheduleReconnect();
        });
        es.addEventListener('ready', () => {
          setStatus('open');
          retryRef.current = 0;
        });

        const onEvent = (e: MessageEvent) => {
          try {
            pushEvent(JSON.parse(e.data) as RealtimeEvent);
          } catch {
            /* ignore */
          }
        };
        for (const t of [
          'file.uploaded',
          'entity.created',
          'entity.classified',
          'workflow.started',
          'workflow.completed',
          'report.rendered',
          'report.published',
        ]) {
          es.addEventListener(t, onEvent as EventListener);
        }
        return;
      }

      // WS transport. Vite's dev proxy doesn't reliably forward WS upgrades
      // for non-HMR paths, so prefer an explicit VITE_WS_URL / VITE_API_URL
      // origin and fall back to the page origin in production.
      const envUrl =
        (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
          ?.VITE_WS_URL ??
        (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
          ?.VITE_API_URL;
      const origin = envUrl ?? window.location.origin;
      const wsOrigin = origin.replace(/^http/, 'ws');
      const url = `${wsOrigin}/api/events/ws?access_token=${encodeURIComponent(
        session!.accessToken,
      )}${topicQuery}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.addEventListener('open', () => {
        setStatus('open');
        retryRef.current = 0;
      });
      ws.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as { type: string; payload?: RealtimeEvent };
          if (msg.type === 'event' && msg.payload) pushEvent(msg.payload);
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener('error', () => {
        setStatus('error');
        setError('WS connection error');
      });
      ws.addEventListener('close', () => {
        setStatus('closed');
        wsRef.current = null;
        scheduleReconnect();
      });
    }

    connect();

    return () => {
      closedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      sseRef.current?.close();
      wsRef.current?.close();
      sseRef.current = null;
      wsRef.current = null;
    };
  }, [transport, topicsKey, bufferSize]);

  return {
    status,
    events,
    error,
    transport,
    clear: () => setEvents([]),
  };
}

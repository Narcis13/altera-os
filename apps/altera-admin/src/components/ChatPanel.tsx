import { useEffect, useRef, useState } from 'react';
import { type AgentMessage, type AgentRuntimeEvent, type ChatStatus, api } from '../api';

type Bubble =
  | { kind: 'user'; id: string; text: string; attachment?: string }
  | { kind: 'assistant'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      toolName: string;
      input: unknown;
      output: string;
      isError: boolean;
    }
  | { kind: 'system'; id: string; text: string };

function newId(prefix = 'msg'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function pairToolEvents(events: AgentRuntimeEvent[]): Bubble[] {
  const pending: Record<string, { name: string; input: unknown; iter: number }> = {};
  const calls: Array<{
    iter: number;
    name: string;
    input: unknown;
    output: string;
    isError: boolean;
  }> = [];
  for (const ev of events) {
    if (ev.type === 'tool.call') {
      pending[`${ev.iteration}-${ev.toolName}`] = {
        name: ev.toolName,
        input: ev.input,
        iter: ev.iteration,
      };
    } else if (ev.type === 'tool.result') {
      const key = `${ev.iteration}-${ev.toolName}`;
      const p = pending[key];
      calls.push({
        iter: ev.iteration,
        name: ev.toolName,
        input: p?.input ?? {},
        output: ev.output,
        isError: ev.isError,
      });
      delete pending[key];
    }
  }
  return calls.map((c) => ({
    kind: 'tool',
    id: newId('tool'),
    toolName: c.name,
    input: c.input,
    output: c.output,
    isError: c.isError,
  }));
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .chatStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles]);

  function transcript(): AgentMessage[] {
    const msgs: AgentMessage[] = [];
    for (const b of bubbles) {
      if (b.kind === 'user') {
        msgs.push({ role: 'user', content: b.text });
      } else if (b.kind === 'assistant') {
        msgs.push({ role: 'assistant', content: b.text });
      }
    }
    return msgs;
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);

    let userText = text;
    if (attachment) {
      userText = `${text}\n\n--- attached: ${attachment.name} ---\n${attachment.text}`;
    }

    const userBubble: Bubble = {
      kind: 'user',
      id: newId('user'),
      text,
      ...(attachment ? { attachment: attachment.name } : {}),
    };
    setBubbles((prev) => [...prev, userBubble]);
    setDraft('');
    setAttachment(null);
    setBusy(true);

    const messages: AgentMessage[] = [...transcript(), { role: 'user', content: userText }];

    try {
      const res = await api.chat({ messages });
      const newBubbles: Bubble[] = [];
      const toolBubbles = pairToolEvents(res.events);
      newBubbles.push(...toolBubbles);
      if (res.finalContent) {
        newBubbles.push({ kind: 'assistant', id: newId('asst'), text: res.finalContent });
      } else {
        newBubbles.push({
          kind: 'assistant',
          id: newId('asst'),
          text: '(no reply — stopReason=' + res.stopReason + ')',
        });
      }
      setBubbles((prev) => [...prev, ...newBubbles]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onAttachFile(file: File) {
    try {
      const text = await file.text();
      setAttachment({ name: file.name, text: text.slice(0, 16_000) });
    } catch (e) {
      setError(`Could not read file: ${(e as Error).message}`);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            robun
          </div>
          <div className="text-[11px] text-slate-500">
            {status
              ? status.enabled
                ? `connected · ${status.model}`
                : 'mock mode'
              : 'connecting…'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          close
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {bubbles.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-12">
            Ask robun about your entities, attributes, or recent uploads.
          </div>
        )}
        {bubbles.map((b) => {
          if (b.kind === 'user') {
            return (
              <div key={b.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-slate-900 text-white text-[13px] px-3 py-2 whitespace-pre-wrap break-words">
                  {b.text}
                  {b.attachment && (
                    <div className="text-[10px] text-slate-300 mt-1">📎 {b.attachment}</div>
                  )}
                </div>
              </div>
            );
          }
          if (b.kind === 'assistant') {
            return (
              <div key={b.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-lg bg-slate-100 text-slate-900 text-[13px] px-3 py-2 whitespace-pre-wrap break-words">
                  {b.text}
                </div>
              </div>
            );
          }
          if (b.kind === 'tool') {
            return <ToolBubble key={b.id} bubble={b} />;
          }
          return (
            <div key={b.id} className="text-[11px] text-slate-500 italic text-center">
              {b.text}
            </div>
          );
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-slate-100 text-slate-500 text-[13px] px-3 py-2">
              thinking…
            </div>
          </div>
        )}
      </div>

      {error && <div className="px-3 py-2 text-xs text-red-600 border-t border-red-100">{error}</div>}

      <div className="border-t border-slate-200 p-2">
        {attachment && (
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-600 bg-slate-100 rounded px-2 py-1">
            <span className="truncate">📎 {attachment.name}</span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-slate-500 hover:text-slate-900"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-100"
            title="Attach a text file (its contents are inlined into the prompt)"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".txt,.md,.json,.csv,.log"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onAttachFile(f);
              e.target.value = '';
            }}
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            rows={2}
            placeholder="Ask robun…"
            className="flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={busy || !draft.trim()}
            className="rounded-md bg-slate-900 text-white text-xs px-3 py-1.5 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolBubble({
  bubble,
}: {
  bubble: { toolName: string; input: unknown; output: string; isError: boolean };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-lg border border-slate-200 bg-white text-[12px]">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-slate-50"
        >
          <span className="font-mono text-slate-700">
            🔧 {bubble.toolName}{' '}
            {bubble.isError && <span className="text-red-600">· error</span>}
          </span>
          <span className="text-[10px] text-slate-500">{open ? 'hide' : 'show'}</span>
        </button>
        {open && (
          <div className="px-3 pb-2 space-y-1">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">input</div>
              <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(bubble.input, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">output</div>
              <pre
                className={`text-[11px] ${
                  bubble.isError
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : 'bg-slate-50 border-slate-200'
                } border rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all`}
              >
                {bubble.output}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

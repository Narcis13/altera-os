import { useEffect, useMemo, useState } from 'react';
import { type DocsTemplateDetail, type DocsTemplateListItem, api } from '../api';
import { AppShell } from '../components/AppShell';

const NEW_TEMPLATE_DEFAULT = {
  id: 'doc-1',
  version: 1,
  title: 'New Template',
  kind: 'report',
  sections: [
    {
      id: 'main',
      components: [
        {
          id: 'title',
          type: 'heading',
          mode: 'read',
          bind: { content: 'title' },
          props: { level: 1 },
        },
      ],
    },
  ],
};

const SAMPLE_DATA = '{\n  "title": "Hello world"\n}';

export function TemplatesPage() {
  const [items, setItems] = useState<DocsTemplateListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocsTemplateDetail | null>(null);
  const [editor, setEditor] = useState<string>('');
  const [data, setData] = useState<string>(SAMPLE_DATA);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [errors, setErrors] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState('');

  function refreshList() {
    api
      .listTemplates()
      .then((r) => setItems(r.templates))
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    refreshList();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setEditor('');
      return;
    }
    setBusy(true);
    api
      .getTemplate(selectedId)
      .then((r) => {
        setDetail(r.template);
        setEditor(JSON.stringify(r.template.definition, null, 2));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, [selectedId]);

  const parsedDefinition = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(editor) };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [editor]);

  const parsedData = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(data) };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [data]);

  async function onSave() {
    if (!detail || !parsedDefinition.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateTemplate(detail.id, { definition: parsedDefinition.value });
      setDetail(r.template);
      setEditor(JSON.stringify(r.template.definition, null, 2));
      refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onPreview() {
    if (!parsedDefinition.ok || !parsedData.ok) {
      setError('Fix JSON before previewing');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.renderTemplate({
        definition: parsedDefinition.value,
        data: parsedData.value,
        persist: false,
      });
      setPreviewHtml(r.html);
      setErrors(r.errors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRenderAndPersist() {
    if (!detail || !parsedData.ok) {
      setError('Select a template and provide valid data');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.renderTemplate({
        templateId: detail.id,
        data: parsedData.value,
        persist: true,
      });
      setPreviewHtml(r.html);
      setErrors(r.errors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!newSlug.trim()) {
      setError('Slug is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.createTemplate({
        slug: newSlug.trim(),
        kind: 'report',
        definition: NEW_TEMPLATE_DEFAULT,
      });
      setCreating(false);
      setNewSlug('');
      refreshList();
      setSelectedId(r.template.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Templates"
      subtitle="docraftr report/form definitions"
      actions={
        <button
          type="button"
          onClick={() => setCreating((s) => !s)}
          className="rounded-md bg-slate-900 text-white text-xs px-3 py-1.5"
        >
          {creating ? 'Cancel' : 'New template'}
        </button>
      }
    >
      <div className="p-4 grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]">
        <aside className="rounded-xl bg-white border border-slate-200">
          {creating && (
            <div className="p-3 border-b border-slate-200 space-y-2">
              <input
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="slug-here"
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={onCreate}
                disabled={busy}
                className="w-full rounded-md bg-emerald-700 text-white text-xs py-1.5"
              >
                Create
              </button>
            </div>
          )}
          <ul className="divide-y divide-slate-100 max-h-[80vh] overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-xs text-slate-500 text-center">No templates yet.</li>
            )}
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${
                    selectedId === t.id ? 'bg-slate-100' : ''
                  }`}
                >
                  <div className="text-sm font-medium truncate">{t.title || t.slug}</div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {t.slug} · {t.kind} · {t.status}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-xl bg-white border border-slate-200 flex flex-col min-w-0">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Definition (JSON)
            </div>
            <div className="flex items-center gap-2">
              {parsedDefinition.ok ? (
                <span className="text-[10px] text-emerald-600">valid JSON</span>
              ) : (
                <span className="text-[10px] text-red-600">invalid: {parsedDefinition.message}</span>
              )}
              <button
                type="button"
                disabled={!detail || !parsedDefinition.ok || busy}
                onClick={onSave}
                className="rounded-md bg-slate-900 text-white text-xs px-2 py-1 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
          <textarea
            spellCheck={false}
            value={editor}
            onChange={(e) => setEditor(e.target.value)}
            className="flex-1 min-h-[60vh] font-mono text-[12px] p-3 resize-none focus:outline-none"
            placeholder={detail ? '' : 'Select a template on the left.'}
          />
        </section>

        <section className="rounded-xl bg-white border border-slate-200 flex flex-col min-w-0">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-slate-500">Preview</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPreview}
                disabled={busy}
                className="rounded-md border border-slate-300 text-xs px-2 py-1 hover:bg-slate-100"
              >
                Preview (no save)
              </button>
              <button
                type="button"
                onClick={onRenderAndPersist}
                disabled={busy || !detail}
                className="rounded-md bg-emerald-700 text-white text-xs px-2 py-1 disabled:opacity-40"
              >
                Render &amp; persist
              </button>
            </div>
          </div>
          <div className="px-3 py-2 border-b border-slate-200">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              Sample data (JSON)
            </div>
            <textarea
              spellCheck={false}
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-full h-24 font-mono text-[11px] rounded border border-slate-200 p-2 resize-none focus:outline-none"
            />
            {!parsedData.ok && (
              <div className="text-[10px] text-red-600 mt-1">{parsedData.message}</div>
            )}
          </div>
          {error && <div className="px-3 py-2 text-xs text-red-600 border-b">{error}</div>}
          {errors.length > 0 && (
            <div className="px-3 py-2 text-xs text-amber-700 border-b bg-amber-50">
              <div className="font-semibold">Render warnings:</div>
              <pre className="text-[10px] whitespace-pre-wrap break-all">
                {JSON.stringify(errors, null, 2)}
              </pre>
            </div>
          )}
          <div className="flex-1 min-h-[40vh] overflow-auto bg-white">
            {previewHtml ? (
              <iframe
                title="preview"
                className="w-full min-h-[60vh] border-0"
                srcDoc={previewHtml}
              />
            ) : (
              <div className="text-xs text-slate-500 text-center py-8">
                Click “Preview” to render.
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

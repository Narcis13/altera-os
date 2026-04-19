import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type FileDetail, type FileListItem, api } from '../api';

const PAGE_SIZE = 25;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface UploadEntry {
  key: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  fileId?: string;
}

export function IngestPage() {
  const [files, setFiles] = useState<FileListItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setListError(null);
    try {
      const res = await api.listFiles({ limit: PAGE_SIZE, offset: nextOffset });
      setFiles(res.files);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(offset);
  }, [refresh, offset]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api
      .getFile(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setDetailError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
      if (arr.length === 0) return;
      const entries: UploadEntry[] = arr.map((f) => ({
        key: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        status: 'uploading',
      }));
      setUploads((prev) => [...entries, ...prev]);

      await Promise.all(
        arr.map(async (f, idx) => {
          const entry = entries[idx]!;
          try {
            const uploaded = await api.uploadFile(f);
            setUploads((prev) =>
              prev.map((u) =>
                u.key === entry.key ? { ...u, status: 'done', fileId: uploaded.id } : u,
              ),
            );
          } catch (e) {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === entry.key
                  ? { ...u, status: 'error', error: (e as Error).message }
                  : u,
              ),
            );
          }
        }),
      );
      await refresh(0);
      setOffset(0);
    },
    [refresh],
  );

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white">
        <div>
          <h1 className="text-lg font-semibold">Ingest</h1>
          <p className="text-xs text-slate-500">Upload files → parse → pre-EAV</p>
        </div>
        <Link to="/" className="text-sm text-slate-600 hover:underline">
          ← Dashboard
        </Link>
      </header>

      <main className="p-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="space-y-4 min-w-0">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            role="button"
            tabIndex={0}
            className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition ${
              dragOver
                ? 'border-slate-900 bg-slate-50'
                : 'border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="text-sm text-slate-700 font-medium">
              Drop files here or click to upload
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Supported: PDF, DOCX, XLSX, CSV, TXT, MD
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {uploads.length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                Upload queue
              </div>
              <ul className="space-y-1 text-xs">
                {uploads.map((u) => (
                  <li key={u.key} className="flex justify-between gap-3">
                    <span className="truncate text-slate-700">{u.name}</span>
                    <span
                      className={
                        u.status === 'done'
                          ? 'text-emerald-600'
                          : u.status === 'error'
                            ? 'text-red-600'
                            : 'text-slate-500'
                      }
                    >
                      {u.status === 'done'
                        ? 'done'
                        : u.status === 'error'
                          ? (u.error ?? 'failed')
                          : 'uploading…'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl bg-white border border-slate-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="text-xs uppercase tracking-wide text-slate-500">Files</div>
              <div className="text-xs text-slate-500">
                {loading ? 'loading…' : `${files.length} shown`}
              </div>
            </div>
            {listError && <div className="px-4 py-3 text-xs text-red-600">{listError}</div>}
            <ul className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
              {files.length === 0 && !loading && (
                <li className="px-4 py-6 text-sm text-slate-500 text-center">
                  No files yet. Drop some above.
                </li>
              )}
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(f.id)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                      selectedId === f.id ? 'bg-slate-100' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-900">{f.name}</span>
                      <span className="text-xs text-slate-500">{formatBytes(f.sizeBytes)}</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 truncate">
                      {f.mimeType} · {new Date(f.uploadedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-xs">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-slate-500">offset {offset}</span>
              <button
                type="button"
                disabled={files.length < PAGE_SIZE}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-4 min-w-0">
          {!selectedId && (
            <div className="text-sm text-slate-500 py-16 text-center">
              Select a file on the left to see its extracted text.
            </div>
          )}
          {selectedId && detailLoading && (
            <div className="text-sm text-slate-500 py-6">Loading…</div>
          )}
          {detailError && <div className="text-sm text-red-600">{detailError}</div>}
          {detail && (
            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">File</div>
                <div className="text-base font-medium text-slate-900 break-all">
                  {detail.file.name}
                </div>
                <div className="text-xs font-mono text-slate-500 break-all">
                  {detail.file.mimeType} · {formatBytes(detail.file.sizeBytes)} · sha256:
                  {detail.file.hashSha256.slice(0, 16)}…
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Entity</div>
                {detail.entity ? (
                  <div className="text-xs font-mono text-slate-700 break-all">
                    {detail.entity.id} · status={detail.entity.status}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Not yet created (still parsing?)</div>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Parse metadata
                </div>
                <pre className="mt-1 text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(detail.parseMetadata, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Extracted text
                </div>
                <pre className="mt-1 text-xs bg-slate-50 border border-slate-200 rounded p-2 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words">
                  {detail.rawText ?? '(no text — worker may not have run yet)'}
                </pre>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

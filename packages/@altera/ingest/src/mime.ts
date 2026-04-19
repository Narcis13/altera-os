const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
};

export const MIME_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'application/json': 'json',
};

export function extensionOf(filename: string): string | null {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return null;
  return filename.slice(idx + 1).toLowerCase();
}

function startsWith(buf: Uint8Array, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

export function sniffMime(buf: Uint8Array): string | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    return 'application/zip';
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return 'application/vnd.ms-excel';
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return 'text/plain';
  }
  return null;
}

export function isProbablyText(buf: Uint8Array, sampleSize = 4096): boolean {
  const limit = Math.min(buf.length, sampleSize);
  if (limit === 0) return true;
  let control = 0;
  for (let i = 0; i < limit; i++) {
    const b = buf[i] ?? 0;
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) control++;
  }
  return control / limit < 0.05;
}

function looksLikeCsv(buf: Uint8Array): boolean {
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4096));
  const lines = sample.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return false;
  const counts = lines.slice(0, 5).map((l) => (l.match(/,/g) ?? []).length);
  if (counts[0] === 0) return false;
  return counts.every((c) => c === counts[0]);
}

function looksLikeMarkdown(buf: Uint8Array, extension?: string | null): boolean {
  if (extension === 'md' || extension === 'markdown') return true;
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 2048));
  return /(^|\n)(#{1,6}\s|\*\s|-\s|```|\[.+?\]\(.+?\))/.test(sample);
}

export interface DetectOptions {
  filename?: string;
  declaredMime?: string;
}

export function detectMime(buf: Uint8Array, opts: DetectOptions = {}): string {
  const ext = opts.filename ? extensionOf(opts.filename) : null;
  const sniffed = sniffMime(buf);

  if (sniffed === 'application/pdf') return 'application/pdf';

  if (sniffed === 'application/zip') {
    if (ext === 'docx') {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (ext === 'xlsx') {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (opts.declaredMime && opts.declaredMime !== 'application/octet-stream') {
      return opts.declaredMime;
    }
    return 'application/zip';
  }

  if (sniffed === 'application/vnd.ms-excel') return 'application/vnd.ms-excel';

  if (ext && EXTENSION_MIME[ext]) return EXTENSION_MIME[ext] as string;

  if (
    opts.declaredMime &&
    opts.declaredMime !== 'application/octet-stream' &&
    opts.declaredMime.length > 0
  ) {
    return opts.declaredMime;
  }

  if (isProbablyText(buf)) {
    if (looksLikeCsv(buf)) return 'text/csv';
    if (looksLikeMarkdown(buf, ext)) return 'text/markdown';
    return 'text/plain';
  }

  return 'application/octet-stream';
}

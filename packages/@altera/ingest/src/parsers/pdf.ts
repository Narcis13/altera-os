import { createRequire } from 'node:module';
import type { Parser, ParseResult } from '../types.ts';

const require = createRequire(import.meta.url);

interface PdfParseFn {
  (data: Buffer): Promise<{
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }>;
}

let cached: PdfParseFn | null = null;

function loadPdfParse(): PdfParseFn {
  if (cached) return cached;
  const mod = require('pdf-parse/lib/pdf-parse.js') as PdfParseFn | { default: PdfParseFn };
  cached = typeof mod === 'function' ? mod : mod.default;
  return cached;
}

export const pdfParser: Parser = {
  mimeTypes: ['application/pdf'],
  async parse(buffer: Uint8Array): Promise<ParseResult> {
    const pdfParse = loadPdfParse();
    const nodeBuffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const res = await pdfParse(nodeBuffer);
    const text = (res.text ?? '').trim();
    const pages = typeof res.numpages === 'number' ? res.numpages : undefined;
    const out: ParseResult = {
      text,
      metadata: {
        characters: text.length,
        ...(res.info ? { info: res.info as Record<string, unknown> } : {}),
        ...(res.version ? { pdfVersion: res.version } : {}),
      },
    };
    if (pages !== undefined) out.pages = pages;
    return out;
  },
};

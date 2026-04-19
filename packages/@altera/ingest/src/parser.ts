import { detectMime } from './mime.ts';
import { csvParser_comma, csvParser_tab } from './parsers/csv.ts';
import { docxParser } from './parsers/docx.ts';
import { markdownParser } from './parsers/markdown.ts';
import { pdfParser } from './parsers/pdf.ts';
import { plaintextParser } from './parsers/plaintext.ts';
import { xlsxParser } from './parsers/xlsx.ts';
import { type Parser, type ParseResult, UnsupportedMimeTypeError } from './types.ts';

const REGISTRY = new Map<string, Parser>();

function register(parser: Parser): void {
  for (const mime of parser.mimeTypes) {
    REGISTRY.set(mime, parser);
  }
}

register(plaintextParser);
register(markdownParser);
register(csvParser_comma);
register(csvParser_tab);
register(docxParser);
register(xlsxParser);
register(pdfParser);

export interface ParseFileOptions {
  filename?: string;
  declaredMime?: string;
}

export interface ParseFileOutcome extends ParseResult {
  mimeType: string;
}

export async function parseFile(
  buffer: Uint8Array,
  options: string | ParseFileOptions = {},
): Promise<ParseFileOutcome> {
  const opts: ParseFileOptions =
    typeof options === 'string' ? { declaredMime: options } : options;

  const detected = detectMime(buffer, opts);
  const parser = REGISTRY.get(detected);
  if (!parser) throw new UnsupportedMimeTypeError(detected);

  const result = await parser.parse(buffer, opts.filename);
  return { ...result, mimeType: detected };
}

export function getParser(mimeType: string): Parser | null {
  return REGISTRY.get(mimeType) ?? null;
}

export function supportedMimeTypes(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

import type { Parser, ParseResult } from '../types.ts';

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function extractHeadings(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push(m[2] as string);
  }
  return out;
}

export const markdownParser: Parser = {
  mimeTypes: ['text/markdown', 'text/x-markdown'],
  async parse(buffer: Uint8Array): Promise<ParseResult> {
    const text = stripBom(new TextDecoder('utf-8', { fatal: false }).decode(buffer));
    const headings = extractHeadings(text);
    return {
      text,
      metadata: {
        encoding: 'utf-8',
        headings,
        headingCount: headings.length,
        characters: text.length,
      },
    };
  },
};

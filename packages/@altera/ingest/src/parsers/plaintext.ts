import type { Parser, ParseResult } from '../types.ts';

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export const plaintextParser: Parser = {
  mimeTypes: ['text/plain', 'application/json'],
  async parse(buffer: Uint8Array): Promise<ParseResult> {
    const text = stripBom(new TextDecoder('utf-8', { fatal: false }).decode(buffer));
    const lines = text.split(/\r?\n/).length;
    return {
      text,
      metadata: {
        encoding: 'utf-8',
        lines,
        characters: text.length,
      },
    };
  },
};

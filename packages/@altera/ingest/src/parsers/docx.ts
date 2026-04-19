import mammoth from 'mammoth';
import type { Parser, ParseResult } from '../types.ts';

export const docxParser: Parser = {
  mimeTypes: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ],
  async parse(buffer: Uint8Array): Promise<ParseResult> {
    const nodeBuffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result = await mammoth.extractRawText({ buffer: nodeBuffer });
    const text = result.value ?? '';
    const warnings = (result.messages ?? [])
      .filter((m) => m.type === 'warning' || m.type === 'error')
      .map((m) => m.message);
    return {
      text,
      metadata: {
        characters: text.length,
        warnings,
      },
    };
  },
};

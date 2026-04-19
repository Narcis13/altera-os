export interface ParseResult {
  text: string;
  metadata: Record<string, unknown>;
  pages?: number;
}

export interface Parser {
  readonly mimeTypes: readonly string[];
  parse(buffer: Uint8Array, filename?: string): Promise<ParseResult>;
}

export class UnsupportedMimeTypeError extends Error {
  readonly mimeType: string;
  constructor(mimeType: string) {
    super(`No parser registered for mime type: ${mimeType}`);
    this.name = 'UnsupportedMimeTypeError';
    this.mimeType = mimeType;
  }
}

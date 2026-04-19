import { parse as parseCsvSync } from 'csv-parse/sync';
import type { Parser, ParseResult } from '../types.ts';

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

interface CsvOptions {
  delimiter: string;
}

function csvParser(opts: CsvOptions): Parser {
  return {
    mimeTypes:
      opts.delimiter === ','
        ? ['text/csv', 'application/csv']
        : ['text/tab-separated-values', 'text/tsv'],
    async parse(buffer: Uint8Array): Promise<ParseResult> {
      const raw = stripBom(new TextDecoder('utf-8', { fatal: false }).decode(buffer));
      const records = parseCsvSync(raw, {
        delimiter: opts.delimiter,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];

      const header = records[0] ?? [];
      const rowCount = Math.max(0, records.length - (records.length > 0 ? 1 : 0));
      const columnCount = header.length;

      const lines: string[] = [];
      if (records.length > 0) {
        lines.push(records.map((row) => row.join(' | ')).join('\n'));
      }
      const text = lines.join('\n');

      return {
        text,
        metadata: {
          delimiter: opts.delimiter,
          columns: header,
          columnCount,
          rowCount,
          totalRecords: records.length,
        },
      };
    },
  };
}

export const csvParser_comma = csvParser({ delimiter: ',' });
export const csvParser_tab = csvParser({ delimiter: '\t' });

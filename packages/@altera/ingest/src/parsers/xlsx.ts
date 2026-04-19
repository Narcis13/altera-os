import * as XLSX from 'xlsx';
import type { Parser, ParseResult } from '../types.ts';

interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export const xlsxParser: Parser = {
  mimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
  async parse(buffer: Uint8Array): Promise<ParseResult> {
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheets: SheetInfo[] = [];
    const chunks: string[] = [];

    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const rows = csv.split(/\r?\n/).filter((l) => l.length > 0);
      const firstRow = rows[0] ?? '';
      const columnCount = firstRow ? firstRow.split(',').length : 0;
      sheets.push({ name, rowCount: rows.length, columnCount });
      chunks.push(`# Sheet: ${name}\n${csv}`);
    }

    return {
      text: chunks.join('\n\n').trim(),
      metadata: {
        sheetNames: wb.SheetNames,
        sheetCount: wb.SheetNames.length,
        sheets,
      },
    };
  },
};

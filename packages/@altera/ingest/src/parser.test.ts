import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectMime, parseFile, supportedMimeTypes } from './index.ts';
import { buildDocx, buildPdf, buildXlsx } from './test-utils.ts';

const FIXTURES = resolve(import.meta.dir, '__fixtures__');

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, name)));
}

describe('detectMime', () => {
  test('detects PDF by magic bytes', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(detectMime(buf)).toBe('application/pdf');
  });

  test('detects docx by extension when buffer is a zip', () => {
    const zipSig = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(detectMime(zipSig, { filename: 'doc.docx' })).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  test('detects xlsx by extension when buffer is a zip', () => {
    const zipSig = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(detectMime(zipSig, { filename: 'book.xlsx' })).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  test('falls back to text/plain for ASCII content', () => {
    const buf = new TextEncoder().encode('just some plain text\nwith newlines\n');
    expect(detectMime(buf)).toBe('text/plain');
  });

  test('sniffs csv from content', () => {
    const buf = new TextEncoder().encode('a,b,c\n1,2,3\n4,5,6\n');
    expect(detectMime(buf)).toBe('text/csv');
  });

  test('sniffs markdown from content', () => {
    const buf = new TextEncoder().encode('# heading\n\nsome body\n');
    expect(detectMime(buf)).toBe('text/markdown');
  });

  test('honors declared mime when extension is unknown', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff]);
    expect(detectMime(buf, { declaredMime: 'image/jpeg' })).toBe('image/jpeg');
  });
});

describe('supportedMimeTypes', () => {
  test('includes core formats', () => {
    const set = new Set(supportedMimeTypes());
    for (const mime of [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/plain',
      'text/markdown',
    ]) {
      expect(set.has(mime)).toBe(true);
    }
  });
});

describe('parseFile — plaintext', () => {
  test('parses sample.txt fixture', async () => {
    const buf = readFixture('sample.txt');
    const res = await parseFile(buf, { filename: 'sample.txt' });
    expect(res.mimeType).toBe('text/plain');
    expect(res.text).toContain('Altera OS plaintext fixture');
    expect((res.metadata as { lines: number }).lines).toBeGreaterThan(1);
  });
});

describe('parseFile — markdown', () => {
  test('parses sample.md fixture and extracts headings', async () => {
    const buf = readFixture('sample.md');
    const res = await parseFile(buf, { filename: 'sample.md' });
    expect(res.mimeType).toBe('text/markdown');
    expect(res.text).toContain('Altera OS Markdown Fixture');
    const md = res.metadata as { headings: string[] };
    expect(md.headings).toContain('Altera OS Markdown Fixture');
    expect(md.headings).toContain('Section One');
    expect(md.headings).toContain('Section Two');
  });
});

describe('parseFile — csv', () => {
  test('parses sample.csv fixture', async () => {
    const buf = readFixture('sample.csv');
    const res = await parseFile(buf, { filename: 'sample.csv' });
    expect(res.mimeType).toBe('text/csv');
    expect(res.text).toContain('Alice');
    expect(res.text).toContain('Bob');
    const md = res.metadata as { columns: string[]; rowCount: number };
    expect(md.columns).toEqual(['name', 'age', 'city']);
    expect(md.rowCount).toBe(3);
  });
});

describe('parseFile — xlsx', () => {
  test('parses generated xlsx fixture', async () => {
    const buf = buildXlsx(
      [
        ['product', 'qty', 'price'],
        ['widget', 3, 9.99],
        ['gadget', 7, 14.5],
      ],
      'Inventory',
    );
    const res = await parseFile(buf, { filename: 'inventory.xlsx' });
    expect(res.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.text).toContain('widget');
    expect(res.text).toContain('gadget');
    const md = res.metadata as { sheetNames: string[]; sheetCount: number };
    expect(md.sheetNames).toEqual(['Inventory']);
    expect(md.sheetCount).toBe(1);
  });
});

describe('parseFile — docx', () => {
  test('parses generated docx fixture', async () => {
    const buf = buildDocx(['Altera DOCX fixture.', 'Second paragraph.']);
    const res = await parseFile(buf, { filename: 'fixture.docx' });
    expect(res.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.text).toContain('Altera DOCX fixture');
    expect(res.text).toContain('Second paragraph');
  });
});

describe('parseFile — pdf', () => {
  test('parses generated pdf fixture', async () => {
    const buf = buildPdf('Hello Altera PDF');
    const res = await parseFile(buf, { filename: 'hello.pdf' });
    expect(res.mimeType).toBe('application/pdf');
    expect(res.text).toContain('Hello Altera PDF');
    expect(res.pages).toBe(1);
  });
});

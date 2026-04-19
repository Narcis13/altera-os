import * as XLSX from 'xlsx';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = ((CRC_TABLE[((c ^ (data[i] as number)) & 0xff) as number] as number) ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function writeUint16LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const records: Array<{
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    offset: number;
  }> = [];

  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const header = new Uint8Array(30 + nameBytes.length);
    writeUint32LE(header, 0, 0x04034b50);
    writeUint16LE(header, 4, 20);
    writeUint16LE(header, 6, 0);
    writeUint16LE(header, 8, 0);
    writeUint16LE(header, 10, 0);
    writeUint16LE(header, 12, 0);
    writeUint32LE(header, 14, crc);
    writeUint32LE(header, 18, size);
    writeUint32LE(header, 22, size);
    writeUint16LE(header, 26, nameBytes.length);
    writeUint16LE(header, 28, 0);
    header.set(nameBytes, 30);

    localChunks.push(header, entry.data);
    records.push({ nameBytes, crc, size, offset });
    offset += header.length + size;
  }

  const centralStart = offset;
  for (const rec of records) {
    const cd = new Uint8Array(46 + rec.nameBytes.length);
    writeUint32LE(cd, 0, 0x02014b50);
    writeUint16LE(cd, 4, 20);
    writeUint16LE(cd, 6, 20);
    writeUint16LE(cd, 8, 0);
    writeUint16LE(cd, 10, 0);
    writeUint16LE(cd, 12, 0);
    writeUint16LE(cd, 14, 0);
    writeUint32LE(cd, 16, rec.crc);
    writeUint32LE(cd, 20, rec.size);
    writeUint32LE(cd, 24, rec.size);
    writeUint16LE(cd, 28, rec.nameBytes.length);
    writeUint16LE(cd, 30, 0);
    writeUint16LE(cd, 32, 0);
    writeUint16LE(cd, 34, 0);
    writeUint16LE(cd, 36, 0);
    writeUint32LE(cd, 38, 0);
    writeUint32LE(cd, 42, rec.offset);
    cd.set(rec.nameBytes, 46);
    centralChunks.push(cd);
    offset += cd.length;
  }

  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 4, 0);
  writeUint16LE(eocd, 6, 0);
  writeUint16LE(eocd, 8, records.length);
  writeUint16LE(eocd, 10, records.length);
  writeUint32LE(eocd, 12, centralSize);
  writeUint32LE(eocd, 16, centralStart);
  writeUint16LE(eocd, 20, 0);

  const total = offset + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(eocd, pos);
  return out;
}

export function buildDocx(paragraphs: string[]): Uint8Array {
  const enc = new TextEncoder();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const escaped = paragraphs.map((p) =>
    p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );
  const body = escaped
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;

  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(document) },
  ]);
}

export function buildXlsx(rows: Array<Array<string | number>>, sheetName = 'Sheet1'): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export function buildPdf(text: string): Uint8Array {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const streamBytes = new TextEncoder().encode(stream);

  const objects: string[] = [];
  objects.push('1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n');
  objects.push('2 0 obj\n<</Type/Pages/Count 1/Kids[3 0 R]>>\nendobj\n');
  objects.push(
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>\nendobj\n',
  );
  objects.push(`4 0 obj\n<</Length ${streamBytes.length}>>\nstream\n${stream}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\n');

  const header = '%PDF-1.4\n';
  const parts: string[] = [header];
  const offsets: number[] = [];
  let offset = header.length;
  for (const obj of objects) {
    offsets.push(offset);
    parts.push(obj);
    offset += obj.length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  parts.push(xref);
  parts.push(
    `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return new TextEncoder().encode(parts.join(''));
}

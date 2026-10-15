import { describe, expect, it } from 'vitest';
import { buildXlsx, columnLetter, crc32, XLSX_STYLE, zipStore } from '../shared/xlsxWriter.js';
import { buildStowSheetRows, buildStowTable } from '../shared/stowReportTable.js';

const text = (s) => new TextEncoder().encode(s);

// Reads back an uncompressed zip by walking its local file headers.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength;
    files[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });
});

describe('columnLetter', () => {
  it('converts zero-based indexes to Excel column letters', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('zipStore', () => {
  it('produces a readable archive with an end-of-central-directory record', () => {
    const zip = zipStore([
      { name: 'a.txt', data: text('hello') },
      { name: 'dir/b.txt', data: text('world') },
    ]);
    expect(readZip(zip)).toEqual({ 'a.txt': 'hello', 'dir/b.txt': 'world' });
    const view = new DataView(zip.buffer);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });
});

describe('buildXlsx', () => {
  it('writes numbers as numbers, strings inline and escaped, with styles', () => {
    const files = readZip(
      buildXlsx({
        sheetName: 'Saatlik Stow',
        rows: [[{ v: 'Kullanıcı & <x>', s: XLSX_STYLE.HEADER }, { v: 42, s: XLSX_STYLE.TOP }]],
        freeze: { rows: 1, cols: 1 },
      })
    );
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(Object.keys(files)).toContain('[Content_Types].xml');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Kullanıcı &amp; &lt;x&gt;</t></is></c>');
    expect(sheet).toContain('<c r="B1" s="2"><v>42</v></c>');
    expect(sheet).toContain('state="frozen"');
    expect(files['xl/workbook.xml']).toContain('name="Saatlik Stow"');
  });
});

describe('buildStowSheetRows', () => {
  it('mirrors the hourly table with green top cells and footer totals', () => {
    const table = buildStowTable([
      [{ login: 'a', managerId: 'm', opportunities: 10 }, { login: 'b', managerId: 'm', opportunities: 30 }],
      [{ login: 'a', managerId: 'm', opportunities: 50 }],
    ]);
    const slots = [
      { startTime: 0, endTime: 3600 },
      { startTime: 3600, endTime: 7200 },
    ];
    const rows = buildStowSheetRows(
      { table, rows: table.rows, slots, hourly: true, title: 'T' },
      XLSX_STYLE
    );

    expect(rows[0][0].v).toBe('T');
    expect(rows[2].map((c) => c.v).slice(0, 2)).toEqual(['#', 'Kullanıcı']);
    expect(rows[2].at(-1).v).toBe('Toplam');
    // a: 10 | 50 (top) | 60 (top)
    expect(rows[3].map((c) => [c.v, c.s])).toEqual([
      [1, undefined],
      ['a', undefined],
      [10, undefined],
      [50, XLSX_STYLE.TOP],
      [60, XLSX_STYLE.TOP],
    ]);
    // b: 30 is the top for the first hour
    expect(rows[4][2]).toEqual({ v: 30, s: XLSX_STYLE.TOP });
    expect(rows.at(-1).map((c) => c.v)).toEqual([null, 'Toplam (2 kişi)', 40, 50, 90]);
  });
});

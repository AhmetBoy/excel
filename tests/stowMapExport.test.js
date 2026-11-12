import { describe, expect, it } from 'vitest';
import { expandBin, findCandidates } from '../shared/stowMap.js';
import {
  buildExportRows,
  describeSection,
  exportFileName,
  selectSectionBins,
} from '../shared/stowMapExport.js';

// [id, binType, dropzone, totalUnits, unique, max, locked, canHoldHrv]
const bins = [
  ['P-1-A201D120', 'DRAWER', 'dz-1', 3, 1, 6, 0, 0],
  ['P-1-A201A120', 'DRAWER', 'dz-1', 3, 6, 6, 0, 0],
  ['P-1-A200D110', 'DRAWER', 'dz-1', 3, 2, 6, 0, 1],
  ['P-1-A200A130', 'DRAWER', 'dz-1', 3, 0, 6, 1, 0],
  ['P-1-A200A110', 'DRAWER', 'dz-2', 3, 0, 6, 0, 0],
  ['P-1-A205A150', 'DRAWER', 'dz-1', 3, 0, 6, 0, 0],
].map(expandBin);

const ids = (list) => list.map((b) => b.id);

describe('selectSectionBins', () => {
  it('keeps only bins with room and walks aisle > position > shelf by default', () => {
    const result = selectSectionBins(bins, {}, { floor: '1', tower: 'A', aisles: '200-201', onlyAvailable: true });
    expect(ids(result)).toEqual(['P-1-A200A110', 'P-1-A200D110', 'P-1-A201D120']);
  });

  it('lists every bin (full and locked too) when onlyAvailable is off', () => {
    const result = selectSectionBins(bins, {}, { floor: '1', aisles: '200-201', onlyAvailable: false });
    expect(result).toHaveLength(5);
    expect(result.find((b) => b.id === 'P-1-A200A130').free).toBe(0);
  });

  it('sorts shelf first when asked', () => {
    const result = selectSectionBins(bins, {}, { floor: '1', onlyAvailable: true, sort: 'shelf-aisle-position' });
    expect(ids(result)).toEqual(['P-1-A200A110', 'P-1-A205A150', 'P-1-A200D110', 'P-1-A201D120']);
  });

  it('filters by shelf, position range and dropzone, and counts records', () => {
    expect(ids(selectSectionBins(bins, {}, { floor: '1', shelves: ['D'], positions: '115-130' }))).toEqual([
      'P-1-A201D120',
    ]);
    expect(ids(selectSectionBins(bins, {}, { floor: '1', dropzone: 'dz-2' }))).toEqual(['P-1-A200A110']);
    const marked = selectSectionBins(bins, { 'P-1-A200A110': { full: true } }, { floor: '1', aisles: '200', onlyAvailable: true });
    expect(ids(marked)).toEqual(['P-1-A200D110']);
  });
});

describe('skipEmpty', () => {
  it('leaves out bins with nothing stowed in them yet', () => {
    expect(ids(findCandidates(bins, {}, { skipEmpty: true }))).toEqual(['P-1-A200D110', 'P-1-A201D120']);
    expect(ids(findCandidates(bins, { 'P-1-A205A150': { added: 1 } }, { skipEmpty: true }))).toContain('P-1-A205A150');
    expect(ids(selectSectionBins(bins, {}, { floor: '1', onlyAvailable: true, skipEmpty: true }))).toEqual([
      'P-1-A200D110',
      'P-1-A201D120',
    ]);
  });
});

describe('findCandidates positions', () => {
  it('limits suggestions to the position range', () => {
    expect(ids(findCandidates(bins, {}, { positions: [[140, 160]] }))).toEqual(['P-1-A205A150']);
  });
});

describe('buildExportRows', () => {
  it('writes title, section lines, header and numbered bins in section order', () => {
    const sections = [
      { floor: '1', shelves: ['D'], onlyAvailable: true },
      { floor: '1', shelves: ['A'], onlyAvailable: true },
    ];
    const parts = sections.map((section) => ({ section, bins: selectSectionBins(bins, {}, section) }));
    const { rows, headerRows } = buildExportRows('Test', parts, new Date(2026, 10, 11, 9, 5));
    expect(rows[0][0].v).toBe('Test · 11.11.2026 09:05 · 4 lokasyon');
    expect(rows[1][0].v).toContain('Bölüm 1: Kat 1 · Bin D');
    expect(headerRows).toBe(5);
    expect(rows[4][2].v).toBe('Lokasyon');
    const data = rows.slice(headerRows);
    expect(data.map((r) => r[2].v)).toEqual(['P-1-A200D110', 'P-1-A201D120', 'P-1-A200A110', 'P-1-A205A150']);
    expect(data.map((r) => r[0].v)).toEqual([1, 2, 3, 4]);
    expect(data.map((r) => r[1].v)).toEqual([1, 1, 2, 2]);
  });

  it('flags a section whose floor is not loaded', () => {
    const { rows } = buildExportRows('X', [{ section: { floor: '4' }, bins: [], missing: true }]);
    expect(rows[1][0].v).toContain('KAT YÜKLÜ DEĞİL');
  });
});

describe('describeSection / exportFileName', () => {
  it('describes a section', () => {
    expect(
      describeSection({ floor: '2', tower: 'A', aisles: '205-209', positions: '110-150', shelves: ['A', 'D'], onlyAvailable: true })
    ).toBe('Kat 2 · Tower A · Koridor 205-209 · Sıra 110-150 · Bin A, D · boş yeri olanlar · Koridor › Sıra › Bin');
  });

  it('makes a safe file name', () => {
    expect(exportFileName('Kat 2 / A binleri', new Date(2026, 10, 11, 9, 5))).toBe('Kat_2_A_binleri_20261111-0905.xlsx');
  });
});

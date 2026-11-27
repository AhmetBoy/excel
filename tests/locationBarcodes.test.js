import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  filledBins,
  groupBins,
  highValueAsins,
  parseLocationQuery,
  pendingResearchRecords,
  filterProductRecords,
  describeProductFilter,
  lpnRecords,
  productBarcodeOf,
  productBarcodes,
} from '../shared/locationBarcodes.js';
import { expandBin, parseStowMapCsv } from '../shared/stowMap.js';

function bin(id, totalUnits) {
  return expandBin([id, 'T', 'dz', totalUnits, 1, 6, 0, 0]);
}

describe('parseLocationQuery', () => {
  it('reads an aisle and an aisle + shelf', () => {
    expect(parseLocationQuery('p-1-a219')).toEqual({
      floor: '1', tower: 'A', fromAisle: 219, toAisle: 219, shelf: null, fromPosition: null, toPosition: null,
    });
    expect(parseLocationQuery('P-1-A219D')).toMatchObject({ fromAisle: 219, shelf: 'D', fromPosition: null });
  });

  it('reads a position range of one aisle in every written form', () => {
    for (const text of ['P-1-A219 220-225', 'P-1-A219-220-225', 'P-1-A219/220-225', 'p-1-a219 225-220', 'P-1-A219 220 – 225']) {
      expect(parseLocationQuery(text)).toMatchObject({ fromAisle: 219, toAisle: 219, fromPosition: 220, toPosition: 225 });
    }
    expect(parseLocationQuery('P-1-A219-225')).toMatchObject({ toAisle: 219, fromPosition: 225, toPosition: 225 });
    expect(parseLocationQuery('P-1-A219D 220-225')).toMatchObject({ shelf: 'D', fromPosition: 220, toPosition: 225 });
  });

  it('reads an aisle range with ".."', () => {
    expect(parseLocationQuery('P-1-A219..221')).toMatchObject({ fromAisle: 219, toAisle: 221, fromPosition: null });
    expect(parseLocationQuery('P-1-A221..P-1-A219')).toMatchObject({ fromAisle: 219, toAisle: 221 });
  });

  it('rejects other text and ranges across floors or towers', () => {
    expect(parseLocationQuery('tsXSA901234').error).toBeTruthy();
    expect(parseLocationQuery('').error).toBeTruthy();
    expect(parseLocationQuery('P-1-A219..P-2-A222').error).toContain('aynı kat');
  });
});

describe('filledBins / groupBins', () => {
  const bins = [
    bin('P-1-A219B205', 3),
    bin('P-1-A219A200', 1),
    bin('P-1-A219A201', 0),
    bin('P-1-A220A100', 2),
    bin('P-1-B219A200', 5),
    bin('P-2-A219A200', 5),
  ];

  it('keeps only filled bins of the query, in aisle/shelf/position order', () => {
    const q = parseLocationQuery('P-1-A219');
    expect(filledBins(bins, q).map((b) => b.id)).toEqual(['P-1-A219A200', 'P-1-A219B205']);
    expect(filledBins(bins, parseLocationQuery('P-1-A219B')).map((b) => b.id)).toEqual(['P-1-A219B205']);
    expect(filledBins(bins, parseLocationQuery('P-1-A219..220'))).toHaveLength(3);
  });

  it('keeps only bins that can hold HRV when asked', () => {
    const hrvBins = [expandBin(['P-1-A219A200', 'T', 'dz', 2, 1, 6, 0, 1]), bin('P-1-A219A201', 2)];
    const q = parseLocationQuery('P-1-A219');
    expect(filledBins(hrvBins, q, { hrvOnly: true }).map((b) => b.id)).toEqual(['P-1-A219A200']);
    expect(filledBins(hrvBins, q)).toHaveLength(2);
  });

  it('keeps the positions of a position range on every shelf', () => {
    const rows = [bin('P-1-A219A219', 1), bin('P-1-A219A220', 1), bin('P-1-A219E225', 1), bin('P-1-A219B230', 1), bin('P-1-A220A221', 1)];
    expect(filledBins(rows, parseLocationQuery('P-1-A219 220-225')).map((b) => b.id)).toEqual(['P-1-A219A220', 'P-1-A219E225']);
  });

  it('groups by aisle then shelf', () => {
    const groups = groupBins(filledBins(bins, parseLocationQuery('P-1-A219..220')));
    expect(groups.map((g) => [g.aisle, g.shelves.map((s) => s.shelf)])).toEqual([
      [219, ['A', 'B']],
      [220, ['A']],
    ]);
  });

  it('works on a real BinStatus report', () => {
    const { floors } = parseStowMapCsv(readFileSync('BinStatus_Report.csv', 'utf-8'));
    const floor = Object.keys(floors)[0];
    const all = floors[floor].map(expandBin);
    const sample = all.find((b) => b.totalUnits > 0 && b.aisle);
    const found = filledBins(all, parseLocationQuery(`P-${floor}-${sample.tower}${sample.aisle}`));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((b) => b.totalUnits > 0 && b.aisle === sample.aisle)).toBe(true);
  });
});

describe('product barcodes', () => {
  it('picks LPN, then X-ASIN, then B-ASIN', () => {
    expect(productBarcodeOf({ lpn: 'LPNUIN1', fnSku: 'X00A', asin: 'B0A' })).toEqual({ code: 'LPNUIN1', kind: 'lpn' });
    expect(productBarcodeOf({ lpn: '', fnSku: 'X00A', asin: 'B0A' })).toEqual({ code: 'X00A', kind: 'fnsku' });
    expect(productBarcodeOf({ fnSku: 'B0A', asin: 'B0A' })).toEqual({ code: 'B0A', kind: 'asin' });
    expect(productBarcodeOf({})).toBeNull();
  });

  it('adds up quantities and lists LPN, X, B in that order', () => {
    const list = productBarcodes([
      { asin: 'B0B', fnSku: 'B0B', quantity: '2' },
      { asin: 'B0B', fnSku: 'B0B', quantity: '1' },
      { asin: 'B0C', fnSku: 'X00C', quantity: '1' },
      { asin: 'B0D', lpn: 'LPNUIN9', quantity: '1' },
    ]);
    expect(list.map((i) => [i.code, i.quantity])).toEqual([
      ['LPNUIN9', 1],
      ['X00C', 1],
      ['B0B', 3],
    ]);
  });
});

describe('pendingResearchRecords', () => {
  it('keeps only PENDING_RESEARCH rows', () => {
    const rows = [{ consumer: 'pending_research ' }, { consumer: 'UNOWNED' }, {}];
    expect(pendingResearchRecords(rows)).toEqual([{ consumer: 'pending_research ' }]);
  });
});

describe('LPN and combined product filters', () => {
  const rows = [
    { lpn: 'LPNUIN1', consumer: 'PENDING_RESEARCH' },
    { lpn: 'LPNUIN2', consumer: 'UNOWNED' },
    { lpn: '', consumer: 'PENDING_RESEARCH' },
    { consumer: 'UNOWNED' },
  ];

  it('keeps rows with an LPN', () => {
    expect(lpnRecords(rows).map((r) => r.lpn)).toEqual(['LPNUIN1', 'LPNUIN2']);
  });

  it('combines filters with AND', () => {
    expect(filterProductRecords(rows, { pending: true })).toHaveLength(2);
    expect(filterProductRecords(rows, { lpn: true })).toHaveLength(2);
    expect(filterProductRecords(rows, { pending: true, lpn: true })).toEqual([rows[0]]);
    expect(filterProductRecords(rows, {})).toHaveLength(4);
  });

  it('names the active filters', () => {
    expect(describeProductFilter({ pending: true })).toBe('PENDING_RESEARCH');
    expect(describeProductFilter({ lpn: true })).toBe("LPN'li");
    expect(describeProductFilter({ pending: true, lpn: true })).toBe("PENDING_RESEARCH + LPN'li");
    expect(describeProductFilter({})).toBe('');
  });
});

describe('HRV product filter', () => {
  const products = [
    { asin: 'B0HRV', highValue: true },
    { asin: 'B0LOW', highValue: false },
    { asin: 'B0UNK' },
  ];
  const rows = [
    { asin: 'b0hrv', lpn: 'LPNUIN1' },
    { asin: 'B0HRV' },
    { asin: 'B0LOW', lpn: 'LPNUIN2' },
    { asin: 'B0UNK' },
  ];

  it('collects the High Value ASINs', () => {
    expect([...highValueAsins(products)]).toEqual(['B0HRV']);
  });

  it('keeps only HRV rows, combined with the other filters', () => {
    const hrv = highValueAsins(products);
    expect(filterProductRecords(rows, { hrv: true }, hrv)).toEqual([rows[0], rows[1]]);
    expect(filterProductRecords(rows, { hrv: true, lpn: true }, hrv)).toEqual([rows[0]]);
    expect(filterProductRecords(rows, { hrv: true })).toEqual([]);
  });

  it('names the filter', () => {
    expect(describeProductFilter({ hrv: true })).toBe('HRV');
    expect(describeProductFilter({ lpn: true, hrv: true })).toBe("LPN'li + HRV");
  });
});

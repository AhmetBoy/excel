import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  columnsForKind,
  dedupeDropZoneDisplay,
  describeDataStatus,
  describePrep,
  describeSourceStatus,
  filterRows,
  reorderColumns,
} from '../shared/resultsView.js';

describe('describeDataStatus', () => {
  it('reports "Tam" when pandash and QT matching are both clean', () => {
    const row = { pandashStatus: 'found', qtMatchStatus: 'matched' };
    expect(describeDataStatus(row)).toBe('Tam');
  });

  it('surfaces an unresolved QT match instead of hiding it', () => {
    const row = { pandashStatus: 'found', qtMatchStatus: 'ambiguous' };
    expect(describeDataStatus(row)).toBe('QT: Eşleşme doğrulanamadı');
  });

  it('combines multiple warnings', () => {
    const row = { pandashStatus: 'not_in_response', qtMatchStatus: 'no_fcsku' };
    expect(describeDataStatus(row)).toBe('Pandash: Bulunamadı, QT: FCSku yok');
  });
});

describe('describePrep', () => {
  it('writes the instruction exactly as given', () => {
    expect(describePrep({ asin: 'B0A', prep: 'Torbalama' })).toBe('Torbalama');
  });

  it('shows "-" when no prep is set and "?" when it could not be read', () => {
    expect(describePrep({ asin: 'B0A', prep: '' })).toBe('-');
    expect(describePrep({ asin: 'B0A', prep: null })).toBe('?');
  });
});

describe('columnsForKind', () => {
  const keys = (kind) => columnsForKind(COLUMNS, kind).map((c) => c.key);

  it('drops the Görsel column when images are switched off', () => {
    expect(keys('container')[0]).toBe('image');
    const off = columnsForKind(COLUMNS, 'container', { showImages: false }).map((c) => c.key);
    expect(off).not.toContain('image');
    expect(off[0]).toBe('dropZone');
  });

  it('shows the Prep column for a product scan only', () => {
    expect(keys('product')).toContain('prep');
    expect(keys('container')).not.toContain('prep');
    expect(keys('location')).not.toContain('prep');
  });
});

describe('describeSourceStatus', () => {
  it('maps known statuses to Turkish labels', () => {
    expect(describeSourceStatus('ok')).toBe('Başarılı');
    expect(describeSourceStatus('auth_required')).toBe('Oturum gerekli');
    expect(describeSourceStatus('no_qt_tab')).toBe('QT sekmesi açık değil');
  });

  it('falls back to the raw status for unknown values rather than hiding it', () => {
    expect(describeSourceStatus('something_new')).toBe('something_new');
  });
});

describe('filterRows', () => {
  const rows = [
    { asin: 'B0A', fnSku: 'FNA', fcSku: 'FCA', owner: 'AMAZON_RETAIL', dropZone: 'NO_RESTRICTION', expirationDate: '01-JAN-2027' },
    { asin: 'B0B', fnSku: 'FNB', fcSku: 'FCB', owner: 'SELLER_X', dropZone: 'HAZMAT_RESTRICTED', expirationDate: '02-FEB-2027' },
  ];

  it('returns all rows for a blank query', () => {
    expect(filterRows(rows, '')).toHaveLength(2);
    expect(filterRows(rows, '   ')).toHaveLength(2);
  });

  it('filters case-insensitively across asin/sku/owner/dropZone/expirationDate', () => {
    expect(filterRows(rows, 'hazmat')).toEqual([rows[1]]);
    expect(filterRows(rows, 'b0a')).toEqual([rows[0]]);
    expect(filterRows(rows, 'seller')).toEqual([rows[1]]);
    expect(filterRows(rows, 'feb-2027')).toEqual([rows[1]]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterRows(rows, 'no-such-value')).toEqual([]);
  });
});

describe('dedupeDropZoneDisplay', () => {
  it('shows dropZone only on the first row sharing an FNSku, blanking later duplicates', () => {
    const rows = [
      { fnSku: 'FNA', dropZone: 'NO_RESTRICTION', quantity: '2' },
      { fnSku: 'FNA', dropZone: 'NO_RESTRICTION', quantity: '5' },
    ];
    const result = dedupeDropZoneDisplay(rows);

    expect(result[0].dropZone).toBe('NO_RESTRICTION');
    expect(result[1].dropZone).toBeNull();
    // underlying non-dropZone fields are untouched - rows are not merged
    expect(result[1].quantity).toBe('5');
  });

  it('does not touch rows with distinct FNSku values', () => {
    const rows = [
      { fnSku: 'FNA', dropZone: 'NO_RESTRICTION' },
      { fnSku: 'FNB', dropZone: 'HAZMAT_RESTRICTED' },
    ];
    const result = dedupeDropZoneDisplay(rows);

    expect(result[0].dropZone).toBe('NO_RESTRICTION');
    expect(result[1].dropZone).toBe('HAZMAT_RESTRICTED');
  });

  it('leaves rows without an FNSku (e.g. QT-only unmatched rows) untouched', () => {
    const rows = [{ fnSku: null, dropZone: null, title: 'Orphan' }];
    expect(dedupeDropZoneDisplay(rows)).toEqual(rows);
  });
});

describe('COLUMNS default order', () => {
  it('leads with the image, then DropZone, Consumer, Disposition as requested', () => {
    expect(COLUMNS.slice(0, 4).map((c) => c.key)).toEqual(['image', 'dropZone', 'consumer', 'disposition']);
  });
});

describe('reorderColumns', () => {
  it('returns the default COLUMNS order when nothing is stored', () => {
    expect(reorderColumns(null)).toBe(COLUMNS);
    expect(reorderColumns(undefined)).toBe(COLUMNS);
    expect(reorderColumns([])).toBe(COLUMNS);
  });

  it('applies a stored key order', () => {
    const result = reorderColumns(['image', 'asin', 'dropZone']);
    expect(result.slice(0, 3).map((c) => c.key)).toEqual(['image', 'asin', 'dropZone']);
  });

  it('keeps the image column where the user dragged it', () => {
    const result = reorderColumns(['asin', 'image']);
    expect(result.slice(0, 2).map((c) => c.key)).toEqual(['asin', 'image']);
  });

  it('puts the image column first when the saved order predates it, others at the end', () => {
    // An order saved before the Görsel column existed.
    const saved = COLUMNS.filter((c) => c.key !== 'image').map((c) => c.key).reverse();
    const result = reorderColumns(saved);
    expect(result[0].key).toBe('image');
    expect(result.slice(1).map((c) => c.key)).toEqual(saved);
  });

  it('ignores stored keys that no longer exist in COLUMNS', () => {
    const result = reorderColumns(['no_longer_exists', 'image', 'asin']);
    expect(result[1].key).toBe('asin');
    expect(result.some((c) => c.key === 'no_longer_exists')).toBe(false);
    expect(result).toHaveLength(COLUMNS.length);
  });
});

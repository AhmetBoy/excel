import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  dedupeDropZoneDisplay,
  describeDataStatus,
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
  it('leads with DropZone, Consumer, Disposition as requested', () => {
    expect(COLUMNS.slice(0, 3).map((c) => c.key)).toEqual(['dropZone', 'consumer', 'disposition']);
  });
});

describe('reorderColumns', () => {
  it('returns the default COLUMNS order when nothing is stored', () => {
    expect(reorderColumns(null)).toBe(COLUMNS);
    expect(reorderColumns(undefined)).toBe(COLUMNS);
    expect(reorderColumns([])).toBe(COLUMNS);
  });

  it('applies a stored key order', () => {
    const result = reorderColumns(['asin', 'dropZone']);
    expect(result[0].key).toBe('asin');
    expect(result[1].key).toBe('dropZone');
  });

  it('appends columns missing from the stored order at the end, in default order', () => {
    const result = reorderColumns(['title']);
    expect(result[0].key).toBe('title');
    // everything else keeps its relative default order after the one pinned column
    const remainingKeys = result.slice(1).map((c) => c.key);
    const defaultRemainingKeys = COLUMNS.filter((c) => c.key !== 'title').map((c) => c.key);
    expect(remainingKeys).toEqual(defaultRemainingKeys);
  });

  it('ignores stored keys that no longer exist in COLUMNS', () => {
    const result = reorderColumns(['no_longer_exists', 'asin']);
    expect(result[0].key).toBe('asin');
    expect(result.some((c) => c.key === 'no_longer_exists')).toBe(false);
    expect(result).toHaveLength(COLUMNS.length);
  });
});

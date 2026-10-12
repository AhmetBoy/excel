import { describe, expect, it } from 'vitest';
import { buildResultRows } from '../shared/matchingService.js';

function inv(overrides = {}) {
  return {
    container: 'TOT0001',
    asin: 'B0A',
    fnSku: 'FNA',
    lpn: 'LPNA',
    fcSku: null,
    title: 'Product A',
    quantity: '2',
    disposition: 'SELLABLE',
    consumer: 'AMAZON_RETAIL',
    ...overrides,
  };
}

describe('buildResultRows', () => {
  it('attaches pandash dropZone to the matching inventory record by ASIN', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [inv()],
      pandashMatches: [{ asin: 'B0A', dropZone: 'NO_RESTRICTION', status: 'found', matches: [] }],
      qtProducts: [],
    });

    expect(rows[0].dropZone).toBe('NO_RESTRICTION');
    expect(rows[0].pandashStatus).toBe('found');
  });

  it('surfaces an explicit status when pandash has no data for the ASIN', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [inv()],
      pandashMatches: [{ asin: 'B0A', dropZone: null, status: 'not_in_response', matches: [] }],
      qtProducts: [],
    });

    expect(rows[0].dropZone).toBeNull();
    expect(rows[0].pandashStatus).toBe('not_in_response');
  });

  it('matches QT data to inventory by FCSku and attaches owner/expirationDate', () => {
    const { rows, matchedQtCount } = buildResultRows({
      inventoryRecords: [inv({ fcSku: 'FC123' })],
      pandashMatches: [],
      qtProducts: [{ fcSku: 'FC123', title: 'Product A', quantity: '2', owner: 'AMAZON_RETAIL', expirationDate: '15-JAN-2027' }],
    });

    expect(rows[0].owner).toBe('AMAZON_RETAIL');
    expect(rows[0].expirationDate).toBe('15-JAN-2027');
    expect(rows[0].qtMatchStatus).toBe('matched');
    expect(matchedQtCount).toBe(1);
  });

  it('never attaches QT data via FNSku or ASIN - FCSku is the only valid key', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [inv({ fcSku: null, fnSku: 'FC123' })], // fnSku happens to equal a QT fcSku value
      pandashMatches: [],
      qtProducts: [{ fcSku: 'FC123', title: 'Product A', quantity: '2', owner: 'AMAZON_RETAIL', expirationDate: '15-JAN-2027' }],
    });

    expect(rows[0].qtMatchStatus).toBe('no_fcsku');
    expect(rows[0].owner).toBeNull();
    expect(rows[0].expirationDate).toBeNull();
  });

  it('flags ambiguous QT matches instead of guessing which one is correct', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [inv({ fcSku: 'FC123', title: 'Shared Title', quantity: '5' })],
      pandashMatches: [],
      qtProducts: [
        { fcSku: 'FC123', title: 'Different Title A', quantity: '1', owner: 'OWNER_A', expirationDate: '01-JAN-2027' },
        { fcSku: 'FC123', title: 'Different Title B', quantity: '9', owner: 'OWNER_B', expirationDate: '02-JAN-2027' },
      ],
    });

    expect(rows[0].qtMatchStatus).toBe('ambiguous');
    expect(rows[0].owner).toBeNull();
    expect(rows[0].expirationDate).toBeNull();
  });

  it('disambiguates multiple FCSku matches using title+quantity as a supporting signal', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [inv({ fcSku: 'FC123', title: 'Product A', quantity: '2' })],
      pandashMatches: [],
      qtProducts: [
        { fcSku: 'FC123', title: 'Product A', quantity: '2', owner: 'OWNER_MATCH', expirationDate: '03-MAR-2027' },
        { fcSku: 'FC123', title: 'Unrelated', quantity: '9', owner: 'OWNER_OTHER', expirationDate: '04-APR-2027' },
      ],
    });

    expect(rows[0].qtMatchStatus).toBe('matched');
    expect(rows[0].owner).toBe('OWNER_MATCH');
  });

  it('surfaces a QT product that matches no inventory record as its own row', () => {
    const { rows, matchedQtCount, totalQtCount } = buildResultRows({
      inventoryRecords: [inv({ fcSku: 'FC_NOT_PRESENT_IN_QT' })],
      pandashMatches: [],
      qtProducts: [{ fcSku: 'FC_ORPHAN', title: 'Orphan Product', quantity: '1', owner: 'OWNER_X', expirationDate: '05-MAY-2027' }],
    });

    const orphanRow = rows.find((r) => r.qtMatchStatus === 'qt_only_unmatched');
    expect(orphanRow).toMatchObject({ title: 'Orphan Product', fcSku: 'FC_ORPHAN', asin: null, container: null });
    expect(matchedQtCount).toBe(0);
    expect(totalQtCount).toBe(1);
  });

  it('preserves multiple inventory records for the same tote as separate rows', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [inv({ asin: 'B0A' }), inv({ asin: 'B0B', fnSku: 'FNB', lpn: 'LPNB' })],
      pandashMatches: [],
      qtProducts: [],
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.asin)).toEqual(['B0A', 'B0B']);
  });
});

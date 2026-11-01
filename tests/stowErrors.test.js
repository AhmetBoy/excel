import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInventoryHistoryHtml } from '../shared/parsers/inventoryHistoryParser.js';
import { analyzeStowErrors, buildHistoryDateFields, systemQuantityInBin } from '../shared/stowErrors.js';

// Live FC Research history of tote tsXSA903033, associate logins anonymized
// (stowerk = the associate with the PROBLEM_SOLVE stows into P-1-A208C141).
const fixture = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'inventory-history-tote.html'),
  'utf-8'
);
const TOTE = 'tsXSA903033';

describe('parseInventoryHistoryHtml', () => {
  const { found, records, paginationToken } = parseInventoryHistoryHtml(fixture);

  it('reads every row with header-id based columns', () => {
    expect(found).toBe(true);
    expect(records).toHaveLength(172);
    expect(paginationToken).toBe('true');
    expect(records[0]).toMatchObject({
      date: '2026-10-30 05:35:42',
      time: '2026-10-30T02:35:42.000Z',
      op: 'M',
      asin: 'B0DR8NVQ77',
      fnSku: 'X0028RVVOZ',
      quantity: 6,
      oldBin: 'ws-rcv-04-05',
      newBin: TOTE,
      oldOwner: 'inventory',
      newOwner: 'inventory',
      tool: 'FCReceiveWebUIWebsi',
    });
  });

  it('keeps the "A" (created) PROBLEM_SOLVE rows with an empty New Bin', () => {
    const created = records.filter((r) => r.op === 'A');
    expect(created).toHaveLength(3);
    expect(created.every((r) => r.newBin === null && r.newOwner === 'PROBLEM_SOLVE')).toBe(true);
  });
});

describe('analyzeStowErrors', () => {
  const { records } = parseInventoryHistoryHtml(fixture);

  it('counts failed vs successful stows per bin + FNSku for one associate', () => {
    const result = analyzeStowErrors(records, { container: TOTE, person: 'stowerk' });

    expect(result.groups).toEqual([
      {
        bin: 'P-1-A208C141',
        fnSku: 'B07YBCJBG2',
        asin: 'B07YBCJBG2',
        failed: 2,
        succeeded: 11,
        toPick: 2,
        lastFailedAt: '2026-10-29 01:03:03',
      },
    ]);
    expect(result.totalToPick).toBe(2);
    expect(result.otherPeopleFailed).toBe(1); // stowera's P-1-C202C112 error
  });

  it('includes every associate when no person is given', () => {
    const result = analyzeStowErrors(records, { container: TOTE });

    expect(result.groups.map((g) => [g.bin, g.failed, g.succeeded])).toEqual([
      ['P-1-A208C141', 2, 11],
      ['P-1-C202C112', 1, 3],
    ]);
    expect(result.totalToPick).toBe(3);
  });

  it('ignores rows that did not leave this container', () => {
    const result = analyzeStowErrors(records, { container: 'tsXOTHER' });
    expect(result.groups).toEqual([]);
  });

  it('uses the Quantity column for the unit count', () => {
    const row = {
      op: 'M', oldBin: TOTE, newBin: 'P-1-X1', fnSku: 'F1', person: 'a',
      oldOwner: 'PROBLEM_SOLVE', newOwner: 'PROBLEM_SOLVE', quantity: 3,
    };
    expect(analyzeStowErrors([row], { container: TOTE }).totalToPick).toBe(3);
  });
});

describe('buildHistoryDateFields', () => {
  it('requests yesterday through today in MM/dd/yyyy', () => {
    expect(buildHistoryDateFields(new Date(2026, 10, 1, 1, 30))).toEqual({
      startSearchDateString: '10/31/2026',
      endSearchDateString: '11/01/2026',
      dateStringFormat: 'MM/dd/yyyy',
    });
  });
});

describe('systemQuantityInBin', () => {
  const binRecords = [
    { fnSku: 'B07YBCJBG2', asin: 'B07YBCJBG2', quantity: '5', consumer: 'UNOWNED' },
    { fnSku: 'B07YBCJBG2', asin: 'B07YBCJBG2', quantity: '2', consumer: 'UNOWNED' },
    { fnSku: 'X00OTHER', asin: 'B0OTHER', quantity: '9', consumer: 'UNOWNED' },
    { fnSku: 'B07YBCJBG2', asin: 'B07YBCJBG2', quantity: '3', consumer: 'PROBLEM_SOLVE' },
  ];

  it('sums the product in the bin, leaving out PROBLEM_SOLVE rows', () => {
    expect(systemQuantityInBin(binRecords, { fnSku: 'B07YBCJBG2', asin: 'B07YBCJBG2' })).toBe(7);
  });

  it('matches by ASIN when the FNSku differs', () => {
    expect(systemQuantityInBin(binRecords, { fnSku: 'X00NOPE', asin: 'B0OTHER' })).toBe(9);
  });

  it('is 0 for an empty bin', () => {
    expect(systemQuantityInBin([], { fnSku: 'B07YBCJBG2' })).toBe(0);
  });
});

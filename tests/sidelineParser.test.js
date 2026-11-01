import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSidelineResponse } from '../shared/parsers/sidelineParser.js';
import { buildResultRows } from '../shared/matchingService.js';

// Live /api/scanitem response for ASIN B0GRHHB2NG.
const fixture = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sideline-scanitem.json'), 'utf-8');

describe('parseSidelineResponse', () => {
  it('reads binDescription of the scanned item', () => {
    expect(parseSidelineResponse(fixture, 'B0GRHHB2NG')).toEqual({
      valid: true,
      found: true,
      binDescription: 'Cekmece Yavas Grocery',
    });
  });

  it('picks the item matching the barcode when there are several', () => {
    const text = JSON.stringify({
      items: [
        { scannableId: 'B0AAA', binDescription: 'Raf A' },
        { scannableId: 'X00B', skuDetail: { asin: 'B0BBB', fnSku: 'X00B' }, binDescription: 'Raf B' },
      ],
    });
    expect(parseSidelineResponse(text, 'b0bbb').binDescription).toBe('Raf B');
  });

  it('reports not found when there are no items', () => {
    expect(parseSidelineResponse('{"success":false,"items":[]}', 'B0X')).toEqual({
      valid: true,
      found: false,
      binDescription: null,
    });
  });

  it('flags a non-JSON body (e.g. a login page) as invalid', () => {
    expect(parseSidelineResponse('<html>Sign in</html>', 'B0X').valid).toBe(false);
  });
});

describe('buildResultRows with Sideline', () => {
  it('adds binDescription to the row by ASIN', () => {
    const { rows } = buildResultRows({
      inventoryRecords: [{ asin: 'B0GRHHB2NG', fnSku: 'B0GRHHB2NG', quantity: '2' }],
      sidelineMatches: [{ asin: 'b0grhhb2ng', binDescription: 'Cekmece Yavas Grocery', status: 'ok' }],
    });
    expect(rows[0].binDescription).toBe('Cekmece Yavas Grocery');
  });
});

import { describe, expect, it } from 'vitest';
import { stowsForProduct, stowsIntoLocation } from '../shared/locationStows.js';

const row = (overrides) => ({
  time: '2026-11-02T08:30:00.000Z',
  op: 'M',
  asin: 'B0CV7PGS46',
  fnSku: 'X002J1RFBD',
  quantity: 2,
  person: 'stowera',
  oldBin: 'tsX1',
  newBin: 'P-1-A200A100',
  oldOwner: 'inventory',
  newOwner: 'inventory',
  ...overrides,
});

describe('stowsIntoLocation', () => {
  it('lists stows into the bin by ASIN, newest first, with shift', () => {
    const map = stowsIntoLocation(
      [
        row({ person: 'old', time: '2026-11-01T08:00:00.000Z' }),
        row({ person: 'new' }),
        row({ newBin: 'P-1-B000', person: 'elsewhere' }),
        row({ oldBin: 'P-1-A200A100', newBin: 'tsX9', person: 'picker' }),
      ],
      'p-1-a200a100'
    );
    const events = stowsForProduct(map, { asin: 'b0cv7pgs46' });
    expect(events.map((e) => e.person)).toEqual(['new', 'old']);
    expect(events[0]).toMatchObject({ quantity: 2, failed: false });
    expect(events[0].shift).toMatch(/\d\d:00-\d\d:00/);
  });

  it('flags PROBLEM_SOLVE stows as failed', () => {
    const map = stowsIntoLocation(
      [row({ oldOwner: 'PROBLEM_SOLVE', newOwner: 'PROBLEM_SOLVE' })],
      'P-1-A200A100'
    );
    expect(stowsForProduct(map, { asin: 'B0CV7PGS46' })[0].failed).toBe(true);
  });

  it('falls back to FNSku when the row has no ASIN', () => {
    const map = stowsIntoLocation([row({ asin: null })], 'P-1-A200A100');
    expect(stowsForProduct(map, { asin: 'B0CV7PGS46', fnSku: 'X002J1RFBD' })).toHaveLength(1);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInventoryHistoryHtml } from '../shared/parsers/inventoryHistoryParser.js';
import { extractStows, findIdleGaps, formatAgo, formatDuration } from '../shared/stowActivity.js';

// Live Inventory History searched by login (stowerx, anonymized):
// 198 successful stows + one failed stow (A row + M row).
const fixture = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'inventory-history-user.html'),
  'utf-8'
);
const { records } = parseInventoryHistoryHtml(fixture);

const MIN = 60_000;
const at = (minutes) => ({ timeMs: minutes * MIN });

describe('extractStows', () => {
  it('counts every M move into a bin, failed ones included, newest first', () => {
    const stows = extractStows(records, 'stowerx');
    expect(stows).toHaveLength(199);
    expect(stows[0]).toMatchObject({
      time: '2026-10-31T00:07:34.000Z',
      bin: 'P-4-A219B151',
      tote: 'csXhehhn7w9',
      asin: 'B0C4YNBJ9N',
      failed: false,
    });
    expect(stows.filter((s) => s.failed)).toHaveLength(1);
    for (let i = 1; i < stows.length; i++) expect(stows[i - 1].timeMs).toBeGreaterThanOrEqual(stows[i].timeMs);
  });

  it('skips other people, A rows and moves into containers', () => {
    const base = { op: 'M', time: '2026-11-07T10:00:00.000Z', asin: 'B0X', oldBin: 'tsX1', newBin: 'P-1-A1', person: 'me' };
    const result = extractStows(
      [
        base,
        { ...base, person: 'other' },
        { ...base, op: 'A' },
        { ...base, newBin: 'csXabc' },
        { ...base, newBin: null },
        { ...base, asin: null, fnSku: null },
      ],
      'ME'
    );
    expect(result).toHaveLength(1);
  });
});

describe('findIdleGaps', () => {
  const range = { fromMs: 0, toMs: 120 * MIN };

  it('finds shift-start, between and ongoing gaps above the threshold', () => {
    const gaps = findIdleGaps([at(15), at(18), at(50), at(52), at(95)], { ...range, minMinutes: 10 });
    expect(gaps).toEqual([
      { startMs: 0, endMs: 15 * MIN, minutes: 15, kind: 'start' },
      { startMs: 18 * MIN, endMs: 50 * MIN, minutes: 32, kind: 'between' },
      { startMs: 52 * MIN, endMs: 95 * MIN, minutes: 43, kind: 'between' },
      { startMs: 95 * MIN, endMs: 120 * MIN, minutes: 25, kind: 'ongoing' },
    ]);
  });

  it('applies the chosen threshold', () => {
    const gaps = findIdleGaps([at(15), at(18), at(50), at(52), at(95)], { ...range, minMinutes: 30 });
    expect(gaps.map((g) => g.minutes)).toEqual([32, 43]);
  });

  it('ignores stows outside the range and reports a shift with none', () => {
    expect(findIdleGaps([at(-30), at(200)], { ...range, minMinutes: 10 })).toEqual([
      { startMs: 0, endMs: 120 * MIN, minutes: 120, kind: 'none' },
    ]);
  });
});

describe('formatting', () => {
  it('formats durations and relative times', () => {
    expect(formatDuration(7)).toBe('7 dk');
    expect(formatDuration(75)).toBe('1 sa 15 dk');
    expect(formatDuration(120)).toBe('2 sa');
    expect(formatAgo(0, 30_000)).toBe('az önce');
    expect(formatAgo(0, 12 * MIN + 5_000)).toBe('12 dk önce');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInventoryHistoryHtml } from '../shared/parsers/inventoryHistoryParser.js';
import {
  buildNotifications,
  daysSince,
  extractFailedStows,
  groupEvents,
  mergeEvents,
  pruneEvents,
  reachedCutoff,
  RETENTION_MS,
  scanCutoffMs,
  SCAN_OVERLAP_MS,
  setResolved,
  summarizeByUser,
} from '../shared/rozetWatch.js';

// Live FC Research Inventory History searched by an associate login
// (stowerx, anonymized). One failed stow: B084XSSX5Y from csXheg3rwjb into
// P-4-A220C202, written as an "A" row plus an "M" row.
const fixture = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'inventory-history-user.html'),
  'utf-8'
);
const { records, paginationToken } = parseInventoryHistoryHtml(fixture);

const event = (overrides = {}) => ({
  id: overrides.id ?? Math.random().toString(36),
  login: 'stowerx',
  time: '2026-11-06T10:00:00.000Z',
  tote: 'tsX1',
  bin: 'P-1-A100A100',
  asin: 'B0AAA',
  fnSku: 'X0AAA',
  quantity: 1,
  resolvedAt: null,
  ...overrides,
});

describe('login history page', () => {
  it('is a 200-row page with a JSON token for the next page', () => {
    expect(records).toHaveLength(200);
    expect(paginationToken).toContain('hasNext');
    expect(paginationToken).not.toMatch(/^true/);
  });
});

describe('extractFailedStows', () => {
  it('counts the M row only, not the matching A row', () => {
    const events = extractFailedStows(records, 'stowerx');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      login: 'stowerx',
      time: '2026-10-30T22:24:30.000Z',
      tote: 'csXheg3rwjb',
      bin: 'P-4-A220C202',
      asin: 'B084XSSX5Y',
      quantity: 1,
      resolvedAt: null,
    });
  });

  it('ignores rows of other people', () => {
    expect(extractFailedStows(records, 'someoneelse')).toHaveLength(0);
  });

  it('gives identical rows their own stable ids', () => {
    const row = records.find((r) => r.op === 'M' && r.newOwner === 'PROBLEM_SOLVE');
    const first = extractFailedStows([row, row], 'stowerx');
    const again = extractFailedStows([row, row], 'stowerx');
    expect(new Set(first.map((e) => e.id)).size).toBe(2);
    expect(again.map((e) => e.id)).toEqual(first.map((e) => e.id));
  });
});

describe('mergeEvents / pruneEvents / setResolved', () => {
  it('adds only unseen ids and keeps the resolved state', () => {
    const stored = [event({ id: 'a', resolvedAt: '2026-11-06T11:00:00.000Z' })];
    const { events, added } = mergeEvents(stored, [event({ id: 'a' }), event({ id: 'b' })]);
    expect(added.map((e) => e.id)).toEqual(['b']);
    expect(events.find((e) => e.id === 'a').resolvedAt).toBe('2026-11-06T11:00:00.000Z');
  });

  it('drops events older than two days', () => {
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    const old = event({ id: 'old', time: new Date(now - RETENTION_MS - 1000).toISOString() });
    const fresh = event({ id: 'fresh', time: new Date(now - 1000).toISOString() });
    expect(pruneEvents([old, fresh], now).map((e) => e.id)).toEqual(['fresh']);
  });

  it('marks and unmarks resolved', () => {
    const marked = setResolved([event({ id: 'a' }), event({ id: 'b' })], ['a'], 'T');
    expect(marked.map((e) => e.resolvedAt)).toEqual(['T', null]);
    expect(setResolved(marked, ['a'], null)[0].resolvedAt).toBeNull();
  });
});

describe('scan window', () => {
  it('starts at the current shift on the first scan', () => {
    const now = new Date(2026, 10, 2, 10, 30); // Monday 10:30 -> 07:00 shift
    expect(scanCutoffMs(null, now)).toBe(new Date(2026, 10, 2, 7, 0).getTime());
  });

  it('starts a bit before the newest row seen last time', () => {
    const now = new Date(2026, 10, 2, 10, 30);
    const watermark = new Date(2026, 10, 2, 10, 0);
    expect(scanCutoffMs(watermark.toISOString(), now)).toBe(watermark.getTime() - SCAN_OVERLAP_MS);
  });

  it('never goes further back than the retention window', () => {
    const now = new Date(2026, 10, 6, 10, 0);
    expect(scanCutoffMs(new Date(2026, 9, 1).toISOString(), now)).toBe(now.getTime() - RETENTION_MS);
  });

  it('counts calendar days for the date fields', () => {
    const now = new Date(2026, 10, 3, 2, 0);
    expect(daysSince(new Date(2026, 10, 2, 23, 0).getTime(), now)).toBe(2);
    expect(daysSince(new Date(2026, 10, 3, 1, 0).getTime(), now)).toBe(1);
  });

  it('stops paging once a page reaches past the cutoff', () => {
    const oldest = Date.parse(records.at(-1).time);
    expect(reachedCutoff(records, oldest + 1)).toBe(true);
    expect(reachedCutoff(records, oldest)).toBe(false);
  });
});

describe('groupEvents / summarizeByUser', () => {
  const rozetGroup = [1, 2, 3, 4, 5].map((n) =>
    event({ id: `r${n}`, tote: 'tsXR', bin: `P-1-B${n}`, resolvedAt: 'T' })
  );
  const openGroup = [
    event({ id: 'o1', tote: 'tsXO', asin: 'B0BBB', fnSku: 'X0BBB' }),
    event({ id: 'o2', tote: 'tsXO', asin: 'B0BBB', fnSku: 'X0BBB', resolvedAt: 'T' }),
  ];

  it('groups per tote + product and flags 5 or more as rozet', () => {
    const groups = groupEvents([...rozetGroup, ...openGroup]);
    const rozet = groups.find((g) => g.tote === 'tsXR');
    const open = groups.find((g) => g.tote === 'tsXO');
    expect(rozet).toMatchObject({ count: 5, openCount: 0, rozet: true, resolved: true });
    expect(open).toMatchObject({ count: 2, openCount: 1, rozet: false, resolved: false });
  });

  it('reports failed / open / resolved / rozet per user, listed users included', () => {
    const { rows, total } = summarizeByUser([...rozetGroup, ...openGroup], [
      { login: 'stowerx', name: 'Stower X' },
      { login: 'clean', name: null },
    ]);
    expect(rows[0]).toMatchObject({
      login: 'stowerx',
      name: 'Stower X',
      failed: 7,
      open: 1,
      resolved: 6,
      rozet: 1,
      rozetResolved: 1,
    });
    expect(rows[1]).toMatchObject({ login: 'clean', failed: 0, rozet: 0 });
    expect(total).toEqual({ failed: 7, open: 1, resolved: 6, rozet: 1, rozetResolved: 1 });
  });
});

describe('buildNotifications', () => {
  it('writes one notification per user with x/5 per tote + product', () => {
    const stored = [event({ id: 'a', bin: 'P-1-A1' }), event({ id: 'b', bin: 'P-1-A2' })];
    const [note] = buildNotifications([stored[1]], stored, [{ login: 'stowerx', name: 'Ali' }]);
    expect(note.title).toBe('Hatalı stow: Ali (stowerx) - 1 adet');
    expect(note.message).toBe('tsX1 · B0AAA → P-1-A2 (2/5)');
  });

  it('tags a group that reached the limit', () => {
    const stored = [1, 2, 3, 4, 5].map((n) => event({ id: `e${n}` }));
    const [note] = buildNotifications(stored.slice(4), stored);
    expect(note.message).toMatch(/\(5\/5\) ROZET$/);
  });
});

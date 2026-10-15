import { describe, expect, it } from 'vitest';
import {
  buildHourlySlots,
  buildStowTable,
  formatSlotLabel,
  parseUserList,
} from '../shared/stowReportTable.js';

const row = (login, opportunities, managerId = 'mgr') => ({ login, managerId, opportunities });

describe('buildHourlySlots', () => {
  it('splits 15:00-23:00 into eight one-hour slots', () => {
    const start = new Date('2026-10-14T15:00').getTime() / 1000;
    const slots = buildHourlySlots({ startTime: start, endTime: start + 8 * 3600 });
    expect(slots).toHaveLength(8);
    expect(slots[0]).toEqual({ startTime: start, endTime: start + 3600 });
    expect(formatSlotLabel(slots[0])).toBe('15:00-16:00');
    expect(formatSlotLabel(slots[7])).toBe('22:00-23:00');
  });

  it('makes the last slot shorter when the range ends mid-hour', () => {
    const slots = buildHourlySlots({ startTime: 0, endTime: 2.5 * 3600 });
    expect(slots).toHaveLength(3);
    expect(slots[2]).toEqual({ startTime: 7200, endTime: 9000 });
  });
});

describe('parseUserList', () => {
  it('accepts newline/comma/space separated logins, case-insensitive and deduped', () => {
    expect(parseUserList('colfatma\nSSEAHMET, aslandot  colfatma;\n\n')).toEqual([
      'colfatma',
      'sseahmet',
      'aslandot',
    ]);
    expect(parseUserList('')).toEqual([]);
  });
});

describe('buildStowTable', () => {
  const slotRows = [
    [row('a', 10), row('b', 30)],
    [row('a', 50), row('c', 5)],
  ];

  it('pivots slots into per-user values with row, column and grand totals', () => {
    const table = buildStowTable(slotRows);
    expect(table.rows.map((r) => [r.login, r.values, r.total])).toEqual([
      ['a', [10, 50], 60],
      ['b', [30, 0], 30],
      ['c', [0, 5], 5],
    ]);
    expect(table.columnTotals).toEqual([40, 55]);
    expect(table.grandTotal).toBe(95);
  });

  it('reports the top value per hour and overall for highlighting', () => {
    const table = buildStowTable(slotRows);
    expect(table.columnMax).toEqual([30, 50]);
    expect(table.totalMax).toBe(60);
  });

  it('only includes the given users, with zeros for users who had no stows', () => {
    const table = buildStowTable(slotRows, { users: ['b', 'zz'] });
    expect(table.rows.map((r) => [r.login, r.values, r.total])).toEqual([
      ['b', [30, 0], 30],
      ['zz', [0, 0], 0],
    ]);
    expect(table.grandTotal).toBe(30);
  });

  it('matches the user list case-insensitively', () => {
    const table = buildStowTable([[row('ColFatma', 7)]], { users: ['colfatma'] });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].total).toBe(7);
  });

  it('returns zero maxima for an empty report so nothing is highlighted', () => {
    const table = buildStowTable([[], []]);
    expect(table).toMatchObject({ rows: [], columnMax: [0, 0], totalMax: 0, grandTotal: 0 });
  });
});

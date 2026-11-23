import { describe, expect, it } from 'vitest';
import { fetchHistoryByDay, recentDays, singleDayDateFields } from '../shared/historyByDay.js';

describe('singleDayDateFields / recentDays', () => {
  it('sends the same day as start and end', () => {
    expect(singleDayDateFields(new Date(2026, 10, 11, 15))).toEqual({
      startSearchDateString: '11/11/2026',
      endSearchDateString: '11/11/2026',
      dateStringFormat: 'MM/dd/yyyy',
    });
  });

  it('lists days newest first, across a month boundary', () => {
    expect(recentDays(new Date(2026, 11, 1, 2), 2).map((d) => d.getDate())).toEqual([1, 30]);
  });
});

describe('fetchHistoryByDay', () => {
  const now = new Date(2026, 10, 11, 1, 0);
  const pages = {
    '11/11/2026': { status: 'ok', items: [{ time: '2026-11-10T22:30:00.000Z' }] },
    '11/10/2026': { status: 'ok', items: [{ time: '2026-11-10T20:10:00.000Z' }] },
  };
  const fake = (calls) => async (section, fields) => {
    calls.push(fields);
    return pages[fields.startSearchDateString] ?? { status: 'no_data', items: [] };
  };

  it('asks one day at a time, today first, and merges the rows', async () => {
    const calls = [];
    const result = await fetchHistoryByDay(fake(calls), { s: 'login', now, days: 2 });
    expect(calls.map((f) => [f.startSearchDateString, f.endSearchDateString])).toEqual([
      ['11/11/2026', '11/11/2026'],
      ['11/10/2026', '11/10/2026'],
    ]);
    expect(result).toEqual({ status: 'ok', items: [pages['11/11/2026'].items[0], pages['11/10/2026'].items[0]] });
  });

  it('reads every page of a day even when stopAfter is already met', async () => {
    // FC Research pages run forward in time: the newest rows are on the last page.
    const calls = [];
    const fetcher = async (section, fields, parseType, listKey, options) => {
      calls.push(options);
      return { status: 'ok', items: [{ time: '2026-11-11T05:00:00.000Z' }] };
    };
    await fetchHistoryByDay(fetcher, { s: 'login', now, days: 2, stopAfter: () => true });
    expect(calls).toEqual([{ maxPages: 40 }]); // no per-page stop handed to the pager
  });

  it('skips older days once stopAfter is satisfied', async () => {
    const calls = [];
    await fetchHistoryByDay(fake(calls), { s: 'login', now, days: 2, stopAfter: (items) => items.length > 0 });
    expect(calls).toHaveLength(1);
  });

  it('reports a partial failure when one day fails', async () => {
    const result = await fetchHistoryByDay(
      async (s, fields) =>
        fields.startSearchDateString === '11/11/2026' ? { status: 'http_error', items: [] } : pages['11/10/2026'],
      { s: 'login', now, days: 2 }
    );
    expect(result.status).toBe('partial_failure');
  });
});

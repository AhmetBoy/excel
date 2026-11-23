// FC Research Inventory History returns wrong (older) rows when the date
// range spans more than one day (seen live 2026-11-11 for a login search:
// the last stow came back ~26 h old). A range with start = end = one day
// is correct, so multi-day history is fetched one day at a time, today
// first.
//
// Paging order (seen 2026-11-23 in a saved login search): FC Research hands
// out the range in time order from its START, 200 rows per page, and sorts
// only each page newest-first. Page 1 of "today" is therefore the first 200
// rows after midnight, and the newest rows are on the LAST page. A day must
// be read to its end; stopping after a page that "looks old enough" returns
// rows hours behind (the last stow was shown ~4 h old).

function formatMmDdYyyy(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

/** Date fields for one calendar day (start = end). */
export function singleDayDateFields(day) {
  const value = formatMmDdYyyy(day);
  return { startSearchDateString: value, endSearchDateString: value, dateStringFormat: 'MM/dd/yyyy' };
}

/** `days` calendar days ending today, newest first. */
export function recentDays(now = new Date(), days = 1) {
  return Array.from(
    { length: Math.max(1, days) },
    (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
  );
}

const EMPTY = new Set(['no_data', 'not_found']);

// A busy associate writes ~2000 rows a day (200 rows ≈ 2 h 20 min seen).
export const HISTORY_DAY_MAX_PAGES = 40;

/**
 * Reads each day's history to its last page (today first) and merges the
 * rows; their order is not newest-first, sort by time where it matters.
 * `stopAfter(items)` sees all rows so far and, after a full day, decides
 * whether older days are needed. It never cuts a day short (see above).
 *
 * @param {(section: string, fields: object, parseType: string, listKey: string, options?: object) =>
 *   Promise<{ status: string, items: object[] }>} fetchPagedSection
 * @param {{ s: string, now?: Date, days: number, stopAfter?: (items: object[]) => boolean }} options
 * @returns {Promise<{ status: string, items: object[] }>}
 */
export async function fetchHistoryByDay(fetchPagedSection, { s, now = new Date(), days, stopAfter }) {
  const items = [];
  const statuses = [];
  for (const day of recentDays(now, days)) {
    const result = await fetchPagedSection(
      'inventory-history',
      { s, ...singleDayDateFields(day) },
      'PARSE_INVENTORY_HISTORY_HTML',
      'records',
      { maxPages: HISTORY_DAY_MAX_PAGES }
    );
    items.push(...result.items);
    statuses.push(result.status);
    if (stopAfter?.(items)) break;
  }

  const failed = statuses.filter((st) => st !== 'ok' && !EMPTY.has(st));
  let status;
  if (failed.length === statuses.length) status = failed[0];
  else if (failed.length > 0) status = 'partial_failure';
  else if (items.length > 0) status = 'ok';
  else status = statuses.includes('no_data') ? 'no_data' : 'not_found';
  return { status, items };
}

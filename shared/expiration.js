// SKT (Expiration Date) rules for the dates QT's "View Datelot Items" shows.

/** A date within this many calendar months from today counts as "near". */
export const NEAR_EXPIRY_MONTHS = 3;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  // Turkish, in case QT is shown in tr-TR
  oca: 0, şub: 1, sub: 1, nis: 3, haz: 5, tem: 6, ağu: 7, agu: 7, eyl: 8, eki: 9, kas: 10, ara: 11,
};

// QT shows a dated item with no SKT as an empty value or a word like "None".
const MISSING_VALUES = new Set(['', 'NONE', 'NULL', 'N/A', 'NA', '-', '—']);

function utcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  // Rejects overflow like "Feb 31".
  return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}

/**
 * Parses a QT expiration date. Seen live: "Apr 10 2029". Also accepted:
 * "10-APR-2029", "2029-04-10", "10.04.2029" / "10/04/2029" (day first).
 * @param {string|null|undefined} text
 * @returns {Date|null} midnight UTC of that day, null when not a date
 */
export function parseExpirationDate(text) {
  const value = (text ?? '').trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^([a-zçğıöşü]{3})[a-zçğıöşü]*\.? (\d{1,2}) (\d{4})$/.exec(value);
  if (m && m[1] in MONTHS) return utcDate(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  m = /^(\d{1,2})[- ]([a-zçğıöşü]{3})[a-zçğıöşü]*[- ](\d{4})$/.exec(value);
  if (m && m[2] in MONTHS) return utcDate(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
  if (m) return utcDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/**
 * @param {string|null|undefined} text - expirationDate from QT
 * @param {Date} [now]
 * @returns {'missing'|'expired'|'near'|'ok'|'unreadable'}
 *   expired = before today; near = today .. today + NEAR_EXPIRY_MONTHS (inclusive)
 */
export function classifyExpiration(text, now = new Date()) {
  if (MISSING_VALUES.has((text ?? '').trim().toUpperCase())) return 'missing';
  const date = parseExpirationDate(text);
  if (!date) return 'unreadable';

  const today = utcDate(now.getFullYear(), now.getMonth(), now.getDate());
  if (date < today) return 'expired';
  const limit = new Date(today);
  limit.setUTCMonth(limit.getUTCMonth() + NEAR_EXPIRY_MONTHS);
  // e.g. Nov 30 + 3 months overflows to Mar 2: clamp to the month's last day.
  if (limit.getUTCDate() !== today.getUTCDate()) limit.setUTCDate(0);
  return date <= limit ? 'near' : 'ok';
}

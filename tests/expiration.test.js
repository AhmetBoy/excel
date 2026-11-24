import { describe, expect, it } from 'vitest';
import { classifyExpiration, formatExpirationDate, parseExpirationDate } from '../shared/expiration.js';

const NOW = new Date(2026, 10, 19); // 19 Nov 2026, local time

describe('parseExpirationDate', () => {
  it('reads the format QT shows ("Apr 10 2029")', () => {
    expect(parseExpirationDate('Apr 10 2029')?.toISOString().slice(0, 10)).toBe('2029-04-10');
  });

  it('accepts other common formats', () => {
    for (const text of ['10-APR-2029', '2029-04-10', '10.04.2029', '10/04/2029', 'April 10, 2029', 'Nis 10 2029']) {
      expect(parseExpirationDate(text)?.toISOString().slice(0, 10)).toBe('2029-04-10');
    }
  });

  it('rejects non-dates and impossible days', () => {
    expect(parseExpirationDate('Feb 31 2029')).toBeNull();
    expect(parseExpirationDate('soon')).toBeNull();
  });
});

describe('classifyExpiration', () => {
  it('treats empty / None as missing', () => {
    for (const text of [null, '', 'None', ' none ', '-']) expect(classifyExpiration(text, NOW)).toBe('missing');
  });

  it('expired = before today, today itself is near', () => {
    expect(classifyExpiration('Nov 18 2026', NOW)).toBe('expired');
    expect(classifyExpiration('Nov 19 2026', NOW)).toBe('near');
  });

  it('near = up to and including 3 months from today', () => {
    expect(classifyExpiration('Feb 19 2027', NOW)).toBe('near');
    expect(classifyExpiration('Feb 20 2027', NOW)).toBe('ok');
    expect(classifyExpiration('Apr 10 2029', NOW)).toBe('ok');
  });

  it('clamps month-end overflow (Nov 30 + 3 months = Feb 28)', () => {
    const now = new Date(2026, 10, 30);
    expect(classifyExpiration('Feb 28 2027', now)).toBe('near');
    expect(classifyExpiration('Mar 1 2027', now)).toBe('ok');
  });

  it('flags text that is not a date', () => {
    expect(classifyExpiration('soon', NOW)).toBe('unreadable');
  });
});

describe('parseExpirationDate timestamps (FC Research)', () => {
  const day = (d) => d?.toISOString().slice(0, 10);
  it('keeps the day of date-time values', () => {
    expect(day(parseExpirationDate('2027-03-15 00:00:00'))).toBe('2027-03-15');
    expect(day(parseExpirationDate('2027-03-15T00:00:00Z'))).toBe('2027-03-15');
    expect(day(parseExpirationDate('2027-03-15T00:00:00.000+03:00'))).toBe('2027-03-15');
  });
  it('reads the live FC Research value as the Istanbul day', () => {
    // 21:00Z is 00:00 the next day in Istanbul (UTC+3).
    expect(day(parseExpirationDate('2029-04-16T21:00:00.000Z'))).toBe('2029-04-17');
    expect(formatExpirationDate('2029-04-16T21:00:00.000Z')).toBe('Apr 17 2029');
    expect(formatExpirationDate('Apr 10 2029')).toBe('Apr 10 2029');
    expect(formatExpirationDate('None')).toBe('None');
  });

  it('reads epoch seconds and milliseconds', () => {
    expect(day(parseExpirationDate('1805068800'))).toBe('2027-03-15');
    expect(day(parseExpirationDate('1805068800000'))).toBe('2027-03-15');
  });
});

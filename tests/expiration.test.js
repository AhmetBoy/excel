import { describe, expect, it } from 'vitest';
import { classifyExpiration, parseExpirationDate } from '../shared/expiration.js';

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

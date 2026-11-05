import { describe, expect, it } from 'vitest';
import { shiftOf } from '../shared/shifts.js';

// 2026-11-02 is a Monday, 2026-11-06 a Friday.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m);

describe('shiftOf', () => {
  it('uses 8-hour shifts Monday to Thursday', () => {
    expect(shiftOf(at(2, 7))).toMatchObject({ name: 'Sabah', range: '07:00-15:00', day: 'Pazartesi' });
    expect(shiftOf(at(2, 14, 59)).range).toBe('07:00-15:00');
    expect(shiftOf(at(2, 15)).range).toBe('15:00-23:00');
    expect(shiftOf(at(2, 23, 30))).toMatchObject({ range: '23:00-07:00', day: 'Pazartesi' });
  });

  it('puts the early morning into the previous day night shift', () => {
    expect(shiftOf(at(3, 3))).toMatchObject({ range: '23:00-07:00', day: 'Pazartesi' });
    // Friday 05:00 still belongs to Thursday's 23-07 shift.
    expect(shiftOf(at(6, 5))).toMatchObject({ range: '23:00-07:00', day: 'Perşembe' });
  });

  it('uses 12-hour shifts on Friday, Saturday and Sunday', () => {
    expect(shiftOf(at(6, 7))).toMatchObject({ range: '07:00-19:00', day: 'Cuma' });
    expect(shiftOf(at(6, 20))).toMatchObject({ range: '19:00-07:00', day: 'Cuma' });
    expect(shiftOf(at(8, 18))).toMatchObject({ range: '07:00-19:00', day: 'Pazar' });
    // Monday 06:00 is the end of Sunday's night shift.
    expect(shiftOf(at(9, 6))).toMatchObject({ range: '19:00-07:00', day: 'Pazar' });
  });

  it('returns null for an invalid date', () => {
    expect(shiftOf(new Date('x'))).toBeNull();
  });
});

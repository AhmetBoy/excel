const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// Shift start hours per pattern. A shift belongs to the day it starts on,
// so 02:00 on Tuesday is part of Monday's 23:00-07:00 shift.
const WEEKDAY_SHIFTS = [
  { start: 7, end: 15, name: 'Sabah' },
  { start: 15, end: 23, name: 'Akşam' },
  { start: 23, end: 7, name: 'Gece' },
];
// Friday, Saturday and Sunday run two 12-hour shifts.
const WEEKEND_SHIFTS = [
  { start: 7, end: 19, name: 'Gündüz' },
  { start: 19, end: 7, name: 'Gece' },
];
const WEEKEND_DAYS = new Set([5, 6, 0]);

const pad = (n) => String(n).padStart(2, '0');

/**
 * Which shift a moment (local time) falls in.
 *
 * @param {Date} date
 * @returns {{ name: string, range: string, day: string, shiftDate: Date, label: string } | null}
 */
export function shiftOf(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  // Before 07:00 still belongs to the night shift that began the day before.
  const shiftDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (date.getHours() < 7) shiftDate.setDate(shiftDate.getDate() - 1);

  const shifts = WEEKEND_DAYS.has(shiftDate.getDay()) ? WEEKEND_SHIFTS : WEEKDAY_SHIFTS;
  // Hours since 07:00 of the shift day (0..23).
  const hour = (date.getHours() - 7 + 24) % 24;
  const shift = shifts.find((s) => hour < (s.end - 7 + 24) % 24 || s.end === 7) ?? shifts.at(-1);

  const range = `${pad(shift.start)}:00-${pad(shift.end)}:00`;
  const day = DAY_NAMES[shiftDate.getDay()];
  return { name: shift.name, range, day, shiftDate, label: `${day} ${shift.name} ${range}` };
}

/** "05.11.2026 14:32" in local time. */
export function formatLocalDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

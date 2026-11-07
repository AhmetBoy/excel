// Stow activity of one associate: their last stow and the idle gaps
// (no stow for N minutes) in the current shift, from FC Research's
// Inventory History searched by login (newest row first).

import { recordTimeMs } from './rozetWatch.js';

export const GAP_OPTIONS = [10, 20, 30];
export const DEFAULT_GAP_MINUTES = 10;
// Enough to reach the previous shift when the current one has no stow yet.
export const USER_STOW_HISTORY_DAYS = 2;
// How many of the newest stows the panel lists under the last one.
export const RECENT_STOW_COUNT = 5;

const PROBLEM_SOLVE = 'PROBLEM_SOLVE';
// Totes, carts and pallets - a move into one of these is not a stow.
const CONTAINER_PREFIX = /^(ts|cs|pa)x/i;

function upper(value) {
  return (value ?? '').trim().toUpperCase();
}

/**
 * A stow is an "M" move of a product from a container into a bin. Failed
 * stows (PROBLEM_SOLVE on both sides) still count: the associate was
 * stowing at that moment.
 */
function isStow(record, who) {
  if (upper(record.op) !== 'M') return false;
  if (!record.newBin || CONTAINER_PREFIX.test(record.newBin)) return false;
  if (upper(record.newBin) === upper(record.oldBin)) return false;
  if (!record.asin && !record.fnSku) return false;
  if (record.person && record.person.toLowerCase() !== who) return false;
  return true;
}

/**
 * Stows of `login`, newest first.
 *
 * @param {object[]} records - from parseInventoryHistoryHtml().records
 * @param {string} login
 * @returns {Array<{ time: string, timeMs: number, tote: string|null, bin: string,
 *   asin: string|null, fnSku: string|null, quantity: number, failed: boolean }>}
 */
export function extractStows(records, login) {
  const who = (login ?? '').toLowerCase();
  const stows = [];
  for (const record of records ?? []) {
    if (!isStow(record, who)) continue;
    const timeMs = recordTimeMs(record);
    if (timeMs === null) continue;
    stows.push({
      time: record.time,
      timeMs,
      tote: record.oldBin,
      bin: record.newBin,
      asin: record.asin,
      fnSku: record.fnSku,
      quantity: record.quantity ?? 1,
      failed: upper(record.oldOwner) === PROBLEM_SOLVE && upper(record.newOwner) === PROBLEM_SOLVE,
    });
  }
  return stows.sort((a, b) => b.timeMs - a.timeMs);
}

/**
 * Stretches of at least `minMinutes` without a stow between `fromMs`
 * (shift start) and `toMs` (now), oldest first.
 *   kind 'start'   - shift start → first stow
 *   kind 'between' - between two stows
 *   kind 'ongoing' - last stow → now (still idle)
 *   kind 'none'    - no stow at all in the range
 *
 * @param {Array<{ timeMs: number }>} stows - any order
 * @returns {Array<{ startMs: number, endMs: number, minutes: number, kind: string }>}
 */
export function findIdleGaps(stows, { fromMs, toMs, minMinutes = DEFAULT_GAP_MINUTES }) {
  const times = stows
    .map((s) => s.timeMs)
    .filter((t) => t >= fromMs && t <= toMs)
    .sort((a, b) => a - b);
  const limit = minMinutes * 60_000;
  const gaps = [];
  const add = (startMs, endMs, kind) => {
    if (endMs - startMs >= limit) {
      gaps.push({ startMs, endMs, minutes: Math.floor((endMs - startMs) / 60_000), kind });
    }
  };

  if (times.length === 0) {
    add(fromMs, toMs, 'none');
    return gaps;
  }
  add(fromMs, times[0], 'start');
  for (let i = 1; i < times.length; i++) add(times[i - 1], times[i], 'between');
  add(times.at(-1), toMs, 'ongoing');
  return gaps;
}

/** 7 → "7 dk", 75 → "1 sa 15 dk", 120 → "2 sa". */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} dk`;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}

/** "az önce" / "12 dk önce" / "1 sa 5 dk önce". */
export function formatAgo(timeMs, nowMs = Date.now()) {
  const minutes = Math.floor((nowMs - timeMs) / 60_000);
  return minutes < 1 ? 'az önce' : `${formatDuration(minutes)} önce`;
}

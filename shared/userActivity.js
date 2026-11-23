// "Kullanıcı Analizi": each listed associate's latest Inventory History
// activity - overall, per tool and their last stow - and what it says about
// them right now (still stowing, on a break, doing something else).
//
// The rows come from the Rozet scan (background/rozetScanner.js), which
// already reads every listed login's history, so the page costs no extra
// FC Research requests.

import { recordTimeMs } from './rozetWatch.js';
import { extractStows, preferredProductId } from './stowActivity.js';
import { STOW_TOOL } from './stowTool.js';
import { parseBinId } from './stowMap.js';
import { shiftOf } from './shifts.js';

export const ACTIVITY_KEY = 'userActivity'; // chrome.storage.local

/** Pseudo "tools" of the type filter, besides the tool names seen in the data. */
export const TYPE_ANY = 'any';
export const TYPE_STOW = 'stow';

export const THRESHOLD_OPTIONS = [10, 20, 30];
export const DEFAULT_THRESHOLD = 10;
/** Past this the associate counts as gone for a long time, not on a short break. */
export const LONG_ABSENCE_MINUTES = 60;

// Warehouse bin addresses like P-4-A219B151 (not totes, carts or pallets).
const LOCATION = /^[A-Z]{1,3}-\d{1,3}-[A-Z0-9]+$/i;

function upper(value) {
  return (value ?? '').trim().toUpperCase();
}

/** The bin of a row: where the unit went, else where it came from. */
export function locationOf(record) {
  for (const bin of [record.newBin, record.oldBin]) {
    if (bin && LOCATION.test(bin.trim())) return upper(bin);
  }
  return null;
}

/** "Kat 4 · A219" for P-4-A219B151; null when the address has another shape. */
export function zoneOf(bin) {
  const parsed = parseBinId(bin);
  return parsed ? { floor: parsed.floor, aisle: `${parsed.tower}${parsed.aisle}` } : null;
}

function actionOf(record, timeMs) {
  return {
    time: record.time,
    timeMs,
    op: upper(record.op) || null,
    tool: (record.tool ?? '').trim() || null,
    bin: locationOf(record),
    from: record.oldBin ?? null,
    to: record.newBin ?? null,
    product: preferredProductId(record),
    quantity: record.quantity ?? null,
  };
}

/**
 * One associate's activity from their history rows (any order).
 *
 * @param {object[]} records - parseInventoryHistoryHtml().records searched by login
 * @param {string} login
 * @param {Date} [now]
 * @returns {{ lastAny: object|null, byTool: Record<string, object>, lastStow: object|null,
 *   shiftStows: number, shiftStart: string }}
 */
export function summarizeActivity(records, login, now = new Date()) {
  const who = (login ?? '').toLowerCase();
  let lastAny = null;
  const byTool = {};

  for (const record of records ?? []) {
    if (record.person && record.person.toLowerCase() !== who) continue;
    const timeMs = recordTimeMs(record);
    if (timeMs === null) continue;
    const action = actionOf(record, timeMs);
    if (!lastAny || timeMs > lastAny.timeMs) lastAny = action;
    const tool = action.tool ?? '—';
    if (!byTool[tool] || timeMs > byTool[tool].timeMs) byTool[tool] = action;
  }

  const stows = extractStows(records, login); // newest first
  const shiftStart = shiftOf(now).startsAt.getTime();
  const newestStow = stows[0];
  const lastStow = newestStow
    ? {
        time: newestStow.time,
        timeMs: newestStow.timeMs,
        op: 'M',
        tool: STOW_TOOL,
        bin: upper(newestStow.bin),
        from: newestStow.tote,
        to: newestStow.bin,
        product: preferredProductId(newestStow),
        quantity: newestStow.quantity,
        failed: newestStow.failed,
      }
    : null;

  return {
    lastAny,
    byTool,
    lastStow,
    shiftStows: stows.filter((s) => s.timeMs >= shiftStart).reduce((sum, s) => sum + (s.quantity ?? 1), 0),
    shiftStart: new Date(shiftStart).toISOString(),
  };
}

const newer = (a, b) => ((b?.timeMs ?? -Infinity) > (a?.timeMs ?? -Infinity) ? b : a);

/**
 * Keeps the newest of each piece, so a scan whose rows don't reach as far
 * back (or came back empty) doesn't wipe what an earlier scan saw.
 * The shift stow count is taken from the newer scan of the same shift.
 */
export function mergeActivity(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  const byTool = { ...previous.byTool };
  for (const [tool, action] of Object.entries(next.byTool ?? {})) byTool[tool] = newer(byTool[tool], action);
  const sameShift = previous.shiftStart === next.shiftStart;
  return {
    lastAny: newer(previous.lastAny, next.lastAny),
    byTool,
    lastStow: newer(previous.lastStow, next.lastStow),
    shiftStows: sameShift ? Math.max(previous.shiftStows ?? 0, next.shiftStows ?? 0) : next.shiftStows,
    shiftStart: next.shiftStart,
  };
}

/** The action the type filter asks for. */
export function actionForType(summary, type) {
  if (!summary) return null;
  if (type === TYPE_ANY) return summary.lastAny;
  if (type === TYPE_STOW) return summary.lastStow;
  return summary.byTool?.[type] ?? null;
}

/**
 * What the chosen action says about the associate now.
 *   active - did it within `threshold` minutes
 *   other  - (Stow view) their newest action since is from another tool
 *   idle   - not for `threshold`..LONG_ABSENCE_MINUTES minutes
 *   away   - not for over LONG_ABSENCE_MINUTES
 *   none   - never in the data
 *
 * @returns {{ state: 'active'|'other'|'idle'|'away'|'none', minutes: number|null, action: object|null,
 *   otherTool?: string }}
 */
export function classifyUser(summary, { type = TYPE_ANY, threshold = DEFAULT_THRESHOLD, nowMs = Date.now() } = {}) {
  const action = actionForType(summary, type);
  if (!action) return { state: 'none', minutes: null, action: null };
  const minutes = Math.max(0, Math.floor((nowMs - action.timeMs) / 60_000));
  if (minutes <= threshold) return { state: 'active', minutes, action };

  const latest = summary.lastAny;
  if (type !== TYPE_ANY && latest && latest.timeMs > action.timeMs && latest.tool !== action.tool) {
    const sinceLatest = Math.floor((nowMs - latest.timeMs) / 60_000);
    if (sinceLatest <= threshold) return { state: 'other', minutes, action, otherTool: latest.tool ?? '—' };
  }
  return { state: minutes > LONG_ABSENCE_MINUTES ? 'away' : 'idle', minutes, action };
}

/** Tool names seen in any summary, most common first (for the type filter). */
export function toolsSeen(summaries) {
  const counts = new Map();
  for (const summary of summaries) {
    for (const tool of Object.keys(summary?.byTool ?? {})) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tool]) => tool);
}

/**
 * Where the associates currently doing the chosen action are, per floor and
 * aisle - e.g. two people stowing in the same aisle.
 *
 * @param {Array<{ classification: { state: string, action: object|null } }>} rows
 * @returns {{ floors: Array<{ floor: string, count: number }>, crowdedAisles: Array<{ zone: string, logins: string[] }> }}
 */
export function locationBreakdown(rows) {
  const floors = new Map();
  const aisles = new Map();
  for (const row of rows) {
    if (row.classification.state !== 'active') continue;
    const zone = zoneOf(row.classification.action?.bin);
    if (!zone) continue;
    floors.set(zone.floor, (floors.get(zone.floor) ?? 0) + 1);
    const key = `Kat ${zone.floor} · ${zone.aisle}`;
    if (!aisles.has(key)) aisles.set(key, []);
    aisles.get(key).push(row.login);
  }
  return {
    floors: [...floors.entries()]
      .map(([floor, count]) => ({ floor, count }))
      .sort((a, b) => b.count - a.count || a.floor.localeCompare(b.floor)),
    crowdedAisles: [...aisles.entries()]
      .filter(([, logins]) => logins.length > 1)
      .map(([zone, logins]) => ({ zone, logins })),
  };
}

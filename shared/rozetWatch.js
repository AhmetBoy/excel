// "Rozet" early warning: finds an associate's failed stows (PROBLEM_SOLVE)
// in FC Research's Inventory History searched by login, keeps them as
// records that can be marked resolved, and summarizes them per associate.
//
// The stow app blocks an associate ("rozet") after ROZET_LIMIT failed
// stows of the same product from the same tote. Below that limit nobody
// hears about the failed units, yet they sit in the bins unreceived - the
// point of this module is to surface those too.

import { shiftOf } from './shifts.js';

export const ROZET_LIMIT = 5;
export const RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
// Re-read this much before the newest row seen last time, so rows that
// land late in FC Research are not missed. Duplicates are dropped by id.
export const SCAN_OVERLAP_MS = 15 * 60 * 1000;

export const SETTINGS_KEY = 'rozetSettings';
export const EVENTS_KEY = 'rozetEvents';
export const STATE_KEY = 'rozetScanState';
export const DEFAULT_SETTINGS = { autoScan: true, notify: true, intervalMinutes: 5 };
export const INTERVAL_OPTIONS = [2, 5, 10, 15];

const PROBLEM_SOLVE = 'PROBLEM_SOLVE';

function upper(value) {
  return (value ?? '').trim().toUpperCase();
}

/** Milliseconds of a history row (data-row-id is an ISO UTC time). */
export function recordTimeMs(record) {
  const ms = Date.parse(record?.time ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A failed stow is the "M" move out of the tote into a bin with owner
 * PROBLEM_SOLVE on both sides. The system also writes an "A" row (no New
 * Bin) for the same unit; that one is skipped so a unit counts once.
 */
function isFailedStow(record) {
  return (
    upper(record.op) === 'M' &&
    Boolean(record.newBin) &&
    Boolean(record.oldBin) &&
    upper(record.oldOwner) === PROBLEM_SOLVE &&
    upper(record.newOwner) === PROBLEM_SOLVE
  );
}

/**
 * Failed stows of `login` as records to keep. Identical rows (same second,
 * tote, product and bin) get an ordinal so each unit keeps its own id
 * across scans.
 *
 * @param {object[]} records - from parseInventoryHistoryHtml().records
 * @param {string} login
 * @returns {Array<{ id: string, login: string, time: string, tote: string, bin: string,
 *   asin: string|null, fnSku: string|null, quantity: number, resolvedAt: null }>}
 */
export function extractFailedStows(records, login) {
  const who = login.toLowerCase();
  const seen = new Map();
  const events = [];
  for (const record of records) {
    if (!isFailedStow(record)) continue;
    if (record.person && record.person.toLowerCase() !== who) continue;
    const signature = [who, record.time, record.oldBin, record.fnSku || record.asin, record.newBin]
      .map((part) => upper(part))
      .join('|');
    const ordinal = seen.get(signature) ?? 0;
    seen.set(signature, ordinal + 1);
    events.push({
      id: `${signature}|${ordinal}`,
      login: who,
      time: record.time,
      tote: record.oldBin,
      bin: record.newBin,
      asin: record.asin,
      fnSku: record.fnSku,
      quantity: record.quantity ?? 1,
      resolvedAt: null,
    });
  }
  return events;
}

/**
 * Adds events not stored yet; stored ones keep their resolved state.
 * @returns {{ events: object[], added: object[] }}
 */
export function mergeEvents(stored, incoming) {
  const ids = new Set(stored.map((e) => e.id));
  const added = incoming.filter((e) => !ids.has(e.id) && ids.add(e.id));
  return { events: [...stored, ...added], added };
}

/** Drops events older than RETENTION_MS. */
export function pruneEvents(events, now = Date.now()) {
  return events.filter((e) => {
    const ms = Date.parse(e.time);
    return !Number.isFinite(ms) || now - ms <= RETENTION_MS;
  });
}

/**
 * Where a user's scan starts: a bit before the newest row seen last time,
 * or the start of the current shift on the first scan - never further
 * back than the retention window.
 */
export function scanCutoffMs(watermarkIso, now = new Date()) {
  const watermark = Date.parse(watermarkIso ?? '');
  const start = Number.isFinite(watermark)
    ? watermark - SCAN_OVERLAP_MS
    : shiftOf(now).startsAt.getTime();
  return Math.max(start, now.getTime() - RETENTION_MS);
}

/** Calendar days from the cutoff's day to today, both included. */
export function daysSince(cutoffMs, now = new Date()) {
  const startDay = new Date(cutoffMs);
  const from = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((to - from) / 86_400_000) + 1;
}

/** History is newest-first: once a page reaches past the cutoff, stop paging. */
export function reachedCutoff(records, cutoffMs) {
  const last = records.at(-1);
  const ms = last ? recordTimeMs(last) : null;
  return ms !== null && ms < cutoffMs;
}

export function groupKeyOf(event) {
  return `${event.login}|${upper(event.tote)}|${upper(event.fnSku) || upper(event.asin)}`;
}

const isResolved = (event) => Boolean(event.resolvedAt);
const sumQuantity = (events) => events.reduce((sum, e) => sum + (e.quantity ?? 1), 0);

/**
 * Failed stows grouped per tote + product (the unit the ROZET_LIMIT counts),
 * newest group first.
 */
export function groupEvents(events) {
  const groups = new Map();
  for (const event of events) {
    const key = groupKeyOf(event);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        login: event.login,
        tote: event.tote,
        asin: event.asin,
        fnSku: event.fnSku,
        events: [],
      });
    }
    groups.get(key).events.push(event);
  }
  return [...groups.values()]
    .map((group) => {
      group.events.sort((a, b) => String(b.time).localeCompare(String(a.time)));
      const count = sumQuantity(group.events);
      const openEvents = group.events.filter((e) => !isResolved(e));
      return {
        ...group,
        count,
        openCount: sumQuantity(openEvents),
        lastAt: group.events[0]?.time ?? null,
        rozet: count >= ROZET_LIMIT,
        resolved: openEvents.length === 0,
      };
    })
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

/**
 * Per-associate report. Everyone in `entries` gets a row (zeros when
 * clean); associates with events but not in the list are added too.
 *
 * @param {object[]} events
 * @param {Array<{ login: string, name: string|null }>} entries
 */
export function summarizeByUser(events, entries = []) {
  const groups = groupEvents(events);
  const users = new Map(entries.map((e) => [e.login, { login: e.login, name: e.name }]));
  for (const group of groups) {
    if (!users.has(group.login)) users.set(group.login, { login: group.login, name: null });
  }

  const rows = [...users.values()].map((user) => {
    const mine = groups.filter((g) => g.login === user.login);
    const failed = mine.reduce((sum, g) => sum + g.count, 0);
    const open = mine.reduce((sum, g) => sum + g.openCount, 0);
    const rozetGroups = mine.filter((g) => g.rozet);
    return {
      ...user,
      groups: mine,
      failed,
      open,
      resolved: failed - open,
      rozet: rozetGroups.length,
      rozetResolved: rozetGroups.filter((g) => g.resolved).length,
    };
  });
  rows.sort((a, b) => b.open - a.open || b.failed - a.failed || a.login.localeCompare(b.login));

  const total = rows.reduce(
    (sum, r) => ({
      failed: sum.failed + r.failed,
      open: sum.open + r.open,
      resolved: sum.resolved + r.resolved,
      rozet: sum.rozet + r.rozet,
      rozetResolved: sum.rozetResolved + r.rozetResolved,
    }),
    { failed: 0, open: 0, resolved: 0, rozet: 0, rozetResolved: 0 }
  );
  return { rows, total };
}

/**
 * One notification per associate with new failed stows.
 * @param {object[]} added - newly found events
 * @param {object[]} allEvents - every stored event (for the x/5 counts)
 * @param {Array<{ login: string, name: string|null }>} entries
 * @returns {Array<{ login: string, title: string, message: string }>}
 */
export function buildNotifications(added, allEvents, entries = []) {
  const names = new Map(entries.map((e) => [e.login, e.name]));
  const counts = new Map(groupEvents(allEvents).map((g) => [g.key, g.count]));
  const byUser = new Map();
  for (const event of added) {
    if (!byUser.has(event.login)) byUser.set(event.login, []);
    byUser.get(event.login).push(event);
  }

  return [...byUser.entries()].map(([login, events]) => {
    const lines = [];
    const doneGroups = new Set();
    for (const event of events) {
      const key = groupKeyOf(event);
      if (doneGroups.has(key)) continue;
      doneGroups.add(key);
      const bins = [...new Set(events.filter((e) => groupKeyOf(e) === key).map((e) => e.bin))];
      const count = counts.get(key) ?? 0;
      const tag = count >= ROZET_LIMIT ? ' ROZET' : '';
      lines.push(`${event.tote} · ${event.asin ?? event.fnSku} → ${bins.join(', ')} (${count}/${ROZET_LIMIT})${tag}`);
    }
    const name = names.get(login);
    const units = sumQuantity(events);
    return {
      login,
      title: `Hatalı stow: ${name ? `${name} (${login})` : login} - ${units} adet`,
      message: lines.join('\n'),
    };
  });
}

/** Marks events resolved (at `when`) or open again (when = null). */
export function setResolved(events, ids, when) {
  const wanted = new Set(ids);
  return events.map((e) => (wanted.has(e.id) ? { ...e, resolvedAt: when } : e));
}

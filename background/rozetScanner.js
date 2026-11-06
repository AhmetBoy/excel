// Background side of the "Rozet" early warning (see shared/rozetWatch.js):
// scans every associate of the Rapor user list on a chrome.alarms timer,
// stores the failed stows it finds, and shows desktop notifications.
// Read-only towards FC Research - it only runs the history search.

import { parseUserEntries } from '../shared/stowReportTable.js';
import { isFeatureAllowed } from '../shared/access.js';
import { buildHistoryDateFields } from '../shared/stowErrors.js';
import {
  buildNotifications,
  daysSince,
  DEFAULT_SETTINGS,
  EVENTS_KEY,
  extractFailedStows,
  mergeEvents,
  pruneEvents,
  reachedCutoff,
  recordTimeMs,
  scanCutoffMs,
  setResolved,
  SETTINGS_KEY,
  STATE_KEY,
} from '../shared/rozetWatch.js';

const ALARM_NAME = 'rozet-scan';
const USERS_SETTINGS_KEY = 'stowReportSettings'; // Rapor tab's user list
const FOCUS_KEY = 'rozetFocusAt'; // side panel switches to the Rozet tab when this changes
const MAX_PARALLEL_USERS = 3;
const OK_STATUSES = new Set(['ok', 'no_data']);

async function readLocal(key, fallback) {
  const data = await chrome.storage.local.get(key);
  return data[key] ?? fallback;
}

async function readSettings() {
  return { ...DEFAULT_SETTINGS, ...(await readLocal(SETTINGS_KEY, {})) };
}

async function readUserEntries() {
  const settings = await readLocal(USERS_SETTINGS_KEY, {});
  return parseUserEntries(settings.users ?? '');
}

// Scans and the side panel's resolve/delete actions all rewrite the event
// list, so they run one after another instead of overwriting each other.
let eventsQueue = Promise.resolve();

function updateEvents(change) {
  const run = eventsQueue.then(async () => {
    const stored = await readLocal(EVENTS_KEY, []);
    const { events, result } = await change(stored);
    const kept = pruneEvents(events);
    await chrome.storage.local.set({ [EVENTS_KEY]: kept });
    await updateBadge(kept);
    return result;
  });
  eventsQueue = run.catch(() => {});
  return run;
}

async function updateBadge(events) {
  const open = events.filter((e) => !e.resolvedAt).reduce((sum, e) => sum + (e.quantity ?? 1), 0);
  await chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  await chrome.action.setBadgeText({ text: open > 0 ? String(open) : '' });
}

function notify(notes) {
  for (const note of notes) {
    chrome.notifications.create(`rozet-${note.login}-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: note.title,
      message: note.message,
      priority: 2,
    });
  }
}

/** One associate: history since the cutoff, failed stows in it. */
async function scanUser(deps, login, watermark, now) {
  const cutoff = scanCutoffMs(watermark, now);
  const fields = { s: login, ...buildHistoryDateFields(now, daysSince(cutoff, now)) };
  const result = await deps.fetchPagedSection(
    'inventory-history',
    fields,
    'PARSE_INVENTORY_HISTORY_HTML',
    'records',
    { stopAfter: (items) => reachedCutoff(items, cutoff) }
  );
  const recent = result.items.filter((r) => (recordTimeMs(r) ?? Infinity) >= cutoff);
  return {
    login,
    status: result.status,
    events: extractFailedStows(recent, login),
    newest: result.items[0]?.time ?? null,
  };
}

let scanRunning = null;

/**
 * Scans every listed associate once. A second call while a scan runs
 * returns the running scan instead of starting another.
 */
function runScan(deps, trigger) {
  if (!scanRunning) {
    scanRunning = doScan(deps, trigger).finally(() => {
      scanRunning = null;
    });
  }
  return scanRunning;
}

async function doScan(deps, trigger) {
  const entries = await readUserEntries();
  const state = await readLocal(STATE_KEY, {});
  const now = new Date();

  if (entries.length === 0) {
    const next = { ...state, lastScanAt: now.toISOString(), trigger, status: 'no_users', users: {} };
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return { status: 'no_users', added: 0 };
  }

  await chrome.storage.local.set({ [STATE_KEY]: { ...state, running: true } });
  const watermarks = { ...(state.watermarks ?? {}) };
  let results;
  try {
    results = await deps.mapWithConcurrency(entries, MAX_PARALLEL_USERS, (entry) =>
      scanUser(deps, entry.login, watermarks[entry.login], now).catch((error) => ({
        login: entry.login,
        status: 'error',
        events: [],
        newest: null,
        message: String(error?.message ?? error),
      }))
    );
  } catch (error) {
    await chrome.storage.local.set({ [STATE_KEY]: { ...state, running: false } });
    throw error;
  }

  const added = await updateEvents((stored) => {
    const merged = mergeEvents(stored, results.flatMap((r) => r.events));
    return { events: merged.events, result: merged.added };
  });

  const users = {};
  for (const r of results) {
    users[r.login] = { status: r.status, found: r.events.length, message: r.message };
    // Only move forward after a complete read, so a failed page is retried.
    if (OK_STATUSES.has(r.status) && r.newest && !(watermarks[r.login] > r.newest)) {
      watermarks[r.login] = r.newest;
    }
  }
  const failedUsers = results.filter((r) => !OK_STATUSES.has(r.status)).length;
  const status = failedUsers === 0 ? 'ok' : failedUsers === results.length ? 'error' : 'partial_failure';
  await chrome.storage.local.set({
    [STATE_KEY]: {
      lastScanAt: now.toISOString(),
      trigger,
      status,
      users,
      watermarks,
      running: false,
    },
  });

  const settings = await readSettings();
  if (settings.notify && added.length > 0) {
    const all = await readLocal(EVENTS_KEY, []);
    notify(buildNotifications(added, all, entries));
  }

  return { status, added: added.length, users: results.length, failedUsers };
}

async function syncAlarm() {
  const settings = await readSettings();
  if (!settings.autoScan) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing?.periodInMinutes === settings.intervalMinutes) return;
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 0.5,
    periodInMinutes: settings.intervalMinutes,
  });
}

const MESSAGE_HANDLERS = {
  ROZET_SCAN_NOW: (deps) => runScan(deps, 'manual'),
  ROZET_SET_RESOLVED: (_deps, { ids, resolved }) =>
    updateEvents((stored) => ({
      events: setResolved(stored, ids, resolved ? new Date().toISOString() : null),
      result: { status: 'ok' },
    })),
  ROZET_DELETE: (_deps, { ids }) => {
    const wanted = new Set(ids);
    return updateEvents((stored) => ({
      events: stored.filter((e) => !wanted.has(e.id)),
      result: { status: 'ok' },
    }));
  },
  ROZET_CLEAR: (_deps, { mode }) =>
    updateEvents((stored) => ({
      events: mode === 'all' ? [] : stored.filter((e) => !e.resolvedAt),
      result: { status: 'ok' },
    })),
};

/**
 * Registers the alarm, notification and message listeners. Must run at the
 * service worker's top level so the listeners exist when Chrome wakes it.
 *
 * @param {{ fetchPagedSection: Function, mapWithConcurrency: Function }} deps
 */
export function startRozetWatch(deps) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    // Scans only while a profile with the Rozet feature is logged in.
    isFeatureAllowed('rozet')
      .then((allowed) => allowed && runScan(deps, 'auto'))
      .catch((e) => console.error('[rozet]', e));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) syncAlarm();
  });

  chrome.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith('rozet-')) return;
    chrome.notifications.clear(id);
    await chrome.storage.local.set({ [FOCUS_KEY]: Date.now() });
    try {
      const win = await chrome.windows.getLastFocused();
      await chrome.sidePanel.open({ windowId: win.id });
    } catch (error) {
      console.warn('[rozet] side panel could not be opened:', error);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = MESSAGE_HANDLERS[message?.type];
    if (!handler) return undefined;
    isFeatureAllowed('rozet')
      .then((allowed) =>
        allowed ? handler(deps, message) : { status: 'error', message: 'Bu özellik giriş yapılan profilde kapalı.' }
      )
      .then(sendResponse)
      .catch((error) => sendResponse({ status: 'error', message: String(error?.message ?? error) }));
    return true;
  });

  syncAlarm().catch((e) => console.error('[rozet] alarm setup failed:', e));
  readLocal(EVENTS_KEY, []).then(updateBadge).catch(() => {});
}

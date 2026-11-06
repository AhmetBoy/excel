import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInventoryHistoryHtml } from '../shared/parsers/inventoryHistoryParser.js';

const fixture = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'inventory-history-user.html'),
  'utf-8'
);
const page = parseInventoryHistoryHtml(fixture);

// Minimal chrome.* mock: storage.local in memory, listeners captured.
function mockChrome(initial) {
  const store = structuredClone(initial);
  const listeners = { message: null };
  return {
    store,
    listeners,
    notifications: [],
    api: {
      storage: {
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
          },
          set: async (values) => Object.assign(store, structuredClone(values)),
        },
        onChanged: { addListener: () => {} },
        // Logged in with a profile that may use Rozet.
        session: { get: async () => ({ accessSession: { role: 'tam' } }) },
      },
      alarms: {
        onAlarm: { addListener: () => {} },
        get: async () => null,
        create: async () => {},
        clear: async () => {},
      },
      notifications: {
        create: vi.fn(),
        clear: () => {},
        onClicked: { addListener: () => {} },
      },
      runtime: {
        getURL: (p) => p,
        onMessage: { addListener: (fn) => (listeners.message = fn) },
      },
      action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: async () => {} },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      sidePanel: { open: async () => {} },
    },
  };
}

function sendMessage(mock, message) {
  return new Promise((resolve) => mock.listeners.message(message, {}, resolve));
}

describe('rozetScanner', () => {
  let mock;
  let fetchPagedSection;

  beforeEach(async () => {
    vi.resetModules();
    mock = mockChrome({ stowReportSettings: { users: 'Stower X stowerx' } });
    globalThis.chrome = mock.api;
    fetchPagedSection = vi.fn(async () => ({ status: 'ok', items: page.records }));
    const { startRozetWatch } = await import('../background/rozetScanner.js');
    const mapWithConcurrency = (items, _limit, fn) => Promise.all(items.map(fn));
    startRozetWatch({ fetchPagedSection, mapWithConcurrency });
    // Far enough back that the 2026-10-31 fixture rows are inside the window.
    mock.store.rozetScanState = { watermarks: { stowerx: '2026-10-30T22:00:00.000Z' } };
  });

  it('stores the failed stow, notifies once and advances the watermark', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-31T01:00:00.000Z'), toFake: ['Date'] });
    try {
      const first = await sendMessage(mock, { type: 'ROZET_SCAN_NOW' });
      expect(first).toMatchObject({ status: 'ok', added: 1, users: 1 });

      const [, fields] = fetchPagedSection.mock.calls[0];
      expect(fields.s).toBe('stowerx');
      expect(mock.store.rozetEvents).toHaveLength(1);
      expect(mock.store.rozetEvents[0]).toMatchObject({ tote: 'csXheg3rwjb', bin: 'P-4-A220C202' });
      expect(mock.api.notifications.create).toHaveBeenCalledTimes(1);
      expect(mock.store.rozetScanState.watermarks.stowerx).toBe(page.records[0].time);
      expect(mock.api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });

      // Same rows again: nothing new, no second notification.
      const second = await sendMessage(mock, { type: 'ROZET_SCAN_NOW' });
      expect(second.added).toBe(0);
      expect(mock.api.notifications.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks resolved and clears resolved records', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-31T01:00:00.000Z'), toFake: ['Date'] });
    try {
      await sendMessage(mock, { type: 'ROZET_SCAN_NOW' });
      const [{ id }] = mock.store.rozetEvents;
      await sendMessage(mock, { type: 'ROZET_SET_RESOLVED', ids: [id], resolved: true });
      expect(mock.store.rozetEvents[0].resolvedAt).toBeTruthy();
      expect(mock.api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
      await sendMessage(mock, { type: 'ROZET_CLEAR', mode: 'resolved' });
      expect(mock.store.rozetEvents).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not notify when notifications are off', async () => {
    mock.store.rozetSettings = { notify: false };
    vi.useFakeTimers({ now: new Date('2026-10-31T01:00:00.000Z'), toFake: ['Date'] });
    try {
      await sendMessage(mock, { type: 'ROZET_SCAN_NOW' });
      expect(mock.api.notifications.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to scan for a profile without the Rozet feature', async () => {
    mock.api.storage.session.get = async () => ({ accessSession: { role: 'temel' } });
    const result = await sendMessage(mock, { type: 'ROZET_SCAN_NOW' });
    expect(result.status).toBe('error');
    expect(fetchPagedSection).not.toHaveBeenCalled();
  });

  it('keeps the watermark when the history could not be read', async () => {
    fetchPagedSection.mockResolvedValue({ status: 'auth_error', items: [] });
    const result = await sendMessage(mock, { type: 'ROZET_SCAN_NOW' });
    expect(result.status).toBe('error');
    expect(mock.store.rozetScanState.watermarks.stowerx).toBe('2026-10-30T22:00:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyUser,
  locationBreakdown,
  locationOf,
  mergeActivity,
  summarizeActivity,
  toolsSeen,
  zoneOf,
} from '../shared/userActivity.js';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();

const stow = (m, overrides = {}) => ({
  time: minutesAgo(m),
  op: 'M',
  asin: 'B0TEST0001',
  fnSku: 'X00TEST001',
  lpn: null,
  quantity: 1,
  person: 'stowerx',
  oldBin: 'tsXSA900154',
  newBin: 'P-4-A219B151',
  oldOwner: 'inventory',
  newOwner: 'inventory',
  tool: 'FCStowAppWebsite',
  ...overrides,
});
const move = (m, overrides = {}) =>
  stow(m, { tool: 'MoveItemsApp', oldBin: 'P-2-A105C120', newBin: 'tsXSA900999', ...overrides });

describe('summarizeActivity', () => {
  it('finds the last action overall, per tool and the last stow, in any row order', () => {
    // FC Research pages are not newest-first across pages.
    const summary = summarizeActivity([stow(30), move(5), stow(12, { newBin: 'P-4-A220B101' })], 'stowerx', NOW);
    expect(summary.lastAny).toMatchObject({ tool: 'MoveItemsApp', bin: 'P-2-A105C120' });
    expect(summary.lastStow).toMatchObject({ bin: 'P-4-A220B101', product: { kind: 'X ASIN', id: 'X00TEST001' } });
    expect(Object.keys(summary.byTool).sort()).toEqual(['FCStowAppWebsite', 'MoveItemsApp']);
  });

  it("ignores other people's rows", () => {
    const summary = summarizeActivity([stow(1, { person: 'someone' })], 'stowerx', NOW);
    expect(summary.lastAny).toBeNull();
    expect(summary.lastStow).toBeNull();
  });
});

describe('locationOf / zoneOf', () => {
  it('takes the bin address, not a tote', () => {
    expect(locationOf({ oldBin: 'tsXSA900154', newBin: 'P-4-A219B151' })).toBe('P-4-A219B151');
    expect(locationOf({ oldBin: 'P-2-A105C120', newBin: 'tsXSA900999' })).toBe('P-2-A105C120');
    expect(locationOf({ oldBin: 'tsX1', newBin: 'csXabcdefgh' })).toBeNull();
    expect(zoneOf('P-4-A219B151')).toEqual({ tower: 'A', floor: '4', aisle: 'A219', multiFloor: true, label: 'Kat 4 · A219' });
    // D and M have one floor: no "Kat" in the label.
    expect(zoneOf('P-1-D105B110')).toMatchObject({ tower: 'D', multiFloor: false, label: 'D105' });
  });
});

describe('classifyUser', () => {
  const nowMs = NOW.getTime();
  const summary = (rows) => summarizeActivity(rows, 'stowerx', NOW);

  it('active within the threshold, idle after it, away past an hour', () => {
    expect(classifyUser(summary([stow(4)]), { type: 'stow', threshold: 10, nowMs })).toMatchObject({ state: 'active', minutes: 4 });
    expect(classifyUser(summary([stow(25)]), { type: 'stow', threshold: 10, nowMs }).state).toBe('idle');
    expect(classifyUser(summary([stow(90)]), { type: 'stow', threshold: 10, nowMs }).state).toBe('away');
    expect(classifyUser(null, { nowMs }).state).toBe('none');
  });

  it('stopped stowing for another tool → "other"', () => {
    const result = classifyUser(summary([stow(40), move(3)]), { type: 'stow', threshold: 10, nowMs });
    expect(result).toMatchObject({ state: 'other', otherTool: 'MoveItemsApp', minutes: 40 });
    // In the "any" view the move itself is the latest action.
    expect(classifyUser(summary([stow(40), move(3)]), { type: 'any', threshold: 10, nowMs }).state).toBe('active');
  });

  it('filters by a single tool', () => {
    expect(classifyUser(summary([move(50)]), { type: 'MoveItemsApp', threshold: 10, nowMs })).toMatchObject({
      state: 'idle',
      minutes: 50,
    });
    // Moved 50 min ago but stowing now: busy with another tool.
    expect(classifyUser(summary([stow(2), move(50)]), { type: 'MoveItemsApp', threshold: 10, nowMs })).toMatchObject({
      state: 'other',
      otherTool: 'FCStowAppWebsite',
    });
  });
});

describe('mergeActivity', () => {
  it('keeps the newest of each piece when a later scan sees less', () => {
    const earlier = summarizeActivity([stow(20), move(15)], 'stowerx', NOW);
    const later = summarizeActivity([stow(5)], 'stowerx', NOW);
    const merged = mergeActivity(earlier, later);
    expect(merged.lastStow.timeMs).toBe(later.lastStow.timeMs);
    expect(merged.byTool.MoveItemsApp.timeMs).toBe(earlier.byTool.MoveItemsApp.timeMs);
    expect(mergeActivity(earlier, null)).toBe(earlier);
  });
});

describe('toolsSeen / locationBreakdown', () => {
  it('lists tools by how many people used them', () => {
    const a = summarizeActivity([stow(1), move(2)], 'stowerx', NOW);
    const b = summarizeActivity([stow(1)], 'stowerx', NOW);
    expect(toolsSeen([a, b])).toEqual(['FCStowAppWebsite', 'MoveItemsApp']);
  });

  it('counts active people per pick tower and floor and flags a shared aisle', () => {
    const active = (login, bin) => ({ login, classification: { state: 'active', action: { bin } } });
    const rows = [
      active('a', 'P-4-A219B151'),
      active('b', 'P-4-A219C101'),
      active('c', 'P-2-A105C120'),
      { login: 'd', classification: { state: 'idle', action: { bin: 'P-2-A105C120' } } },
      // same floor number, other tower: a different place
      active('e', 'P-2-B105C120'),
      active('f', 'P-1-D101A110'),
      active('g', 'P-1-D140A110'),
      active('h', 'P-1-M201A110'),
    ];
    expect(locationBreakdown(rows)).toEqual({
      towers: [
        { tower: 'A', count: 3, multiFloor: true, floors: [{ floor: '2', count: 1 }, { floor: '4', count: 2 }] },
        { tower: 'B', count: 1, multiFloor: true, floors: [{ floor: '2', count: 1 }] },
        { tower: 'D', count: 2, multiFloor: false, floors: [] },
        { tower: 'M', count: 1, multiFloor: false, floors: [] },
      ],
      crowdedAisles: [{ zone: 'Kat 4 · A219', tower: 'A', logins: ['a', 'b'] }],
    });
  });
});

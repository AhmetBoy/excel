import { describe, expect, it } from 'vitest';
import { isStowTool } from '../shared/stowTool.js';
import { extractStows } from '../shared/stowActivity.js';
import { extractFailedStows } from '../shared/rozetWatch.js';
import { stowsIntoLocation } from '../shared/locationStows.js';

const row = (overrides) => ({
  time: '2026-11-23T08:00:00.000Z',
  op: 'M',
  asin: 'B0TEST0001',
  fnSku: 'X00TEST001',
  quantity: 1,
  person: 'stowerx',
  oldBin: 'tsXSA900154',
  newBin: 'P-4-A219B151',
  oldOwner: 'inventory',
  newOwner: 'inventory',
  tool: 'FCStowAppWebsite',
  ...overrides,
});

describe('stow tool rule', () => {
  it('accepts the stow app (any case) and rows without a Tool value', () => {
    expect(isStowTool({ tool: 'FCStowAppWebsite' })).toBe(true);
    expect(isStowTool({ tool: 'fcstowappwebsite' })).toBe(true);
    expect(isStowTool({ tool: null })).toBe(true);
    expect(isStowTool({ tool: 'MoveItemsApp' })).toBe(false);
  });

  it('a MoveItemsApp move into a bin is not a stow anywhere', () => {
    const move = row({ tool: 'MoveItemsApp' });
    expect(extractStows([move], 'stowerx')).toEqual([]);
    expect(extractFailedStows([row({ tool: 'MoveItemsApp', oldOwner: 'PROBLEM_SOLVE', newOwner: 'PROBLEM_SOLVE' })], 'stowerx')).toEqual([]);
    expect(stowsIntoLocation([move], 'P-4-A219B151').size).toBe(0);
  });

  it('the same row from the stow app counts', () => {
    expect(extractStows([row()], 'stowerx')).toHaveLength(1);
    expect(stowsIntoLocation([row()], 'P-4-A219B151').size).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  effectiveUnique,
  expandBin,
  findCandidates,
  parseAisleSpec,
  parseBinId,
  parseStowMapCsv,
} from '../shared/stowMap.js';

const HEADER =
  'Bin Id,Bin Type,Total Units,Bin Size,Available Bin Volume,Bin Usage,Floor,Mod,Utilization %,Bay Id,Shelf,Dropzone,Aisle,InUse,IsLocked,Can Hold High Value Asins,Can Hold Full Case Asins,Can Hold Non Conveyable Asins,Can Hold Sortable,Unique Asin Count,Max Unique Asin Count';
const line = (id, { unique = 0, max = 6, locked = 'false', hrv = 'false', dz = 'dz-P-1A', type = 'DRAWER' } = {}) =>
  `${id},${type},3,1x1x1,10.5,PRIME,1,A,1.0,BAY-${id},X,${dz},200,true,${locked},${hrv},true,true,true,${unique},${max}`;

describe('parseBinId', () => {
  it('splits a bin address', () => {
    expect(parseBinId('P-1-A202D110')).toEqual({ floor: '1', tower: 'A', aisle: 202, shelf: 'D', position: 110 });
    expect(parseBinId('BAY-P-1')).toBeNull();
  });
});

describe('parseStowMapCsv', () => {
  it('reads comma files and groups by floor', () => {
    const csv = [HEADER, line('P-1-A200A100'), line('P-2-B201C110'), '', 'garbage'].join('\n');
    const result = parseStowMapCsv(csv);
    expect(Object.keys(result.floors)).toEqual(['1', '2']);
    expect(result.skipped).toBe(1);
  });

  it('reads Excel semicolon files with broken decimals and trailing null bytes', () => {
    const csv =
      HEADER.replaceAll(',', ';') +
      '\r\nP-1-A202D110;GROCERIES-MEDIUM;23;15.7480x17.5197x20.4724;-4.124.099;PRIME_PUTBACK;1;A;11.011.784;BAY-P-1-A202A110;D;dz-P-1A;202;true;false;true;true;true;true;5;6\r\n\u0000\u0000';
    const { floors } = parseStowMapCsv(csv);
    expect(expandBin(floors['1'][0])).toMatchObject({
      id: 'P-1-A202D110',
      binType: 'GROCERIES-MEDIUM',
      unique: 5,
      max: 6,
      canHoldHrv: true,
      locked: false,
      tower: 'A',
      shelf: 'D',
    });
  });

  it('reports missing columns', () => {
    expect(parseStowMapCsv('a,b\n1,2').error).toMatch(/Eksik sütun/);
  });
});

describe('parseAisleSpec', () => {
  it('accepts single aisles, ranges and lists', () => {
    expect(parseAisleSpec('215')).toEqual([[215, 215]]);
    expect(parseAisleSpec('205 - 209')).toEqual([[205, 209]]);
    expect(parseAisleSpec('209-205, 215')).toEqual([[205, 209], [215, 215]]);
    expect(parseAisleSpec('  ')).toBeNull();
  });
});

describe('findCandidates', () => {
  const bins = parseStowMapCsv(
    [
      HEADER,
      line('P-1-A206B101', { unique: 2 }),
      line('P-1-A206C100', { unique: 6 }), // full
      line('P-1-A205B100', { unique: 1 }),
      line('P-1-A205C100', { locked: 'true' }),
      line('P-1-A215A100', { hrv: 'true' }),
      line('P-1-D205B100'),
    ].join('\n')
  ).floors['1'].map(expandBin);

  it('returns bins with room in walking order, skipping full and locked ones', () => {
    const ids = findCandidates(bins, {}, { tower: 'A' }).map((b) => b.id);
    expect(ids).toEqual(['P-1-A205B100', 'P-1-A206B101', 'P-1-A215A100']);
  });

  it('filters by aisle range, shelves and HRV', () => {
    expect(findCandidates(bins, {}, { tower: 'A', aisles: [[205, 206]], shelves: ['B'] }).map((b) => b.id)).toEqual([
      'P-1-A205B100',
      'P-1-A206B101',
    ]);
    expect(findCandidates(bins, {}, { hrvOnly: true }).map((b) => b.id)).toEqual(['P-1-A215A100']);
  });

  it('applies session records and skips', () => {
    const marks = { 'P-1-A205B100': { added: 5 }, 'P-1-A206B101': { full: true } };
    const ids = findCandidates(bins, marks, { tower: 'A', skip: new Set(['P-1-A215A100']) }).map((b) => b.id);
    expect(ids).toEqual([]);
    expect(effectiveUnique({ unique: 1, max: 6 }, { added: 2 })).toBe(3);
  });
});

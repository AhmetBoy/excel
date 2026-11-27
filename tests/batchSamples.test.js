import { describe, expect, it } from 'vitest';
import {
  brandCounts,
  buildSample,
  formatSampleDate,
  normalizeBrand,
  parseSampleDate,
  samplesToCsv,
} from '../shared/batchSamples.js';

describe('parseSampleDate', () => {
  it('reads package date forms', () => {
    expect(parseSampleDate('15.04.2027')).toBe('2027-04-15');
    expect(parseSampleDate('5/4/27')).toBe('2027-04-05');
    expect(parseSampleDate('04.2027')).toBe('2027-04');
    expect(parseSampleDate('04/27')).toBe('2027-04');
    expect(parseSampleDate('2027-04-15')).toBe('2027-04-15');
    expect(parseSampleDate('2027-04')).toBe('2027-04');
    expect(parseSampleDate('  ')).toBe('');
  });

  it('rejects impossible dates', () => {
    expect(parseSampleDate('31.02.2027')).toBeNull();
    expect(parseSampleDate('13.2027')).toBeNull();
    expect(parseSampleDate('abc')).toBeNull();
  });

  it('formats back', () => {
    expect(formatSampleDate('2027-04-15')).toBe('15.04.2027');
    expect(formatSampleDate('2027-04')).toBe('04.2027');
  });
});

describe('buildSample', () => {
  it('normalizes brand and code', () => {
    const { sample } = buildSample({ brand: ' nivea ', batchCode: ' 92131 001 ', expiry: '04.2027' });
    expect(sample).toMatchObject({ brand: 'Nivea', batchCode: '92131 001', production: '', expiry: '2027-04', source: 'package' });
    expect(normalizeBrand("l'oreal")).toBe("L'Oréal");
    expect(normalizeBrand('Yeni Marka')).toBe('Yeni Marka');
  });

  it('needs a date and rejects duplicates / bad order', () => {
    expect(buildSample({ brand: 'Fa', batchCode: '1' }).error).toMatch(/en az birini/);
    expect(buildSample({ brand: 'Fa', batchCode: '1', production: '05.2026', expiry: '04.2026' }).error).toMatch(/önce/);
    const existing = [{ brand: 'Fa', batchCode: 'AB1' }];
    expect(buildSample({ brand: 'fa', batchCode: 'ab1', expiry: '2027-01' }, existing).error).toMatch(/zaten/);
    expect(buildSample({ brand: '', batchCode: 'x', expiry: '2027-01' }).error).toMatch(/Marka/);
  });
});

describe('brandCounts / samplesToCsv', () => {
  const samples = [
    { brand: 'Taft', batchCode: 'B2', production: '2025-01', expiry: '', source: 'package', note: 'a, "b"', createdAt: 't1' },
    { brand: 'Nivea', batchCode: 'A1', production: '', expiry: '2027-04-15', source: 'website', note: '', createdAt: 't2' },
    { brand: 'Nivea', batchCode: 'A0', production: '2024-10', expiry: '', source: 'package', note: '', createdAt: 't3' },
  ];

  it('counts per brand with targets', () => {
    expect(brandCounts(samples)).toEqual([
      { brand: 'Nivea', count: 2, target: 20 },
      { brand: 'Taft', count: 1, target: 8 },
    ]);
  });

  it('writes a sorted, quoted CSV', () => {
    const csv = samplesToCsv(samples);
    expect(csv.startsWith('﻿marka,batch_kod,uretim,skt,kaynak,not,kayit_zamani\r\n')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[1]).toBe('Nivea,A0,2024-10,,package,,t3');
    expect(lines[3]).toBe('Taft,B2,2025-01,,package,"a, ""b""",t1');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeLabel, normalizeValue, isBlank, displayOrMissing, MISSING_VALUE } from '../shared/normalize.js';

describe('normalizeLabel', () => {
  it('strips trailing colon, case, and surrounding whitespace', () => {
    expect(normalizeLabel('Owner:')).toBe('owner');
    expect(normalizeLabel('  Expiration date : ')).toBe('expiration date');
    expect(normalizeLabel('EXPIRATION DATE:')).toBe('expiration date');
  });

  it('handles null/undefined safely', () => {
    expect(normalizeLabel(null)).toBe('');
    expect(normalizeLabel(undefined)).toBe('');
  });
});

describe('normalizeValue', () => {
  it('collapses internal whitespace without changing case or content', () => {
    expect(normalizeValue('  FBA123   ABC  ')).toBe('FBA123 ABC');
  });
});

describe('isBlank / displayOrMissing', () => {
  it('treats whitespace-only strings as blank', () => {
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('x')).toBe(false);
  });

  it('falls back to MISSING_VALUE without fabricating data', () => {
    expect(displayOrMissing('')).toBe(MISSING_VALUE);
    expect(displayOrMissing(null)).toBe(MISSING_VALUE);
    expect(displayOrMissing(undefined)).toBe(MISSING_VALUE);
    expect(displayOrMissing('  2026-10-12  ')).toBe('2026-10-12');
  });
});

import { describe, expect, it } from 'vitest';
import { parsePandashJson, matchPandashResultsToAsins } from '../shared/parsers/pandashParser.js';

describe('parsePandashJson', () => {
  it('extracts asin and dropZone from rows, and passes through unfound', () => {
    const raw = JSON.stringify({
      rows: [
        { asin: 'B0EXAMPLE1', dropZone: 'NO_RESTRICTION', someOtherField: 'ignored' },
        { asin: 'B0EXAMPLE2', dropZone: 'HAZMAT_RESTRICTED' },
      ],
      unfound: ['B0MISSING'],
    });

    const result = parsePandashJson(raw);

    expect(result.rows).toEqual([
      { asin: 'B0EXAMPLE1', dropZone: 'NO_RESTRICTION' },
      { asin: 'B0EXAMPLE2', dropZone: 'HAZMAT_RESTRICTED' },
    ]);
    expect(result.unfound).toEqual(['B0MISSING']);
  });

  it('accepts an already-parsed object, not just a JSON string', () => {
    const result = parsePandashJson({ rows: [{ asin: 'B0X', dropZone: 'Z' }] });
    expect(result.rows).toEqual([{ asin: 'B0X', dropZone: 'Z' }]);
  });

  it('does not assume rows/unfound are always present', () => {
    expect(parsePandashJson({})).toEqual({ rows: [], unfound: [] });
    expect(parsePandashJson('not json')).toEqual({ rows: [], unfound: [] });
  });

  it('does not fabricate a dropZone when the field is absent on a row', () => {
    const result = parsePandashJson({ rows: [{ asin: 'B0NODZ' }] });
    expect(result.rows[0]).toEqual({ asin: 'B0NODZ', dropZone: null });
  });
});

describe('matchPandashResultsToAsins', () => {
  it('marks a single matching row as found', () => {
    const parsed = { rows: [{ asin: 'B0A', dropZone: 'NO_RESTRICTION' }], unfound: [] };
    const [result] = matchPandashResultsToAsins(parsed, ['B0A']);
    expect(result).toMatchObject({ asin: 'B0A', dropZone: 'NO_RESTRICTION', status: 'found' });
  });

  it('flags ASINs explicitly listed in unfound', () => {
    const parsed = { rows: [], unfound: ['B0GONE'] };
    const [result] = matchPandashResultsToAsins(parsed, ['B0GONE']);
    expect(result.status).toBe('unfound');
    expect(result.dropZone).toBeNull();
  });

  it('flags ASINs absent from both rows and unfound as not_in_response', () => {
    const parsed = { rows: [], unfound: [] };
    const [result] = matchPandashResultsToAsins(parsed, ['B0NEVERMENTIONED']);
    expect(result.status).toBe('not_in_response');
  });

  it('flags duplicate rows for the same ASIN instead of silently picking one', () => {
    const parsed = {
      rows: [
        { asin: 'B0DUP', dropZone: 'NO_RESTRICTION' },
        { asin: 'B0DUP', dropZone: 'HAZMAT_RESTRICTED' },
      ],
      unfound: [],
    };
    const [result] = matchPandashResultsToAsins(parsed, ['B0DUP']);
    expect(result.status).toBe('multiple_matches');
    expect(result.dropZone).toBeNull();
    expect(result.matches).toHaveLength(2);
  });

  it('matches ASINs case-insensitively', () => {
    const parsed = { rows: [{ asin: 'b0lower', dropZone: 'X' }], unfound: [] };
    const [result] = matchPandashResultsToAsins(parsed, ['B0LOWER']);
    expect(result.status).toBe('found');
  });
});

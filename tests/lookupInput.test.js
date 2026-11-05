import { describe, expect, it } from 'vitest';
import { classifyLookupInput } from '../shared/lookupInput.js';

describe('classifyLookupInput', () => {
  it('treats letters-only input as an associate login and prefixes pc99', () => {
    expect(classifyLookupInput('stowerb')).toMatchObject({
      kind: 'user',
      login: 'stowerb',
      query: 'pc99stowerb',
    });
    expect(classifyLookupInput('  StowerA ')).toMatchObject({ query: 'pc99stowera' });
  });

  it('accepts an already prefixed pc99 login', () => {
    expect(classifyLookupInput('pc99stowera')).toMatchObject({ kind: 'user', login: 'stowera' });
  });

  it('recognizes totes', () => {
    for (const value of ['tsX1c34iy93', 'csX12ab', 'paX0099']) {
      expect(classifyLookupInput(value)).toMatchObject({ kind: 'container', type: 'tote', query: value });
    }
  });

  it('recognizes product barcodes', () => {
    expect(classifyLookupInput('B0CV7PGS46')).toMatchObject({ kind: 'product', type: 'asin', query: 'B0CV7PGS46' });
    expect(classifyLookupInput('x002j1rfbd')).toMatchObject({ kind: 'product', type: 'fnsku', query: 'X002J1RFBD' });
    expect(classifyLookupInput('LPNUIN133547542')).toMatchObject({ kind: 'product', type: 'lpn' });
  });

  it('recognizes bin addresses', () => {
    expect(classifyLookupInput('p-1-a200a100')).toMatchObject({ kind: 'location', query: 'P-1-A200A100' });
  });

  it('falls back to a container for any other id with a digit', () => {
    for (const value of ['123456789012', 'TOT0001']) {
      expect(classifyLookupInput(value)).toMatchObject({ kind: 'container', query: value });
    }
  });

  it('returns null for empty input', () => {
    expect(classifyLookupInput('   ')).toBeNull();
  });
});

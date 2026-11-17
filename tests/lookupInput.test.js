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
    for (const value of ['tsX1c34iy93', 'tsXSA901314', 'csXhhniwq73', 'paX0099']) {
      expect(classifyLookupInput(value)).toMatchObject({ kind: 'container', type: 'tote', query: value });
    }
  });

  it('reads a letters-only csX as a cart, not a login', () => {
    expect(classifyLookupInput('csXhbyjrsav')).toMatchObject({ kind: 'container', query: 'csXhbyjrsav' });
  });

  it('fixes the case of totes typed with Caps Lock on', () => {
    const cases = {
      TSxsa901314: 'tsXSA901314',
      TSXSA901314: 'tsXSA901314',
      tsxsa901314: 'tsXSA901314',
      TSx09HRUVZF: 'tsX09hruvzf',
      CSxHBYJRSAV: 'csXhbyjrsav',
      CSXHHNIWQ73: 'csXhhniwq73',
      PAx00AB99: 'paX00ab99',
    };
    for (const [typed, expected] of Object.entries(cases)) {
      expect(classifyLookupInput(typed)).toMatchObject({ kind: 'container', query: expected });
    }
  });

  it('upper-cases product barcodes and lower-cases logins typed with Caps Lock on', () => {
    expect(classifyLookupInput('x001ifufo5')).toMatchObject({ type: 'fnsku', query: 'X001IFUFO5' });
    expect(classifyLookupInput('X001İFUFO5')).toMatchObject({ type: 'fnsku', query: 'X001IFUFO5' });
    expect(classifyLookupInput('b01ai2ygk4')).toMatchObject({ type: 'asin', query: 'B01AI2YGK4' });
    expect(classifyLookupInput('lpnuin14157565')).toMatchObject({ type: 'lpn', query: 'LPNUIN14157565' });
    expect(classifyLookupInput('STOWERB')).toMatchObject({ kind: 'user', query: 'pc99stowerb' });
    expect(classifyLookupInput('STOWERİ')).toMatchObject({ kind: 'user', login: 'stoweri' });
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

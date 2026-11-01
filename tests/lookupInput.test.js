import { describe, expect, it } from 'vitest';
import { classifyLookupInput } from '../shared/lookupInput.js';

describe('classifyLookupInput', () => {
  it('treats letters-only input as an associate login and prefixes pc99', () => {
    expect(classifyLookupInput('stowerb')).toEqual({
      kind: 'user',
      login: 'stowerb',
      query: 'pc99stowerb',
    });
    expect(classifyLookupInput('  StowerA ')).toMatchObject({ query: 'pc99stowera' });
  });

  it('accepts an already prefixed pc99 login', () => {
    expect(classifyLookupInput('pc99stowera')).toMatchObject({ kind: 'user', login: 'stowera' });
  });

  it('treats anything with a digit as a container', () => {
    for (const value of ['tsX1c34iy93', 'csX12ab', 'paX0099', '123456789012', 'TOT0001']) {
      expect(classifyLookupInput(value)).toEqual({ kind: 'container', query: value });
    }
  });

  it('returns null for empty input', () => {
    expect(classifyLookupInput('   ')).toBeNull();
  });
});

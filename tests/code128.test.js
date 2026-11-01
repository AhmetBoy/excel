import { describe, expect, it } from 'vitest';
import {
  CODE128_PATTERNS,
  QUIET_ZONE_MODULES,
  code128Path,
  encodeCode128,
} from '../shared/code128.js';

// Decodes symbol values back to text, independently of the encoder, to
// catch table or checksum mistakes.
function decode(symbols) {
  const [start, ...rest] = symbols;
  const checksum = rest.pop();
  const expected = symbols.slice(0, -1).reduce((sum, s, i) => sum + s * (i || 1), 0) % 103;
  expect(checksum).toBe(expected);
  if (start === 105) return rest.map((s) => String(s).padStart(2, '0')).join('');
  expect(start).toBe(104);
  return rest.map((s) => String.fromCharCode(s + 32)).join('');
}

describe('Code 128 pattern table', () => {
  it('has 106 unique, valid 11-module patterns', () => {
    expect(CODE128_PATTERNS).toHaveLength(106);
    expect(new Set(CODE128_PATTERNS).size).toBe(106);
    for (const pattern of CODE128_PATTERNS) {
      const widths = [...pattern].map(Number);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(11);
      // Code 128 parity rule: bar widths sum even, space widths sum odd.
      expect((widths[0] + widths[2] + widths[4]) % 2).toBe(0);
    }
  });
});

describe('encodeCode128', () => {
  it('round-trips mixed-case tote ids with Code B', () => {
    for (const text of ['tsX1c34iy93', 'csX12ab', 'paX0099', 'pc99stowera']) {
      expect(decode(encodeCode128(text))).toBe(text);
    }
  });

  it('matches the textbook checksum for "PJJ123C"', () => {
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879 → 879 mod 103 = 55
    expect(encodeCode128('PJJ123C').at(-1)).toBe(55);
  });

  it('uses the compact Code C for even-length numbers', () => {
    const symbols = encodeCode128('123456');
    expect(symbols[0]).toBe(105);
    expect(decode(symbols)).toBe('123456');
  });

  it('rejects empty or non-ASCII text', () => {
    expect(() => encodeCode128('')).toThrow();
    expect(() => encodeCode128('tötе')).toThrow();
  });
});

describe('code128Path', () => {
  it('has the expected width: quiet zones + 11 modules per symbol + 13 stop', () => {
    const text = 'tsX1c34iy93';
    const { width } = code128Path(text);
    const symbolCount = text.length + 2; // start + data + checksum
    expect(width).toBe(QUIET_ZONE_MODULES * 2 + symbolCount * 11 + 13);
  });
});

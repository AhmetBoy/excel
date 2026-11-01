// Code 128 barcode encoder (no external library: MV3 blocks remote code).
// Each pattern lists alternating bar/space widths in modules, bar first.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
export const CODE128_PATTERNS = PATTERNS;
const STOP_PATTERN = '2331112';
const START_B = 104;
const START_C = 105;
export const QUIET_ZONE_MODULES = 10;

/**
 * Returns the Code 128 symbol values (start, data, checksum) for `text`.
 * All-digit text of even length uses Code C (two digits per symbol, about
 * half as wide); everything else uses Code B (printable ASCII).
 * @param {string} text
 * @returns {number[]}
 */
export function encodeCode128(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('Barkod için metin boş olamaz.');

  let symbols;
  if (/^\d+$/.test(value) && value.length % 2 === 0) {
    symbols = [START_C];
    for (let i = 0; i < value.length; i += 2) symbols.push(Number(value.slice(i, i + 2)));
  } else {
    symbols = [START_B];
    for (const char of value) {
      const code = char.charCodeAt(0);
      if (code < 32 || code > 126) {
        throw new Error(`Barkoda dönüştürülemeyen karakter: "${char}"`);
      }
      symbols.push(code - 32);
    }
  }

  const checksum = symbols.reduce((sum, symbol, index) => sum + symbol * (index || 1), 0) % 103;
  symbols.push(checksum);
  return symbols;
}

/**
 * Builds an SVG path for the barcode, in module units (1 module = 1 unit
 * wide, `height` units tall), including quiet zones on both sides.
 * @param {string} text
 * @param {number} [height]
 * @returns {{ d: string, width: number, height: number }}
 */
export function code128Path(text, height = 50) {
  const widths = [...encodeCode128(text).map((s) => PATTERNS[s]), STOP_PATTERN].join('');
  let x = QUIET_ZONE_MODULES;
  let d = '';
  [...widths].forEach((char, index) => {
    const w = Number(char);
    if (index % 2 === 0) d += `M${x} 0h${w}v${height}h-${w}z`;
    x += w;
  });
  return { d, width: x + QUIET_ZONE_MODULES, height };
}

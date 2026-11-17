// FC Research names an associate's personal container "pc99<login>".
export const PERSONAL_CONTAINER_PREFIX = 'pc99';

/**
 * What the search box can hold, checked top to bottom; the first match wins.
 * To support a new kind of scan, add one entry here (and, if it needs its
 * own data, a branch for its `kind` in background.js lookupTote()).
 *
 * - kind:  which lookup flow runs ('user' | 'container' | 'location' | 'product')
 * - type:  finer label shown in the panel
 * - match: regex tested against the trimmed input
 * - build: turns the regex match into the lookup fields
 */
function swapCase(text) {
  return text.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}

/**
 * Fixes the case of a tote typed with Caps Lock on (or all upper / lower):
 * the prefix is always tsX / csX; an "SA" + digits tail (tsXSA901314) is
 * upper case, every other tail (tsX09hruvzf, csXhbyjrsav) lower case.
 */
function normalizeTote(prefix, tail) {
  return `${prefix}${/^sa\d+$/i.test(tail) ? tail.toUpperCase() : tail.toLowerCase()}`;
}

export const LOOKUP_RULES = [
  {
    // Containers come before the login rule: a csX can be letters only
    // (csXhbyjrsav) and would otherwise be read as a login.
    // tsX… always holds a digit (tsXSA901314, tsX09hruvzf).
    kind: 'container',
    type: 'tote',
    label: 'Tote',
    match: /^tsx(?=[a-z0-9]*\d)[a-z0-9]+$/i,
    build: (m) => ({ query: normalizeTote('tsX', m[0].slice(3)) }),
  },
  {
    // Cart: csX + exactly 8 characters (csXhbyjrsav, csXhhniwq73).
    kind: 'container',
    type: 'tote',
    label: 'Tote',
    match: /^csx[a-z0-9]{8}$/i,
    build: (m) => ({ query: normalizeTote('csX', m[0].slice(3)) }),
  },
  {
    // Pallet: paX… with a digit. The tail's real case isn't known, so only
    // the prefix is fixed; a Caps Lock-inverted value ("PAx…") is flipped back.
    kind: 'container',
    type: 'tote',
    label: 'Tote',
    match: /^pax(?=[a-z0-9]*\d)[a-z0-9]+$/i,
    build: (m) => {
      const tail = m[0].slice(3);
      return { query: `paX${m[0].startsWith('PAx') ? swapCase(tail) : tail}` };
    },
  },
  {
    // Logins are lower-case letters only (never digits); "pc99<login>" too.
    kind: 'user',
    type: 'user',
    label: 'Kullanıcı',
    match: /^(?:pc99)?([a-z]+)$/i,
    build: (m) => {
      const login = m[1].toLowerCase();
      return { login, query: `${PERSONAL_CONTAINER_PREFIX}${login}` };
    },
  },
  {
    // ASIN, e.g. B0CV7PGS46
    kind: 'product',
    type: 'asin',
    label: 'ASIN',
    match: /^B0[A-Z0-9]{8}$/i,
    build: (m) => ({ query: m[0].toUpperCase() }),
  },
  {
    // FNSku / X-ASIN, e.g. X002J1RFBD
    kind: 'product',
    type: 'fnsku',
    label: 'X ASIN',
    match: /^X0[A-Z0-9]{8}$/i,
    build: (m) => ({ query: m[0].toUpperCase() }),
  },
  {
    // LPN, e.g. LPNUIN133547542
    kind: 'product',
    type: 'lpn',
    label: 'LPN',
    match: /^LPN[A-Z0-9]+$/i,
    build: (m) => ({ query: m[0].toUpperCase() }),
  },
  {
    // Bin address, e.g. P-1-A200A100
    kind: 'location',
    type: 'location',
    label: 'Lokasyon',
    match: /^[A-Z]{1,3}-\d{1,3}-[A-Z0-9]+$/i,
    build: (m) => ({ query: m[0].toUpperCase() }),
  },
];

// Anything else that holds a digit is treated as a container id.
const FALLBACK_RULE = { kind: 'container', type: 'container', label: 'Container' };

/**
 * Decides what the search box holds (associate, tote, product barcode or
 * bin address) using LOOKUP_RULES.
 *
 * @param {string} raw
 * @returns {{ kind: string, type: string, label: string, query: string, login?: string } | null}
 */
export function classifyLookupInput(raw) {
  // A Turkish keyboard with Caps Lock on types "İ" for the i key (and "ı"
  // for I), which no barcode or login contains.
  const value = (raw ?? '').trim().replace(/İ/g, 'I').replace(/ı/g, 'i');
  if (!value) return null;

  for (const rule of LOOKUP_RULES) {
    const m = rule.match.exec(value);
    if (m) return { kind: rule.kind, type: rule.type, label: rule.label, ...rule.build(m) };
  }
  return { ...FALLBACK_RULE, query: value };
}

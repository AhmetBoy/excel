// StowMap "BinStatus_Report" CSV -> bin list, and the stow-location
// suggestion logic. One CSV covers one floor (all pick towers on it).

// P-1-A202D110 = floor 1, pick tower A, aisle 202, shelf (bin) D, position 110.
const BIN_ID_PATTERN = /^P-(\d+)-([A-Z])(\d{3})([A-Z])(\d{3})$/;

/**
 * @param {string} binId
 * @returns {{ floor: string, tower: string, aisle: number, shelf: string, position: number } | null}
 */
export function parseBinId(binId) {
  const m = BIN_ID_PATTERN.exec((binId ?? '').trim().toUpperCase());
  if (!m) return null;
  return { floor: m[1], tower: m[2], aisle: Number(m[3]), shelf: m[4], position: Number(m[5]) };
}

// Columns used; the rest (volume, utilization…) are ignored. Those are the
// ones Excel breaks when it re-saves the file with Turkish number format.
const COLUMNS = {
  id: 'bin id',
  binType: 'bin type',
  totalUnits: 'total units',
  dropzone: 'dropzone',
  locked: 'islocked',
  canHoldHrv: 'can hold high value asins',
  unique: 'unique asin count',
  max: 'max unique asin count',
};

const toInt = (value) => {
  const n = Number.parseInt(String(value ?? '').replace(/\./g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A stored bin is a compact array to keep ~40k bins per floor small:
 * [id, binType, dropzone, totalUnits, unique, max, locked(0/1), canHoldHrv(0/1)]
 */
function toStored(fields) {
  return [
    fields.id,
    fields.binType,
    fields.dropzone,
    toInt(fields.totalUnits),
    toInt(fields.unique),
    toInt(fields.max),
    fields.locked === 'true' ? 1 : 0,
    fields.canHoldHrv === 'true' ? 1 : 0,
  ];
}

/**
 * Parses a BinStatus_Report CSV (comma or semicolon separated).
 *
 * @param {string} text
 * @returns {{ floors: Record<string, Array<Array>>, skipped: number, error?: string }}
 *   bins grouped by floor (taken from the Bin Id), in the stored array form
 */
export function parseStowMapCsv(text) {
  const lines = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\u0000/g, '')
    .split(/\r?\n/);
  const header = lines[0] ?? '';
  const delimiter = header.split(';').length > header.split(',').length ? ';' : ',';
  const names = header.split(delimiter).map((h) => h.trim().toLowerCase());

  const index = {};
  for (const [field, name] of Object.entries(COLUMNS)) index[field] = names.indexOf(name);
  const missing = Object.entries(index).filter(([, i]) => i < 0).map(([f]) => COLUMNS[f]);
  if (missing.length > 0) {
    return { floors: {}, skipped: 0, error: `Eksik sütun: ${missing.join(', ')}` };
  }

  const floors = {};
  let skipped = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(delimiter);
    const fields = Object.fromEntries(
      Object.entries(index).map(([field, i]) => [field, (cells[i] ?? '').trim()])
    );
    fields.id = fields.id.toUpperCase();
    fields.locked = fields.locked.toLowerCase();
    fields.canHoldHrv = fields.canHoldHrv.toLowerCase();
    const parsed = parseBinId(fields.id);
    if (!parsed || cells.length < names.length) {
      skipped++;
      continue;
    }
    (floors[parsed.floor] ??= []).push(toStored(fields));
  }
  return { floors, skipped };
}

/** Expands a stored bin array into an object with its location parts. */
export function expandBin(stored) {
  const [id, binType, dropzone, totalUnits, unique, max, locked, canHoldHrv] = stored;
  return {
    id,
    binType,
    dropzone,
    totalUnits,
    unique,
    max,
    locked: locked === 1,
    canHoldHrv: canHoldHrv === 1,
    ...parseBinId(id),
  };
}

/**
 * Aisle filter text -> list of [from, to] ranges. Accepts "215",
 * "205-209" and lists like "205-209, 215". Empty = no filter (null).
 * @param {string} text
 * @returns {Array<[number, number]> | null}
 */
export function parseAisleSpec(text) {
  const parts = String(text ?? '')
    .replace(/\s*-\s*/g, '-') // "205 - 209" -> "205-209"
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (parts.length === 0) return null;

  const ranges = [];
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    ranges.push([Math.min(a, b), Math.max(a, b)]);
  }
  return ranges.length > 0 ? ranges : null;
}

/**
 * Unique ASIN count after this session's records ("Stow yapıldı" adds 1,
 * "Dolu" fills the bin).
 * @param {{ unique: number, max: number }} bin
 * @param {{ added?: number, full?: boolean } | undefined} mark
 */
export function effectiveUnique(bin, mark) {
  if (mark?.full) return bin.max;
  return Math.min(bin.max, bin.unique + (mark?.added ?? 0));
}

/**
 * Bins that can still take another distinct ASIN, in walking order
 * (aisle, then position, then shelf), filtered by the chosen criteria.
 *
 * @param {object[]} bins - expanded bins (expandBin)
 * @param {Record<string, {added?: number, full?: boolean}>} marks
 * @param {{ tower?: string, aisles?: Array<[number, number]>|null, shelves?: string[],
 *   dropzone?: string, hrvOnly?: boolean, skip?: Set<string> }} criteria
 * @returns {Array<object & { free: number, effectiveUnique: number }>}
 */
export function findCandidates(bins, marks, criteria = {}) {
  const { tower, aisles, shelves, dropzone, hrvOnly, skip } = criteria;
  const shelfSet = shelves && shelves.length > 0 ? new Set(shelves) : null;
  const inAisles = (aisle) => !aisles || aisles.some(([a, b]) => aisle >= a && aisle <= b);

  return bins
    .filter(
      (bin) =>
        !bin.locked &&
        (!tower || bin.tower === tower) &&
        (!shelfSet || shelfSet.has(bin.shelf)) &&
        (!dropzone || bin.dropzone === dropzone) &&
        (!hrvOnly || bin.canHoldHrv) &&
        !skip?.has(bin.id) &&
        inAisles(bin.aisle)
    )
    .map((bin) => {
      const used = effectiveUnique(bin, marks[bin.id]);
      return { ...bin, effectiveUnique: used, free: bin.max - used };
    })
    .filter((bin) => bin.free > 0)
    .sort(
      (a, b) =>
        a.aisle - b.aisle || a.position - b.position || a.shelf.localeCompare(b.shelf)
    );
}

function addTo(groups, key, bin, free) {
  const g = groups.get(key) ?? { key, total: 0, available: 0, freeSlots: 0, locked: 0 };
  g.total++;
  if (bin.locked) g.locked++;
  else if (free > 0) {
    g.available++;
    g.freeSlots += free;
  }
  groups.set(key, g);
}

/**
 * Counts for the "Detay" panel: how many bins of the selection still have
 * room, broken down per shelf (bin letter), aisle and bin type. The shelf
 * filter is left out on purpose so every shelf's numbers can be compared;
 * `selectedShelves` only decides which shelves the `selection` totals sum.
 *
 * @param {object[]} bins - expanded bins
 * @param {Record<string, {added?: number, full?: boolean}>} marks
 * @param {{ tower?: string, aisles?: Array<[number, number]>|null, dropzone?: string,
 *   hrvOnly?: boolean, shelves?: string[] }} criteria
 */
export function summarizeBins(bins, marks, criteria = {}) {
  const { tower, aisles, dropzone, hrvOnly, shelves } = criteria;
  const inAisles = (aisle) => !aisles || aisles.some(([a, b]) => aisle >= a && aisle <= b);
  const byShelf = new Map();
  const byAisle = new Map();
  const byBinType = new Map();

  for (const bin of bins) {
    if (tower && bin.tower !== tower) continue;
    if (dropzone && bin.dropzone !== dropzone) continue;
    if (hrvOnly && !bin.canHoldHrv) continue;
    if (!inAisles(bin.aisle)) continue;
    const free = bin.max - effectiveUnique(bin, marks[bin.id]);
    addTo(byShelf, bin.shelf, bin, free);
    addTo(byAisle, bin.aisle, bin, free);
    addTo(byBinType, bin.binType, bin, free);
  }

  const sorted = (map, compare) => [...map.values()].sort(compare);
  const shelfList = sorted(byShelf, (a, b) => a.key.localeCompare(b.key));
  const selectedSet = shelves && shelves.length > 0 ? new Set(shelves) : null;
  const selection = { total: 0, available: 0, freeSlots: 0, locked: 0 };
  for (const g of shelfList) {
    if (selectedSet && !selectedSet.has(g.key)) continue;
    selection.total += g.total;
    selection.available += g.available;
    selection.freeSlots += g.freeSlots;
    selection.locked += g.locked;
  }

  return {
    selection,
    byShelf: shelfList,
    byAisle: sorted(byAisle, (a, b) => a.key - b.key),
    byBinType: sorted(byBinType, (a, b) => b.available - a.available || a.key.localeCompare(b.key)),
  };
}

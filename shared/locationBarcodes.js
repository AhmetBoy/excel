// "Lokasyon barkodları": the filled bins of an aisle (or aisle range) from
// the StowMap BinStatus CSVs already loaded, and the barcode to print for
// each product in a bin.

// P-1-A219            whole aisle
// P-1-A219D           one shelf (bin letter) of the aisle
// P-1-A219 220-225    positions 220..225 of the aisle, every shelf (A-E);
//                     also written P-1-A219-220-225 or P-1-A219/220-225
// P-1-A219-225        position 225 only (A225..E225)
// P-1-A219D 220-225   one shelf, positions 220..225
// P-1-A219..221       aisles 219..221 (P-1-A219..P-1-A221 too)
const QUERY_PATTERN =
  /^P-(\d+)-([A-Z])(\d{3})([A-Z])?(?:\s*\.\.\s*(?:P-(\d+)-([A-Z]))?(\d{3}))?(?:[\s/-]+(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/i;

const EXAMPLES = 'P-1-A219, P-1-A219D, P-1-A219 220-225 veya P-1-A219..221';

/**
 * @param {string} text
 * @returns {{ floor: string, tower: string, fromAisle: number, toAisle: number, shelf: string|null,
 *   fromPosition: number|null, toPosition: number|null } | { error: string }}
 */
export function parseLocationQuery(text) {
  const value = (text ?? '').trim().toUpperCase();
  if (!value) return { error: `Bir lokasyon girin (ör. ${EXAMPLES}).` };
  const m = QUERY_PATTERN.exec(value);
  if (!m) return { error: `"${value}" okunamadı. Örnek: ${EXAMPLES}.` };
  const [, floor, tower, from, shelf, endFloor, endTower, to, posFrom, posTo] = m;
  if ((endFloor && endFloor !== floor) || (endTower && endTower !== tower)) {
    return { error: 'Aralık aynı kat ve aynı pick tower içinde olmalı.' };
  }
  const fromAisle = Number(from);
  const toAisle = to ? Number(to) : fromAisle;
  const firstPosition = posFrom != null ? Number(posFrom) : null;
  const lastPosition = posTo != null ? Number(posTo) : firstPosition;
  return {
    floor,
    tower,
    fromAisle: Math.min(fromAisle, toAisle),
    toAisle: Math.max(fromAisle, toAisle),
    shelf: shelf ?? null,
    fromPosition: firstPosition == null ? null : Math.min(firstPosition, lastPosition),
    toPosition: lastPosition == null ? null : Math.max(firstPosition, lastPosition),
  };
}

/** Short text of a query for the panel, e.g. "P-1-A219 · 220–225". */
export function describeLocationQuery(query) {
  const aisles = query.fromAisle === query.toAisle ? `${query.fromAisle}` : `${query.fromAisle}..${query.toAisle}`;
  let text = `P-${query.floor}-${query.tower}${aisles}${query.shelf ?? ''}`;
  if (query.fromPosition != null) {
    text +=
      query.fromPosition === query.toPosition
        ? ` · ${query.fromPosition}`
        : ` · ${query.fromPosition}–${query.toPosition}`;
  }
  return text;
}

/**
 * Bins with units in the query's aisles, ordered aisle → shelf → position.
 * @param {object[]} bins - expanded StowMap bins (see stowMap.js expandBin)
 * @param {{ hrvOnly?: boolean }} [options] - only bins that can hold High
 *   Value ASINs (StowMap "Can Hold High Value Asins" = true)
 */
export function filledBins(bins, query, { hrvOnly = false } = {}) {
  return (bins ?? [])
    .filter(
      (bin) =>
        bin.floor === query.floor &&
        bin.tower === query.tower &&
        bin.aisle >= query.fromAisle &&
        bin.aisle <= query.toAisle &&
        (!query.shelf || bin.shelf === query.shelf) &&
        (query.fromPosition == null || (bin.position >= query.fromPosition && bin.position <= query.toPosition)) &&
        (!hrvOnly || bin.canHoldHrv) &&
        bin.totalUnits > 0
    )
    .sort((a, b) => a.aisle - b.aisle || a.shelf.localeCompare(b.shelf) || a.position - b.position);
}

/** Filled bins grouped by aisle, then shelf: [{ aisle, shelves: [{ shelf, bins }] }]. */
export function groupBins(bins) {
  const aisles = [];
  for (const bin of bins) {
    let aisle = aisles.at(-1);
    if (aisle?.aisle !== bin.aisle) aisles.push((aisle = { aisle: bin.aisle, shelves: [] }));
    let shelf = aisle.shelves.at(-1);
    if (shelf?.shelf !== bin.shelf) aisle.shelves.push((shelf = { shelf: bin.shelf, bins: [] }));
    shelf.bins.push(bin);
  }
  return aisles;
}

/** Inventory rows whose consumer is PENDING_RESEARCH. */
export function pendingResearchRecords(records) {
  return (records ?? []).filter((record) => (record.consumer ?? '').trim().toUpperCase() === 'PENDING_RESEARCH');
}

/** Inventory rows that carry an LPN. */
export function lpnRecords(records) {
  return (records ?? []).filter((record) => (record.lpn ?? '').trim() !== '');
}

/** ASINs FC Research marks as High Value, from binInventory's `products`. */
export function highValueAsins(products) {
  return new Set(
    (products ?? [])
      .filter((product) => product?.highValue === true)
      .map((product) => (product.asin ?? '').trim().toUpperCase())
  );
}

/**
 * Product filters of the Lokasyon tab; several on = a row must match all.
 * @param {{ pending?: boolean, lpn?: boolean, hrv?: boolean }} filters
 * @param {Set<string>} [hrvAsins] - see highValueAsins
 */
export function filterProductRecords(records, { pending = false, lpn = false, hrv = false } = {}, hrvAsins = new Set()) {
  let rows = records ?? [];
  if (pending) rows = pendingResearchRecords(rows);
  if (lpn) rows = lpnRecords(rows);
  if (hrv) rows = rows.filter((record) => hrvAsins.has((record.asin ?? '').trim().toUpperCase()));
  return rows;
}

/** e.g. "PENDING_RESEARCH", "HRV" or "PENDING_RESEARCH + LPN'li + HRV"; '' when none is on. */
export function describeProductFilter({ pending = false, lpn = false, hrv = false } = {}) {
  return [pending && 'PENDING_RESEARCH', lpn && "LPN'li", hrv && 'HRV'].filter(Boolean).join(' + ');
}

const RANK = { lpn: 0, fnsku: 1, asin: 2 };

/**
 * The barcode of one Inventory row, by hierarchy: LPN, then X-ASIN (FNSku
 * X0…), then the B-ASIN.
 * @returns {{ code: string, kind: 'lpn'|'fnsku'|'asin' } | null}
 */
export function productBarcodeOf(record) {
  const lpn = (record.lpn ?? '').trim();
  if (lpn) return { code: lpn.toUpperCase(), kind: 'lpn' };
  const fnSku = (record.fnSku ?? '').trim();
  if (/^X0/i.test(fnSku)) return { code: fnSku.toUpperCase(), kind: 'fnsku' };
  const asin = (record.asin ?? '').trim();
  if (asin) return { code: asin.toUpperCase(), kind: 'asin' };
  if (fnSku) return { code: fnSku.toUpperCase(), kind: 'asin' };
  return null;
}

/**
 * One entry per barcode (quantities added up), LPNs first, then X, then B.
 * @param {object[]} records - Inventory rows of one bin
 * @returns {{ code: string, kind: string, asin: string|null, quantity: number, title: string|null }[]}
 */
export function productBarcodes(records) {
  const byCode = new Map();
  for (const record of records ?? []) {
    const barcode = productBarcodeOf(record);
    if (!barcode) continue;
    const quantity = Number.parseInt(record.quantity, 10);
    const entry = byCode.get(barcode.code) ?? {
      ...barcode,
      asin: record.asin ?? null,
      quantity: 0,
      title: record.title ?? null,
    };
    if (Number.isFinite(quantity)) entry.quantity += quantity;
    byCode.set(barcode.code, entry);
  }
  return [...byCode.values()].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.code.localeCompare(b.code));
}

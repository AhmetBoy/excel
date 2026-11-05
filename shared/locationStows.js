import { formatLocalDateTime, shiftOf } from './shifts.js';

// A bin can hold a product for a long time, so its history is read further
// back than a tote's (see HISTORY_DAYS in stowErrors.js).
export const LOCATION_HISTORY_DAYS = 30;

const PROBLEM_SOLVE = 'PROBLEM_SOLVE';

function upper(value) {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Moves into `location` from the bin's Inventory History, grouped by ASIN
 * (newest first). Owner PROBLEM_SOLVE on both sides = failed stow (the unit
 * is physically in the bin but not in the system); it is kept and flagged.
 *
 * @param {object[]} records - from parseInventoryHistoryHtml().records
 * @param {string} location
 * @returns {Map<string, Array<{ person: string|null, quantity: number|null, at: string,
 *   shift: string, failed: boolean, fromContainer: string|null, fnSku: string|null }>>}
 *   key: upper-case ASIN (or FNSku when the row has no ASIN)
 */
export function stowsIntoLocation(records, location) {
  const target = upper(location);
  const byProduct = new Map();

  for (const record of records ?? []) {
    if (upper(record.op) !== 'M' || upper(record.newBin) !== target) continue;
    if (upper(record.oldBin) === target) continue; // in-bin owner change, not a stow

    const failed = upper(record.oldOwner) === PROBLEM_SOLVE && upper(record.newOwner) === PROBLEM_SOLVE;
    if (!failed && upper(record.newOwner) === PROBLEM_SOLVE) continue;

    const date = new Date(record.time ?? record.date ?? '');
    const key = upper(record.asin) || upper(record.fnSku);
    if (!key) continue;

    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push({
      person: record.person,
      quantity: record.quantity,
      at: formatLocalDateTime(date) || record.date || '',
      shift: shiftOf(date)?.label ?? '',
      failed,
      fromContainer: record.oldBin,
      fnSku: record.fnSku,
      sortKey: Number.isNaN(date.getTime()) ? 0 : date.getTime(),
    });
  }

  for (const list of byProduct.values()) list.sort((a, b) => b.sortKey - a.sortKey);
  return byProduct;
}

/**
 * Stow events for one product row (matched by ASIN, falling back to FNSku).
 * @param {Map<string, object[]>} stowMap - from stowsIntoLocation()
 * @param {{ asin?: string|null, fnSku?: string|null }} product
 */
export function stowsForProduct(stowMap, { asin, fnSku }) {
  const events = stowMap.get(upper(asin)) ?? [];
  if (events.length > 0 || !fnSku) return events;
  return stowMap.get(upper(fnSku)) ?? [];
}

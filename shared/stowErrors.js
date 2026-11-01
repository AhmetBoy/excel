// How far back the Inventory History is requested. Two calendar days
// (yesterday + today) covers a night shift that crosses midnight, while
// totes are reused often enough that older stow rounds are unrelated.
export const HISTORY_DAYS = 2;

const PROBLEM_SOLVE = 'PROBLEM_SOLVE';

function upper(value) {
  return (value ?? '').trim().toUpperCase();
}

function formatMmDdYyyy(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

/**
 * Date fields for the FC Research inventory-history request (the same
 * ones its own date-range search button sends).
 * @param {Date} [now]
 * @param {number} [days]
 */
export function buildHistoryDateFields(now = new Date(), days = HISTORY_DAYS) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return {
    startSearchDateString: formatMmDdYyyy(start),
    endSearchDateString: formatMmDdYyyy(now),
    dateStringFormat: 'MM/dd/yyyy',
  };
}

/**
 * How many units of a product the system holds in a bin, from the bin's
 * Inventory records. Rows marked PROBLEM_SOLVE (consumer/disposition) are
 * left out so failed stows don't inflate the expected count.
 *
 * @param {object[]} binRecords - from parseInventoryHtml().records for the bin
 * @param {{ fnSku?: string|null, asin?: string|null }} product
 * @returns {number}
 */
export function systemQuantityInBin(binRecords, { fnSku, asin }) {
  const wanted = new Set([upper(fnSku), upper(asin)].filter(Boolean));
  return binRecords.reduce((total, record) => {
    const matches = wanted.has(upper(record.fnSku)) || wanted.has(upper(record.asin));
    const problemSolve =
      upper(record.consumer) === PROBLEM_SOLVE || upper(record.disposition) === PROBLEM_SOLVE;
    const quantity = Number.parseInt(record.quantity, 10);
    return matches && !problemSolve && Number.isFinite(quantity) ? total + quantity : total;
  }, 0);
}

/**
 * A move out of the container into a bin. Owner PROBLEM_SOLVE on both
 * sides means the unit was physically put in the bin but the stow failed;
 * owner "inventory" means a successful stow.
 */
function stowMove(record, container) {
  if (upper(record.op) !== 'M' || !record.newBin) return null;
  if (container && upper(record.oldBin) !== upper(container)) return null;
  const failed = upper(record.oldOwner) === PROBLEM_SOLVE && upper(record.newOwner) === PROBLEM_SOLVE;
  if (failed) return 'failed';
  return upper(record.newOwner) === PROBLEM_SOLVE ? null : 'success';
}

/**
 * Finds failed (PROBLEM_SOLVE) stows in a container's Inventory History and
 * groups them per bin + FNSku, next to how many of the same FNSku were
 * stowed successfully into that bin. `toPick` is what has to be picked back
 * out of the bin: the failed units.
 *
 * When `person` is given only that associate's rows count; failed rows of
 * other associates are reported as `otherPeopleFailed` so they aren't lost.
 *
 * @param {object[]} records - from parseInventoryHistoryHtml().records
 * @param {{ container?: string, person?: string }} [options]
 * @returns {{ groups: Array<{ bin: string, fnSku: string|null, asin: string|null,
 *   failed: number, succeeded: number, toPick: number, lastFailedAt: string|null }>,
 *   totalToPick: number, otherPeopleFailed: number }}
 */
export function analyzeStowErrors(records, { container, person } = {}) {
  const groups = new Map();
  const keyOf = (record) => `${upper(record.newBin)}|${upper(record.fnSku) || upper(record.asin)}`;
  let otherPeopleFailed = 0;

  const mine = (record) => !person || upper(record.person) === upper(person);
  const quantityOf = (record) => record.quantity ?? 1;

  for (const record of records) {
    if (stowMove(record, container) !== 'failed') continue;
    if (!mine(record)) {
      otherPeopleFailed += quantityOf(record);
      continue;
    }
    const key = keyOf(record);
    if (!groups.has(key)) {
      groups.set(key, {
        bin: record.newBin,
        fnSku: record.fnSku,
        asin: record.asin,
        failed: 0,
        succeeded: 0,
        toPick: 0,
        lastFailedAt: record.date,
      });
    }
    const group = groups.get(key);
    group.failed += quantityOf(record);
    group.toPick = group.failed;
  }

  for (const record of records) {
    if (stowMove(record, container) !== 'success' || !mine(record)) continue;
    const group = groups.get(keyOf(record));
    if (group) group.succeeded += quantityOf(record);
  }

  const list = [...groups.values()];
  return {
    groups: list,
    totalToPick: list.reduce((sum, g) => sum + g.toPick, 0),
    otherPeopleFailed,
  };
}

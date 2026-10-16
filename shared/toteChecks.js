import { isBlank, normalizeValue } from './normalize.js';

const READY_CONSUMER = 'UNOWNED';
const EDIT_CONSUMER = 'PENDING_RESEARCH';
// Product is being picked for a customer order: informational, not an error.
const PICKING_CONSUMER = 'CUSTOMER_SHIPMENT';
// Product is still held by Problem Solve: informational, wait for it to drop.
const PROBLEM_SOLVE_CONSUMER = 'PROBLEM_SOLVE';
const READY_DISPOSITION = 'SELLABLE';
// Not a Damage/İmha case: the product needs its SKT entered.
const EXPIRED_DISPOSITION = 'EXPIRED';

function upper(value) {
  return normalizeValue(value ?? '').toUpperCase();
}

function distinct(values) {
  return [...new Set(values)];
}

// QT-only rows never came from the tote's Inventory listing, so they say
// nothing about what is physically in the tote and are left out of the checks.
function inventoryRowsOf(rows) {
  return rows.filter((row) => row.qtMatchStatus !== 'qt_only_unmatched');
}

const NOT_PERMITTED = 'NOT_PERMITTED';
const EMPTY_DROPZONE_VALUES = new Set(['', 'NONE', 'NULL', 'N/A', '-', '—']);

/**
 * A product with no DropZone value (blank, "None", or not returned by
 * Pandash at all) belongs to the NOT_PERMITTED class.
 * @param {string|null|undefined} dropZone
 * @returns {string}
 */
export function effectiveDropZone(dropZone) {
  const value = upper(dropZone);
  return EMPTY_DROPZONE_VALUES.has(value) ? NOT_PERMITTED : value;
}

function permittedDropZones(rows) {
  return distinct(
    rows.map((row) => effectiveDropZone(row.dropZone)).filter((zone) => zone !== NOT_PERMITTED)
  );
}

/**
 * @param {object[]} rows
 * @returns {boolean}
 */
export function hasNotPermitted(rows) {
  return inventoryRowsOf(rows ?? []).some((row) => effectiveDropZone(row.dropZone) === NOT_PERMITTED);
}

/**
 * Same FNSku on several lines, none of them with an LPN, all sharing one
 * Consumer and one Disposition: the tote needs a re-scan. Matching is by
 * FNSku only - FCSku/ASIN are never used in its place.
 */
function findToteScanFnSkus(rows) {
  const groups = new Map();
  for (const row of rows) {
    const fnSku = upper(row.fnSku);
    if (!fnSku) continue;
    if (!groups.has(fnSku)) groups.set(fnSku, []);
    groups.get(fnSku).push(row);
  }

  return [...groups.entries()]
    .filter(
      ([, group]) =>
        group.length > 1 &&
        group.every((row) => isBlank(row.lpn ?? '')) &&
        distinct(group.map((row) => upper(row.consumer))).length === 1 &&
        distinct(group.map((row) => upper(row.disposition))).length === 1
    )
    .map(([fnSku]) => fnSku);
}

function sumQuantity(rows) {
  return rows.reduce((total, row) => {
    const quantity = Number.parseInt(row.quantity, 10);
    return Number.isFinite(quantity) ? total + quantity : total;
  }, 0);
}

function countVariety(rows) {
  return distinct(rows.map((row) => upper(row.fnSku) || upper(row.asin)).filter(Boolean)).length;
}

/**
 * Evaluates a looked-up tote against the stow-readiness rules and returns
 * the actions it needs. `level` is 'action' for a required operation
 * (EDIT / Damage-İmha / SKT / Tote Taraması), 'move' for a Move / ISS, 'warn' for data that is
 * missing or unexpected, and 'info' for a known state worth telling the
 * user (products in picking or still in Problem Solve). `ready` is true only when there are no
 * findings at all, since a non-UNOWNED consumer is never stow-ready.
 *
 * Expiration Date (SKT) checks depend on QT data and are not part of this
 * evaluation yet.
 *
 * A missing DropZone is only read as NOT_PERMITTED when Pandash itself
 * answered (`pandashOk`); if the Pandash request failed, missing values
 * mean "unknown", not NOT_PERMITTED, and are reported as a warning.
 *
 * @param {object[]} rows - from buildResultRows().rows
 * @param {{ pandashOk?: boolean }} [options]
 * @returns {{ ready: boolean, findings: {level: 'action'|'move'|'warn'|'info', message: string}[],
 *   totalQuantity: number, variety: number } | null} null when there are no rows
 */
export function evaluateTote(rows, { pandashOk = true } = {}) {
  const inventoryRows = inventoryRowsOf(rows ?? []);
  if (inventoryRows.length === 0) return null;

  const findings = [];

  if (pandashOk) {
    const notPermittedCount = inventoryRows.filter(
      (row) => effectiveDropZone(row.dropZone) === NOT_PERMITTED
    ).length;
    if (notPermittedCount === inventoryRows.length) {
      findings.push({ level: 'move', message: "Tote ISS'e gidecek — tüm ürünler NOT_PERMITTED" });
    } else if (notPermittedCount > 0) {
      findings.push({
        level: 'move',
        message: `Move yapılacak ve ISS'e gidecek — ${notPermittedCount} ürün NOT_PERMITTED`,
      });
    }
  } else {
    findings.push({ level: 'warn', message: 'Pandash verisi alınamadı, DropZone kontrol edilemedi' });
  }

  const dropZones = permittedDropZones(inventoryRows);
  if (dropZones.length > 1) {
    findings.push({ level: 'move', message: `Move yapılacak — DropZone'lar farklı: ${dropZones.join(', ')}` });
  }

  const consumers = inventoryRows.map((row) => upper(row.consumer));
  if (consumers.includes(EDIT_CONSUMER)) {
    findings.push({ level: 'action', message: 'EDIT yapılacak — Consumer: PENDING_RESEARCH' });
  }
  if (consumers.includes(PICKING_CONSUMER)) {
    findings.push({ level: 'info', message: 'Ürünler toplamada — Consumer: CUSTOMER_SHIPMENT' });
  }
  if (consumers.includes(PROBLEM_SOLVE_CONSUMER)) {
    findings.push({
      level: 'info',
      message: "Problem Solve'dan düşmesi bekleniyor",
    });
  }
  const knownConsumers = new Set([
    READY_CONSUMER,
    EDIT_CONSUMER,
    PICKING_CONSUMER,
    PROBLEM_SOLVE_CONSUMER,
  ]);
  const otherConsumers = distinct(consumers.filter((value) => value && !knownConsumers.has(value)));
  if (otherConsumers.length > 0) {
    findings.push({ level: 'warn', message: `Beklenmeyen Consumer değeri: ${otherConsumers.join(', ')}` });
  }
  if (consumers.some((value) => !value)) {
    findings.push({ level: 'warn', message: 'Bazı ürünlerin Consumer değeri yok' });
  }

  const dispositions = inventoryRows.map((row) => upper(row.disposition));
  if (dispositions.includes(EXPIRED_DISPOSITION)) {
    findings.push({ level: 'action', message: "EDIT — Ürün SKT'si girilmesi gerekiyor — Disposition: EXPIRED" });
  }
  const otherDispositions = distinct(
    dispositions.filter(
      (value) => value && value !== READY_DISPOSITION && value !== EXPIRED_DISPOSITION
    )
  );
  if (otherDispositions.length > 0) {
    findings.push({ level: 'action', message: 'Damage Stow veya İMHA yapılacak' });
  }
  if (dispositions.some((value) => !value)) {
    findings.push({ level: 'warn', message: 'Bazı ürünlerin Disposition değeri yok' });
  }

  const toteScanFnSkus = findToteScanFnSkus(inventoryRows);
  if (toteScanFnSkus.length > 0) {
    findings.push({
      level: 'action',
      message: 'Tote Taraması gerekiyor',
    });
  }

  return {
    ready: findings.length === 0,
    findings,
    totalQuantity: sumQuantity(inventoryRows),
    variety: countVariety(inventoryRows),
  };
}

/**
 * CSS class for a single table cell that triggered one of the action
 * rules above, so the offending value stands out in the row too.
 * @param {object} row
 * @param {string} columnKey
 * @param {{ moveNeeded: boolean }} context
 * @returns {string|null}
 */
export function cellHighlightClass(row, columnKey, { moveNeeded }) {
  if (columnKey === 'consumer') {
    const consumer = upper(row.consumer);
    if (consumer === EDIT_CONSUMER) return 'cell-action';
    if (consumer === PICKING_CONSUMER || consumer === PROBLEM_SOLVE_CONSUMER) return 'cell-info';
    if (consumer && consumer !== READY_CONSUMER) return 'cell-warn';
  }
  if (columnKey === 'disposition') {
    const disposition = upper(row.disposition);
    if (disposition && disposition !== READY_DISPOSITION) return 'cell-action';
  }
  // Rows whose DropZone is hidden as a duplicate (dedupeDropZoneDisplay)
  // carry the same value as the first row of that FNSku; don't re-flag them.
  if (columnKey === 'dropZone' && !row.dropZoneHidden) {
    if (effectiveDropZone(row.dropZone) === NOT_PERMITTED) return 'cell-move';
    if (moveNeeded) return 'cell-move';
  }
  return null;
}

/**
 * @param {object[]} rows
 * @returns {boolean}
 */
export function isMoveNeeded(rows) {
  return permittedDropZones(inventoryRowsOf(rows ?? [])).length > 1;
}

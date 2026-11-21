import { isBlank, normalizeValue } from './normalize.js';
import { classifyExpiration } from './expiration.js';

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

// Flammable / aerosol DropZones, highlighted pink so they stand out.
const HAZMAT_DROPZONES = new Set(['FLAM_AEROSOLS', 'AEROSOLS', 'FLAMMABLES']);

// Whole-column color when every product of the tote has the same DropZone.
const UNIFORM_DROPZONE_CLASSES = {
  NO_RESTRICTION: 'cell-ok',
  MISCH_HEALTH: 'cell-caution',
  MISC_HEALTH: 'cell-caution',
  CORROSIVE: 'cell-caution',
};

/**
 * CSS class for the whole DropZone column: green when every product is
 * NO_RESTRICTION, yellow when every product is MISCH_HEALTH (or every one
 * CORROSIVE), pink when every product is a flammable / aerosol DropZone.
 * null for mixed or other DropZones.
 * @param {object[]} rows
 * @returns {string|null}
 */
export function dropZoneColumnClass(rows) {
  const zones = distinct(inventoryRowsOf(rows ?? []).map((row) => effectiveDropZone(row.dropZone)));
  if (zones.length > 0 && zones.every((zone) => HAZMAT_DROPZONES.has(zone))) return 'cell-hazmat';
  return zones.length === 1 ? (UNIFORM_DROPZONE_CLASSES[zones[0]] ?? null) : null;
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

export function sumQuantity(rows) {
  return rows.reduce((total, row) => {
    const quantity = Number.parseInt(row.quantity, 10);
    return Number.isFinite(quantity) ? total + quantity : total;
  }, 0);
}

/** Finding code the panel uses to offer "Receive'de aç". */
export const TOTE_SCAN_CODE = 'tote_scan';

/** Finding codes for the SKT rules (the panel may offer SKT entry on them). */
export const SKT_MISSING_CODE = 'skt_missing';
export const SKT_EXPIRED_CODE = 'skt_expired';

// QT statuses after which the datelot list is known (empty or not).
const QT_KNOWN_STATUSES = new Set(['ok', 'no_datelot_items', 'no_datelot_screen']);

// Rows that carry a QT datelot record, i.e. whose date was actually read.
function hasQtRecord(row) {
  return row.qtMatchStatus === 'matched' || row.qtMatchStatus === 'qt_only_unmatched';
}

// SKT classes that explain an EXPIRED disposition / PENDING_RESEARCH consumer.
const SKT_PROBLEM_CLASSES = new Set(['missing', 'expired', 'near']);

/**
 * Rows whose EXPIRED / PENDING_RESEARCH comes from their SKT: QT read a
 * date for them and it is missing, past or near. For these the SKT finding
 * alone tells what to do, so the generic EDIT messages are left out. Rows
 * whose SKT is unknown (QT failed, no QT record) or fine keep them.
 */
function rowsExplainedBySkt(rows, qtStatus, now) {
  if (!QT_KNOWN_STATUSES.has(qtStatus)) return new Set();
  return new Set(
    rows.filter((row) => hasQtRecord(row) && SKT_PROBLEM_CLASSES.has(classifyExpiration(row.expirationDate, now)))
  );
}

function expirationFindings(rows, qtStatus, now) {
  if (qtStatus === undefined) return []; // QT not asked for this lookup
  if (!QT_KNOWN_STATUSES.has(qtStatus)) {
    return [{ level: 'warn', message: 'QT verisi alınamadı, SKT kontrol edilemedi' }];
  }

  const byClass = { missing: [], expired: [], near: [], unreadable: [] };
  for (const row of rows.filter(hasQtRecord)) {
    const cls = classifyExpiration(row.expirationDate, now);
    if (cls in byClass) byClass[cls].push(row);
  }

  const findings = [];
  if (byClass.missing.length > 0) {
    findings.push({
      level: 'action',
      code: SKT_MISSING_CODE,
      message: `SKT girilmeli — ${byClass.missing.length} üründe SKT yok`,
    });
  }
  const late = [...byClass.expired, ...byClass.near];
  if (late.length > 0) {
    const parts = [];
    if (byClass.expired.length > 0) parts.push(`${byClass.expired.length} geçmiş`);
    if (byClass.near.length > 0) parts.push(`${byClass.near.length} çok yaklaşmış`);
    findings.push({
      level: 'action',
      code: SKT_EXPIRED_CODE,
      message: `SKT geçmiş / çok yaklaşmış — ${parts.join(', ')}`,
    });
  }
  if (byClass.unreadable.length > 0) {
    const values = distinct(byClass.unreadable.map((row) => normalizeValue(row.expirationDate)));
    findings.push({ level: 'warn', message: `SKT okunamadı: ${values.join(', ')}` });
  }
  return findings;
}

export function countVariety(rows) {
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
 * Expiration Date (SKT), from QT (`qtStatus` = sourceStatus.qt; leave it
 * undefined when QT wasn't asked): no SKT -> "SKT girilmeli"; before today
 * or within 3 months -> "SKT geçmiş / çok yaklaşmış". If QT failed the SKT
 * is unknown and reported as a warning, so the tote is not shown as ready.
 * A product whose SKT is missing / past / near gets only the SKT finding:
 * its EXPIRED disposition and PENDING_RESEARCH consumer come from the SKT,
 * so "EDIT — ... EXPIRED" and "EDIT yapılacak — PENDING_RESEARCH" are
 * shown only for products whose SKT is unknown or fine.
 *
 * A missing DropZone is only read as NOT_PERMITTED when Pandash itself
 * answered (`pandashOk`); if the Pandash request failed, missing values
 * mean "unknown", not NOT_PERMITTED, and are reported as a warning.
 *
 * @param {object[]} rows - from buildResultRows().rows
 * @param {{ pandashOk?: boolean, qtStatus?: string, now?: Date }} [options]
 * @returns {{ ready: boolean, findings: {level: 'action'|'move'|'warn'|'info', message: string}[],
 *   totalQuantity: number, variety: number } | null} null when there are no rows
 */
export function evaluateTote(rows, { pandashOk = true, qtStatus, now = new Date() } = {}) {
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

  const explainedBySkt = rowsExplainedBySkt(inventoryRows, qtStatus, now);
  const unexplainedRows = inventoryRows.filter((row) => !explainedBySkt.has(row));

  const consumers = inventoryRows.map((row) => upper(row.consumer));
  if (unexplainedRows.some((row) => upper(row.consumer) === EDIT_CONSUMER)) {
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
  if (unexplainedRows.some((row) => upper(row.disposition) === EXPIRED_DISPOSITION)) {
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
      code: TOTE_SCAN_CODE,
      message: 'Tote Taraması gerekiyor',
    });
  }

  findings.push(...expirationFindings(inventoryRows, qtStatus, now));

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
 * @param {{ moveNeeded: boolean, columnClass?: string|null, now?: Date }} context - columnClass from dropZoneColumnClass()
 * @returns {string|null}
 */
export function cellHighlightClass(row, columnKey, { moveNeeded, columnClass = null, now = new Date() }) {
  if (columnKey === 'expirationDate') {
    if (!hasQtRecord(row)) return null;
    const cls = classifyExpiration(row.expirationDate, now);
    if (cls === 'missing' || cls === 'expired' || cls === 'near') return 'cell-action';
    return cls === 'unreadable' ? 'cell-warn' : null;
  }
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
  if (columnKey === 'dropZone') {
    // A tote with one DropZone throughout may color the whole column.
    if (columnClass) return columnClass;
    if (row.dropZoneHidden) return null;
    const dropZone = effectiveDropZone(row.dropZone);
    if (dropZone === NOT_PERMITTED) return 'cell-move';
    if (HAZMAT_DROPZONES.has(dropZone)) return 'cell-hazmat';
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

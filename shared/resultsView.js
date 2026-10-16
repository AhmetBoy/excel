import { displayOrMissing } from './normalize.js';

export const COLUMNS = [
  { key: 'dropZone', label: 'DropZone' },
  { key: 'consumer', label: 'Consumer' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'container', label: 'Container' },
  { key: 'asin', label: 'ASIN' },
  { key: 'fnSku', label: 'FNSku' },
  { key: 'lpn', label: 'LPN' },
  { key: 'title', label: 'Title' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'owner', label: 'Owner' },
  { key: 'expirationDate', label: 'Expiration Date' },
  { key: 'dataStatus', label: 'Veri Durumu' },
];

const SOURCE_STATUS_LABELS = {
  pending: 'Bekliyor',
  ok: 'Başarılı',
  not_found: 'Veri bulunamadı',
  no_data: 'Veri bulunamadı',
  skipped_no_asin: 'ASIN yok, atlandı',
  partial_failure: 'Kısmen başarısız',
  no_datelot_screen: 'Datelot bilgisi gösterilmedi',
  no_qt_tab: 'QT sekmesi açık değil',
  content_script_unreachable: 'QT sekmesine ulaşılamadı',
  auth_required: 'Oturum gerekli',
  request_failed: 'İstek başarısız',
  network_error: 'İstek başarısız',
  error: 'İstek başarısız',
  unexpected_response: 'Beklenmeyen yanıt (oturum açık mı?)',
  graphql_error: 'Atlas hata döndürdü',
  config_missing: 'Atlas sorgu hash değeri tanımlı değil',
};

/**
 * @param {string} status
 * @returns {string}
 */
export function describeSourceStatus(status) {
  return SOURCE_STATUS_LABELS[status] ?? status ?? 'Bilinmiyor';
}

const ROW_PANDASH_WARNINGS = {
  multiple_matches: 'Pandash: Birden fazla kayıt',
  unfound: 'Pandash: Bulunamadı',
  not_in_response: 'Pandash: Bulunamadı',
};

const ROW_QT_WARNINGS = {
  ambiguous: 'QT: Eşleşme doğrulanamadı',
  no_fcsku: 'QT: FCSku yok',
  no_qt_data: 'QT: Veri yok',
  qt_only_unmatched: 'QT: Envanterle eşleşmedi',
};

/**
 * Builds the "Veri Durumu" text for a single result row from its
 * per-source match statuses, without claiming certainty where there is
 * none (e.g. an ambiguous QT match is reported as such, not merged).
 * @param {object} row
 * @returns {string}
 */
export function describeDataStatus(row) {
  const warnings = [
    ROW_PANDASH_WARNINGS[row.pandashStatus],
    ROW_QT_WARNINGS[row.qtMatchStatus],
  ].filter(Boolean);

  return warnings.length > 0 ? warnings.join(', ') : 'Tam';
}

/**
 * Suppresses repeated DropZone display for rows sharing the same FNSku
 * (e.g. two inventory lines/lots of the same product in one tote), so the
 * same DropZone value doesn't visually repeat on every duplicate row.
 * This only affects what's rendered - the underlying row objects (and
 * their real dropZone data) are untouched, preserving each source record
 * per spec section 3 ("kayıtları gelişigüzel birleştirme" - don't merge
 * records arbitrarily, this is presentation only).
 * @param {object[]} rows
 * @returns {object[]}
 */
export function dedupeDropZoneDisplay(rows) {
  const seenFnSku = new Set();
  return rows.map((row) => {
    if (!row.fnSku) return row;
    if (seenFnSku.has(row.fnSku)) {
      return { ...row, dropZone: null, dropZoneHidden: true };
    }
    seenFnSku.add(row.fnSku);
    return row;
  });
}

/**
 * Rearranges COLUMNS according to a user-chosen key order (persisted
 * separately, e.g. in chrome.storage.local). Any key in storedKeyOrder
 * that no longer exists in COLUMNS is ignored, and any COLUMNS entry not
 * present in storedKeyOrder (e.g. a column added after the order was
 * saved) is appended at the end in its default position - so a stale or
 * partial saved order never hides a column.
 * @param {string[]|null|undefined} storedKeyOrder
 * @returns {{key: string, label: string}[]}
 */
export function reorderColumns(storedKeyOrder) {
  if (!Array.isArray(storedKeyOrder) || storedKeyOrder.length === 0) return COLUMNS;

  const byKey = new Map(COLUMNS.map((column) => [column.key, column]));
  const ordered = storedKeyOrder.map((key) => byKey.get(key)).filter(Boolean);
  const orderedKeys = new Set(ordered.map((column) => column.key));
  const remaining = COLUMNS.filter((column) => !orderedKeys.has(column.key));

  return [...ordered, ...remaining];
}

const FILTERABLE_FIELDS = ['asin', 'fnSku', 'fcSku', 'owner', 'dropZone', 'expirationDate'];

/**
 * Filters rows by a free-text query matched against ASIN, SKU, Owner,
 * DropZone, and Expiration Date fields (case-insensitive substring match).
 * @param {object[]} rows
 * @param {string} query
 * @returns {object[]}
 */
export function filterRows(rows, query) {
  const normalizedQuery = (query ?? '').trim().toLowerCase();
  if (normalizedQuery.length === 0) return rows;

  return rows.filter((row) =>
    FILTERABLE_FIELDS.some((field) =>
      (row[field] ?? '').toString().toLowerCase().includes(normalizedQuery)
    )
  );
}

/**
 * Renders rows into a <tbody> element, using `columns` for cell order so
 * the body always matches whatever order the header is currently showing
 * (see reorderColumns). Pure DOM mutation - kept separate from
 * filterRows/describeDataStatus so the latter stay unit-testable without
 * a browser-specific DOM dependency beyond what jsdom provides.
 * @param {HTMLTableSectionElement} tbody
 * @param {object[]} rows
 * @param {{key: string, label: string}[]} [columns]
 * @param {(row: object, columnKey: string) => string|null} [getCellClass]
 *   optional extra CSS class per cell (e.g. to highlight a value that
 *   triggered a stow-readiness rule)
 */
export function renderRows(tbody, rows, columns = COLUMNS, getCellClass = null) {
  tbody.replaceChildren();

  if (rows.length === 0) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns.length;
    cell.textContent = 'Sonuç bulunamadı.';
    cell.className = 'empty-state';
    emptyRow.appendChild(cell);
    tbody.appendChild(emptyRow);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      td.textContent =
        column.key === 'dataStatus' ? describeDataStatus(row) : displayOrMissing(row[column.key]);
      const cellClass = getCellClass?.(row, column.key);
      if (cellClass) td.className = cellClass;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

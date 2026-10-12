import { normalizeValue } from '../normalize.js';

/**
 * Header text -> output field name. Keys are produced by stripping
 * everything but letters/digits and lowercasing, so "FN Sku", "FNSKU" and
 * "FnSku:" all resolve to the same alias.
 */
const FIELD_ALIASES = {
  container: 'container',
  asin: 'asin',
  fnsku: 'fnSku',
  lpn: 'lpn',
  quantity: 'quantity',
  qty: 'quantity',
  disposition: 'disposition',
  consumer: 'consumer',
  title: 'title',
  fcsku: 'fcSku',
  consumerid: 'consumerId',
  outerlocation: 'outerLocation',
  outerlocationtype: 'outerLocationType',
};

function headerKey(text) {
  return normalizeValue(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellText(cell) {
  return normalizeValue(cell?.textContent ?? '');
}

/**
 * Builds a map of output field name -> column index from a table's header
 * row. Falls back to the first row if there is no <thead>/<th>, since some
 * internal tools render header cells as plain <td> in the first <tr>.
 */
function buildColumnMap(table) {
  const headerRow =
    table.querySelector('thead tr') ?? table.querySelector('tr');
  if (!headerRow) return { columnMap: {}, headerRowElement: null };

  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  const columnMap = {};
  headerCells.forEach((cell, index) => {
    const alias = FIELD_ALIASES[headerKey(cell.textContent)];
    if (alias && !(alias in columnMap)) {
      columnMap[alias] = index;
    }
  });
  return { columnMap, headerRowElement: headerRow };
}

/**
 * Parses the #table-inventory HTML table into structured records.
 * Columns are matched by header text (see FIELD_ALIASES), not fixed
 * positions, so reordered or added columns don't silently break mapping.
 *
 * @param {string} html - Raw HTML response from the Inventory app.
 * @returns {{ found: boolean, records: Array<Record<string, string|null>>, unmappedHeaders: string[] }}
 *   found=false means #table-inventory was not present in the response at all
 *   (e.g. invalid tote). found=true with records=[] means the table rendered
 *   with no data rows.
 */
export function parseInventoryHtml(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const table = doc.querySelector('#table-inventory');

  if (!table) {
    return { found: false, records: [], unmappedHeaders: [] };
  }

  const { columnMap, headerRowElement } = buildColumnMap(table);

  const unmappedHeaders = headerRowElement
    ? Array.from(headerRowElement.querySelectorAll('th, td'))
        .map((cell) => cellText(cell))
        .filter((text, index) => text && !Object.values(columnMap).includes(index))
    : [];

  // Browsers/jsdom auto-insert an implicit <tbody> around bare <tr> rows,
  // so "tbody tr" can still include the header row when there is no
  // explicit <thead>. Always exclude headerRowElement explicitly instead
  // of relying on tbody/thead structure being present.
  const bodyRows = Array.from(table.querySelectorAll('tr')).filter(
    (row) => row !== headerRowElement
  );

  const records = bodyRows
    .map((row) => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length === 0) return null;

      const record = {};
      for (const field of Object.values(FIELD_ALIASES)) {
        const index = columnMap[field];
        record[field] = index != null ? cellText(cells[index]) || null : null;
      }
      return record;
    })
    .filter(Boolean);

  return { found: true, records, unmappedHeaders };
}

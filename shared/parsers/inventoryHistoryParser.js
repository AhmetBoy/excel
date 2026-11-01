import { normalizeValue } from '../normalize.js';

// FC Research header ids are "inventory-history-<suffix>".
const COLUMN_IDS = {
  date: 'date',
  op: 'op',
  asin: 'asin',
  fnsku: 'fnSku',
  fcsku: 'fcSku',
  lpn: 'lpn',
  quantity: 'quantity',
  person: 'person',
  'old-bin': 'oldBin',
  'new-bin': 'newBin',
  'old-owner': 'oldOwner',
  'new-owner': 'newOwner',
  tool: 'tool',
};

// Column order seen on the live page; used for "-more" pages, which hold
// bare rows without a header.
const DEFAULT_ORDER = [
  'date', 'op', 'rs', 'asin', 'fnSku', 'fcSku', 'lpn', 'quantity',
  'person', 'oldBin', 'newBin', 'oldOwner', 'newOwner', 'tool',
];

function text(el) {
  return normalizeValue(el?.textContent ?? '');
}

function buildColumnMap(table) {
  const map = {};
  table.querySelectorAll('thead th').forEach((th, index) => {
    const suffix = (th.id ?? '').replace(/^inventory-history-/, '');
    const field = COLUMN_IDS[suffix];
    if (field && !(field in map)) map[field] = index;
  });
  if (Object.keys(map).length > 0) return map;
  return Object.fromEntries(DEFAULT_ORDER.map((field, index) => [field, index]));
}

function parseRows(rows, columnMap) {
  const records = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue; // header or "no data" row
    const record = { time: row.getAttribute('data-row-id') || null };
    for (const [field, index] of Object.entries(columnMap)) {
      record[field] = text(cells[index]) || null;
    }
    const quantity = Number.parseInt(record.quantity, 10);
    record.quantity = Number.isFinite(quantity) ? quantity : null;
    records.push(record);
  }
  return records;
}

/**
 * Parses an FC Research "inventory-history" section (newest row first).
 * Also accepts a "-more" page of bare rows.
 *
 * @param {string} html
 * @returns {{ found: boolean, records: object[], paginationToken: string|null }}
 */
export function parseInventoryHistoryHtml(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const paginationToken = text(doc.querySelector('.pagination-token')) || null;
  const table = doc.querySelector('#table-inventory-history');

  if (!table) {
    const wrapped = new DOMParser().parseFromString(`<table>${html ?? ''}</table>`, 'text/html');
    const records = parseRows(wrapped.querySelectorAll('tr'), buildColumnMap(wrapped));
    return { found: records.length > 0, records, paginationToken };
  }

  return {
    found: true,
    records: parseRows(table.querySelectorAll('tbody tr'), buildColumnMap(table)),
    paginationToken,
  };
}

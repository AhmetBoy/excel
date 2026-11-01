import { normalizeValue } from '../normalize.js';

function text(el) {
  return normalizeValue(el?.textContent ?? '');
}

function headerKey(value) {
  return normalizeValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reads the "Container Hierarchy:" breadcrumb (e.g. dzg-General > dz-P-MixStow > pc99login).
 * Each step has a link (or bold text for the searched container) plus a
 * hidden popover listing "Container Type".
 */
function parsePath(doc) {
  const items = doc.querySelectorAll('ul.a-horizontal > li');
  const path = [];
  for (const li of items) {
    const nameEl = li.querySelector('a.a-link-normal, span.a-text-bold');
    if (!nameEl) continue;
    let type = null;
    for (const dt of li.querySelectorAll('dt')) {
      if (headerKey(dt.textContent) === 'containertype') {
        type = text(dt.nextElementSibling) || null;
      }
    }
    path.push({ id: text(nameEl), type });
  }
  return path;
}

function parseChildRows(rows, columnMap) {
  const children = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue; // header or "No child containers." row
    const idCell = cells[columnMap.scannableId ?? 0];
    const scannableId = text(idCell?.querySelector('a') ?? idCell);
    if (!scannableId) continue;
    children.push({ scannableId, type: text(cells[columnMap.type ?? 1]) || null });
  }
  return children;
}

/**
 * Parses an FC Research "container-hierarchy" section (POST
 * /XSA9/results/container-hierarchy, body s=<query>). For a personal
 * container (pc99<login>) the Child Containers table lists the totes/csX
 * currently on that associate.
 *
 * Also accepts a "container-hierarchy-more" page, which holds bare <tr>
 * rows instead of a full table.
 *
 * @param {string} html
 * @returns {{ found: boolean, path: {id: string, type: string|null}[],
 *   children: {scannableId: string, type: string|null}[], paginationToken: string|null }}
 */
export function parseContainerHierarchyHtml(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const paginationToken = text(doc.querySelector('.pagination-token')) || null;
  const table = doc.querySelector('#table-container-hierarchy');

  if (!table) {
    // A "-more" page: bare rows get dropped by the HTML parser outside a
    // <table>, so re-parse them wrapped in one.
    const wrapped = new DOMParser().parseFromString(`<table>${html ?? ''}</table>`, 'text/html');
    const children = parseChildRows(wrapped.querySelectorAll('tr'), {});
    return { found: children.length > 0, path: [], children, paginationToken };
  }

  const columnMap = {};
  table.querySelectorAll('thead th').forEach((th, index) => {
    const key = headerKey(th.textContent);
    if (key === 'scannableid') columnMap.scannableId = index;
    if (key === 'type') columnMap.type = index;
  });

  return {
    found: true,
    path: parsePath(doc),
    children: parseChildRows(table.querySelectorAll('tbody tr'), columnMap),
    paginationToken,
  };
}

/**
 * Mirrors FC Research's own loader: a token that is empty or starts with
 * "true" means there are no more pages.
 * @param {string|null} token
 */
export function hasMorePages(token) {
  return Boolean(token) && !/^true/.test(token);
}

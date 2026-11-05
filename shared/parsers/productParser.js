import { normalizeValue } from '../normalize.js';

// Checked against a saved live section (tests/fixtures/fcresearch-product.html):
// an <img> from m.media-amazon.com next to a "a-keyvalue" table of
// <th>label</th><td>value</td> rows, where the flag is "Very High Value"
// (true/false). Labels are matched loosely in case the layout changes.

const TRUE_VALUES = new Set(['true', 'yes', 'y', 'evet', '1']);
const FALSE_VALUES = new Set(['false', 'no', 'n', 'hayır', '0']);

function key(text) {
  return normalizeValue(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function text(el) {
  return normalizeValue(el?.textContent ?? '');
}

/** "High Value", "Is High Value", "High Very Value", "highValue"… */
function isHighValueLabel(label) {
  const k = key(label);
  return k.includes('high') && k.includes('value');
}

function collectFields(root) {
  const fields = [];

  for (const row of root.querySelectorAll('tr')) {
    const cells = Array.from(row.querySelectorAll('th, td'));
    // Label/value pairs within one row.
    for (let i = 0; i + 1 < cells.length; i += 2) {
      fields.push({ label: text(cells[i]), value: text(cells[i + 1]) });
    }
  }

  // Header row + data rows.
  for (const table of root.querySelectorAll('table')) {
    const headers = Array.from(table.querySelectorAll('thead th'));
    if (headers.length === 0) continue;
    const firstRow = table.querySelector('tbody tr');
    if (!firstRow) continue;
    const cells = Array.from(firstRow.querySelectorAll('td'));
    headers.forEach((th, i) => {
      fields.push({ label: text(th) || th.id || '', value: text(cells[i]) });
    });
  }

  // <dt>/<dd> pairs.
  for (const dt of root.querySelectorAll('dt')) {
    fields.push({ label: text(dt), value: text(dt.nextElementSibling) });
  }
  return fields;
}

function findImage(root) {
  const images = Array.from(root.querySelectorAll('img'))
    .map((img) => img.getAttribute('src') || img.getAttribute('data-src') || '')
    .filter((src) => src && !src.startsWith('data:'));
  const amazonImage = images.find((src) => /images-amazon|media-amazon|ssl-images/i.test(src));
  const src = amazonImage ?? images.find((src) => /\.(jpe?g|png|webp)(\?|$)/i.test(src)) ?? null;
  if (!src) return null;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `https://qifcr.eu.aftx.amazonoperations.app${src}`;
  return src;
}

/**
 * Parses the FC Research "product" section for one ASIN.
 *
 * @param {string} html
 * @returns {{ found: boolean, highValue: boolean|null, imageUrl: string|null, title: string|null }}
 *   highValue=null means the High Value field wasn't found (unknown, not "no").
 */
export function parseProductHtml(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const root = doc.body;
  if (!root || !root.querySelector('table, dl, img')) {
    return { found: false, highValue: null, imageUrl: null, title: null };
  }

  const fields = collectFields(root);
  let highValue = null;
  for (const { label, value } of fields) {
    if (!isHighValueLabel(label)) continue;
    const v = value.toLowerCase();
    if (TRUE_VALUES.has(v)) {
      highValue = true;
      break;
    }
    if (FALSE_VALUES.has(v)) highValue = false;
  }

  const titleField = fields.find(({ label }) => key(label) === 'title' || key(label) === 'itemname');
  return {
    found: true,
    highValue,
    imageUrl: findImage(root),
    title: titleField?.value || null,
  };
}

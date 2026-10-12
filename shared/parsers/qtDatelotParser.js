import { normalizeLabel, normalizeValue, isBlank } from '../normalize.js';

/**
 * Normalized dt label -> output field name. normalizeLabel lowercases,
 * strips a trailing colon, and collapses whitespace, so "Owner:",
 * "owner", and " Owner : " all resolve to the same key.
 */
const LABEL_ALIASES = {
  title: 'title',
  fcsku: 'fcSku',
  quantity: 'quantity',
  owner: 'owner',
  'expiration date': 'expirationDate',
};

/**
 * Parses one product's dl.a-definition-list into a field map by walking
 * dt/dd children in document order and pairing each dt with the dd that
 * follows it. This tolerates whitespace text nodes between dt/dd, but does
 * not assume a fixed dt/dd count or order beyond "dd follows its dt".
 */
function parseDefinitionList(dl) {
  const product = { title: null, fcSku: null, quantity: null, owner: null, expirationDate: null };
  if (!dl) return product;

  let pendingField = null;
  for (const child of Array.from(dl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') {
      const alias = LABEL_ALIASES[normalizeLabel(child.textContent)];
      pendingField = alias ?? null;
    } else if (tag === 'dd') {
      if (pendingField) {
        const value = normalizeValue(child.textContent);
        product[pendingField] = isBlank(value) ? null : value;
      }
      pendingField = null;
    }
  }
  return product;
}

/**
 * Parses the "View Datelot Items" HTML fragment into structured product
 * records. Returns found=false when the fieldset isn't present at all,
 * which the caller should treat as "datelot screen not shown for this
 * tote" rather than as an error (per the EditItems workflow: this screen
 * only appears when expiration-dated items exist).
 *
 * @param {string} html
 * @returns {{ found: boolean, products: Array<{title: string|null, fcSku: string|null, quantity: string|null, owner: string|null, expirationDate: string|null}> }}
 */
export function parseQtDatelotHtml(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const fieldset = doc.querySelector('fieldset.a-box-group.a-form-control-group');

  if (!fieldset) {
    return { found: false, products: [] };
  }

  const boxes = Array.from(fieldset.querySelectorAll('div.a-box'));
  const products = boxes.map((box) => parseDefinitionList(box.querySelector('dl.a-definition-list')));

  return { found: true, products };
}

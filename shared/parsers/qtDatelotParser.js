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

function readAState(doc, key) {
  for (const script of doc.querySelectorAll('script[type="a-state"]')) {
    try {
      if (JSON.parse(script.getAttribute('data-a-state') ?? '{}').key === key) {
        return JSON.parse(script.textContent);
      }
    } catch {
      // not this one
    }
  }
  return null;
}

/**
 * Reads one full QT EditItems page (GET /app/edititems?experience=Desktop),
 * whatever step the server-side workflow is on.
 *
 * - objectId / instructionId: the workflow id every /action and /status call
 *   sends (from <script type="a-state" data-a-state='{"key":"id"}'>)
 * - screen: the step's heading, e.g. "Select item"
 * - hasTextInput: the step asks for a typed value (the tote scan screen)
 * - noDatelotItems: the step says the tote has no datelot items
 * - actions: every button's action name (data-click-action), e.g. "Done",
 *   "ViewDatelotItems"
 * - products: datelot items when the step is the item list (only dl's with
 *   an FCSku or an Expiration date count)
 *
 * @param {string} html
 */
export function parseQtPage(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const id = readAState(doc, 'id');
  const workflow = doc.querySelector('#workflow');
  const heading = workflow?.querySelector('.aft-tool-action-box h1') ?? workflow?.querySelector('h1');

  const readActions = (root) => {
    const found = [];
    for (const el of root.querySelectorAll('[data-click-action]')) {
      if (el.closest('.aft-tool-hide')) continue;
      try {
        const action = JSON.parse(el.getAttribute('data-click-action')).action;
        if (action && !found.includes(action)) found.push(action);
      } catch {
        // ignore malformed attribute
      }
    }
    return found;
  };
  const actions = readActions(workflow ?? doc);
  // Buttons outside #workflow too: "Confirm" on "Confirm change" and
  // "SelectMode" (Change mode, in the header) sit there.
  const pageActions = readActions(doc);

  // Radio choices of the step ("Select item": 0, 1…; "Select new inventory
  // state": INVENTORY, PENDING_RESEARCH…; "Select mode": EACH…). The
  // FCSku shown in an item's label is kept for picking the right item.
  const options = Array.from((workflow ?? doc).querySelectorAll('input[type="radio"]')).map((input) => {
    const label = input.closest('label') ?? input.parentElement;
    const details = parseDefinitionList(label?.querySelector('dl.a-definition-list'));
    return {
      value: input.getAttribute('value') ?? '',
      text: normalizeValue(label?.textContent ?? ''),
      fcSku: details.fcSku,
      quantity: details.quantity,
    };
  });

  const hasTextInput = Boolean(
    workflow?.querySelector('form input[type="text"], form input[type="search"], form input:not([type])')
  );

  const products = Array.from(doc.querySelectorAll('fieldset dl.a-definition-list'))
    .map(parseDefinitionList)
    .filter((p) => p.fcSku || p.expirationDate);

  // Visible error/warning boxes in the step itself (not the hidden status templates).
  const messages = Array.from(workflow?.querySelectorAll('.aft-tool-warn-box, .aft-tool-critical-box, .a-alert-content') ?? [])
    .filter((el) => !el.closest('.aft-tool-hide'))
    .map((el) => normalizeValue(el.textContent))
    .filter(Boolean);

  // "View Datelot Items" on a tote without dated items (seen live:
  // "No datelot items found in the container."). Hidden status templates
  // (.aft-tool-hide) are left out of the text.
  const visibleText = workflow
    ? normalizeValue(
        Array.from(workflow.childNodes)
          .filter((node) => !(node.nodeType === 1 && node.classList.contains('aft-tool-hide')))
          .map((node) => node.textContent)
          .join(' ')
      )
    : '';
  const noDatelotItems = /no datelot items/i.test(visibleText);

  return {
    found: Boolean(id?.objectId),
    noDatelotItems,
    objectId: id?.objectId ?? null,
    instructionId: id?.instructionId ?? null,
    status: id?.status ?? null,
    screen: normalizeValue(heading?.textContent ?? '') || null,
    hasTextInput,
    actions,
    pageActions,
    options,
    text: visibleText,
    products,
    messages,
  };
}

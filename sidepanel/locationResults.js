import { stowsForProduct, stowsIntoLocation, LOCATION_HISTORY_DAYS } from '../shared/locationStows.js';
import { describeHrv } from '../shared/resultsView.js';

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = textContent;
  return node;
}

/** One card per product (ASIN), merging the bin's rows of that product. */
function groupByProduct(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = (row.asin || row.fnSku || '').toUpperCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { ...row, quantityTotal: 0, containers: new Set() });
    const group = groups.get(key);
    const quantity = Number.parseInt(row.quantity, 10);
    if (Number.isFinite(quantity)) group.quantityTotal += quantity;
    if (row.container) group.containers.add(row.container);
  }
  return [...groups.values()];
}

function renderStows(events, historyStatus) {
  const box = el('div', 'stow-history');
  box.append(el('div', 'stow-history-title', 'Stow eden'));

  if (events.length === 0) {
    const reason =
      historyStatus === 'ok' || historyStatus === 'no_data' || historyStatus === 'not_found'
        ? `Son ${LOCATION_HISTORY_DAYS} günde bu lokasyona stow kaydı yok.`
        : 'Inventory History okunamadı.';
    box.append(el('div', 'stow-empty', reason));
    return box;
  }

  const list = el('ul', 'stow-list');
  for (const event of events) {
    const item = el('li', event.failed ? 'stow-failed' : null);
    item.append(
      el('strong', null, event.person ?? '?'),
      el('span', null, ` · ${event.quantity ?? '?'} adet · ${event.at}`),
      el('div', 'stow-shift', event.shift + (event.failed ? ' · PROBLEM_SOLVE (stow başarısız)' : ''))
    );
    list.append(item);
  }
  box.append(list);
  return box;
}

/**
 * Product cards for a bin or product-barcode lookup: image, HRV, and (for a
 * bin) who stowed each product there according to the bin's Inventory History.
 *
 * @param {HTMLElement} container
 * @param {{ kind: string, toteNumber: string, rows: object[], locationHistory?: object[], sourceStatus: object }} response
 */
export function renderLocationResults(container, response) {
  const isLocation = response.kind === 'location';
  const stowMap = isLocation ? stowsIntoLocation(response.locationHistory ?? [], response.toteNumber) : null;
  const products = groupByProduct(response.rows ?? []);

  if (products.length === 0) {
    container.replaceChildren(el('div', 'empty-state', 'Bu aramada ürün bulunamadı.'));
    return;
  }

  const cards = products.map((product) => {
    const card = el('article', 'product-card');

    const media = el('div', 'product-image');
    if (product.imageUrl) {
      const img = document.createElement('img');
      img.src = product.imageUrl;
      img.alt = product.title ?? product.asin ?? '';
      img.loading = 'lazy';
      img.addEventListener('error', () => media.replaceChildren(el('span', null, 'Görsel yok')));
      media.append(img);
    } else {
      media.append(el('span', null, 'Görsel yok'));
    }

    const info = el('div', 'product-info');
    const head = el('div', 'product-head');
    head.append(el('strong', null, product.asin ?? product.fnSku ?? '—'));
    if (product.highValue === true) head.append(el('span', 'badge-hrv', 'HRV'));
    info.append(head, el('div', 'product-title', product.title ?? ''));

    const meta = [`Adet: ${product.quantityTotal}`, `HRV: ${describeHrv(product)}`];
    if (!isLocation && product.containers.size > 0) meta.push(`Lokasyon: ${[...product.containers].join(', ')}`);
    info.append(el('div', 'product-meta', meta.join(' · ')));

    if (isLocation) info.append(renderStows(stowsForProduct(stowMap, product), response.sourceStatus?.history));

    card.append(media, info);
    return card;
  });

  container.replaceChildren(...cards);
}

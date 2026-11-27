// Barkod › Lokasyon: barcodes of the filled bins of an aisle, read from the
// StowMap BinStatus CSVs already loaded (no request), and on a click the
// product barcodes of a bin (LPN → X → B) from Inventory.
import { expandBin } from '../shared/stowMap.js';
import {
  describeLocationQuery,
  describeProductFilter,
  filledBins,
  filterProductRecords,
  groupBins,
  highValueAsins,
  parseLocationQuery,
  productBarcodes,
} from '../shared/locationBarcodes.js';
import { createBarcodeElement } from './barcodeDom.js';

// Same storage the StowMap tab writes (see stowMapTab.js).
const FLOORS_KEY = 'stowMap:floors';
const floorKey = (floor) => `stowMap:floor:${floor}`;
const QUERY_KEY = 'locationBarcodeQuery';
const OPTIONS_KEY = 'locationBarcodeOptions';
const MAX_PARALLEL_BINS = 4;
// Above this many bins the automatic product fetch asks first.
const AUTO_PRODUCTS_CONFIRM_ABOVE = 60;

const form = document.getElementById('locbar-form');
const input = document.getElementById('locbar-input');
const statusEl = document.getElementById('locbar-status');
const output = document.getElementById('locbar-output');
const hrvInput = document.getElementById('locbar-hrv');
const autoProductsInput = document.getElementById('locbar-auto-products');
const pendingInput = document.getElementById('locbar-pending');
const lpnInput = document.getElementById('locbar-lpn');
const hrvProductInput = document.getElementById('locbar-hrv-products');

function saveOptions() {
  chrome.storage.local.set({
    [OPTIONS_KEY]: {
      hrvOnly: hrvInput.checked,
      autoProducts: autoProductsInput.checked,
      pendingOnly: pendingInput.checked,
      lpnOnly: lpnInput.checked,
      hrvProductsOnly: hrvProductInput.checked,
    },
  });
}

// The filters redraw a shown list; the auto fetch applies from the next "Göster".
for (const filter of [hrvInput, pendingInput, lpnInput, hrvProductInput]) {
  filter.addEventListener('change', () => {
    saveOptions();
    if (output.childElementCount > 0) show();
  });
}
autoProductsInput.addEventListener('change', saveOptions);

// Each "Göster" is a new run; product fetches of an older run stop.
let runId = 0;

/* ---------- Liste / Lokasyon sub-tabs ---------- */

const subtabs = document.querySelectorAll('#tab-barcode .subtab');
for (const button of subtabs) {
  button.addEventListener('click', () => {
    for (const other of subtabs) other.classList.toggle('active', other === button);
    for (const pane of document.querySelectorAll('#tab-barcode .subtab-pane')) {
      pane.hidden = pane.id !== `barcode-pane-${button.dataset.subtab}`;
    }
    if (button.dataset.subtab === 'location') input.focus();
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(text, level = 'info') {
  statusEl.className = `locbar-status locbar-${level}`;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

/* ---------- product barcodes of one bin ---------- */

const KIND_LABELS = { lpn: 'LPN', fnsku: 'X', asin: 'B' };

/**
 * @param {{ pending?: boolean, lpn?: boolean, hrv?: boolean } | null} filters - product
 *   filters; when one is on, a bin without a matching product is hidden
 */
async function loadProducts(card, bin, filters) {
  const filtered = Boolean(filters);
  const box = card.querySelector('.locbar-products');
  const button = card.querySelector('.locbar-products-button');
  button.disabled = true;
  box.replaceChildren(el('div', 'hint', 'Ürünler getiriliyor…'));
  try {
    const response = await chrome.runtime.sendMessage({ type: 'BIN_INVENTORY', bin: bin.id });
    if (!response) throw new Error('Arka plan betiğinden yanıt alınamadı.');
    if (response.status !== 'ok' && response.status !== 'no_data' && response.status !== 'not_found') {
      throw new Error(response.message ?? `Inventory: ${response.status}`);
    }
    const records = filtered
      ? filterProductRecords(response.records, filters, highValueAsins(response.products))
      : response.records;
    const barcodes = productBarcodes(records);
    const productByAsin = new Map((response.products ?? []).map((p) => [p.asin, p]));
    card.dataset.state = barcodes.length > 0 ? 'found' : 'none';
    card.dataset.items = String(barcodes.length);
    card.dataset.units = String(barcodes.reduce((sum, item) => sum + item.quantity, 0));
    if (filtered) {
      // No matching product here: the bin drops out of the list.
      card.hidden = barcodes.length === 0;
    } else {
      card.classList.toggle('locbar-now-empty', barcodes.length === 0);
    }
    if (barcodes.length === 0) {
      box.replaceChildren(el('div', 'hint', "Inventory'de bu binde ürün yok (StowMap dosyası eski olabilir)."));
    } else {
      box.replaceChildren(
        ...barcodes.map((item) => {
          const product = productByAsin.get(item.asin);
          const row = el('div', 'locbar-product');
          const media = el('div', 'locbar-product-image');
          if (product?.imageUrl) {
            const img = document.createElement('img');
            img.src = product.imageUrl;
            img.alt = item.title ?? item.asin ?? '';
            img.loading = 'lazy';
            img.addEventListener('error', () => media.replaceChildren(el('span', 'image-missing', '—')));
            media.append(img);
          } else {
            media.append(el('span', 'image-missing', '—'));
          }
          const body = el('div', 'locbar-product-body');
          const meta = el('div', 'locbar-product-meta');
          if (product?.highValue === true) meta.append(el('span', 'badge-hrv', 'HRV'), document.createTextNode(' '));
          if (filters?.pending) meta.append(el('span', 'badge-pending', 'PENDING_RESEARCH'), document.createTextNode(' '));
          meta.append(`${KIND_LABELS[item.kind]} · ${item.quantity} adet${item.title ? ` · ${item.title}` : ''}`);
          body.append(createBarcodeElement(item.code), meta);
          row.append(media, body);
          return row;
        })
      );
    }
    button.textContent = 'Yenile';
  } catch (error) {
    // A failed bin stays on screen (with the error) so it isn't silently lost.
    card.dataset.state = 'error';
    card.hidden = false;
    box.replaceChildren(el('div', 'locbar-error', `✖ ${error?.message ?? error}`));
  } finally {
    button.disabled = false;
    card.onLoaded?.();
  }
}

function binCard(bin, filters) {
  const card = el('article', 'locbar-bin');
  const head = el('div', 'locbar-bin-head');
  head.append(el('span', 'locbar-units', `${bin.totalUnits} adet · ${bin.unique} çeşit`));
  const button = el('button', 'small-button locbar-products-button', 'Ürünler');
  button.type = 'button';
  button.addEventListener('click', () => loadProducts(card, bin, filters));
  head.append(button);
  card.append(createBarcodeElement(bin.id), head, el('div', 'locbar-products'));
  card.loadProducts = () => loadProducts(card, bin, filters);
  card.dataset.state = 'waiting';
  // With a product filter a bin is hidden until it shows a matching product.
  if (filters) card.hidden = true;
  return card;
}

async function loadAllProducts(cards, button, run = runId) {
  button.disabled = true;
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < cards.length && run === runId) {
      const card = cards[next++];
      await card.loadProducts();
      done += 1;
      button.textContent = `Getiriliyor… ${done}/${cards.length}`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_BINS, cards.length) }, worker));
  button.textContent = `Tüm ürünleri getir (${cards.length} bin)`;
  button.disabled = false;
}

/* ---------- search ---------- */

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('tr-TR');
}

// Product filter on (PENDING_RESEARCH / LPN'li / HRV): redrawn after every bin, so
// the shelf headings, the summary and the status line count the bins found so far.
function updateFilteredView(view) {
  if (view.run !== runId) return;
  for (const shelf of view.shelves) {
    const found = shelf.cards.filter((card) => !card.hidden).length;
    shelf.title.textContent = `Raf ${shelf.shelf} · ${found} bin`;
    shelf.group.hidden = found === 0;
  }
  for (const section of view.sections) {
    section.hidden = [...section.querySelectorAll('.locbar-shelf')].every((shelf) => shelf.hidden);
  }
  const checked = view.cards.filter((card) => card.dataset.state !== 'waiting').length;
  const foundCards = view.cards.filter((card) => card.dataset.state === 'found');
  const found = foundCards.length;
  const items = foundCards.reduce((sum, card) => sum + Number(card.dataset.items || 0), 0);
  const units = foundCards.reduce((sum, card) => sum + Number(card.dataset.units || 0), 0);
  const failed = view.cards.filter((card) => card.dataset.state === 'error').length;
  const failedNote = failed > 0 ? ` · ${failed} bin okunamadı` : '';
  const total = view.cards.length;
  view.summary.replaceChildren(
    el('span', null, view.baseSummary),
    document.createTextNode(' · '),
    el(
      'strong',
      found > 0 ? 'locbar-summary-pending' : null,
      checked < total
        ? `${view.label}: ${found} bin (kontrol ediliyor ${checked}/${total})`
        : `${view.label}: ${found} bin${found > 0 ? ` · ${units} adet · ${items} çeşit` : ''}`
    ),
    document.createTextNode(failedNote)
  );
  if (checked < total) {
    setStatus(
      `${view.range}: ${view.label} ürün aranıyor… ${checked}/${total} bin · ${found} binde bulundu${failedNote}. (${view.source})`,
      'info'
    );
  } else {
    setStatus(
      found > 0
        ? `${view.range}: ${total} dolu binden ${found} tanesinde ${view.label} ürün var${failedNote}. (${view.source})`
        : `${view.range}: ${total} dolu binde ${view.label} ürün yok${failedNote}. (${view.source})`,
      found > 0 ? 'ok' : failed > 0 ? 'warn' : 'info'
    );
  }
}

async function show() {
  const run = ++runId;
  const query = parseLocationQuery(input.value);
  output.replaceChildren();
  if (query.error) {
    setStatus(query.error, 'warn');
    return;
  }
  chrome.storage.local.set({ [QUERY_KEY]: input.value.trim() });

  const data = await chrome.storage.local.get([FLOORS_KEY, floorKey(query.floor)]);
  if (run !== runId) return;
  const stored = data[floorKey(query.floor)];
  if (!stored?.bins?.length) {
    setStatus(`⚠ Kat ${query.floor} için StowMap CSV'si yüklenmemiş. StowMap sekmesinden o katın BinStatus_Report dosyasını yükleyin.`, 'warn');
    return;
  }

  const bins = filledBins(stored.bins.map(expandBin), query, { hrvOnly: hrvInput.checked });
  const meta = data[FLOORS_KEY]?.[query.floor] ?? stored;
  const source = `StowMap: ${meta.fileName ?? 'dosya'}${meta.importedAt ? ` · ${formatDate(meta.importedAt)}` : ''}`;
  const range = describeLocationQuery(query);

  const productFilter = { pending: pendingInput.checked, lpn: lpnInput.checked, hrv: hrvProductInput.checked };
  const filterLabel = describeProductFilter(productFilter);
  const filters = filterLabel ? productFilter : null;
  const hrvNote = hrvInput.checked ? ' (sadece HRV alabilen)' : '';
  if (bins.length === 0) {
    setStatus(`${range}: dolu bin yok${hrvNote}. (${source})`, 'info');
    return;
  }
  // StowMap counts: units and Unique ASIN Count added up over the bins.
  const totalUnits = bins.reduce((sum, bin) => sum + bin.totalUnits, 0);
  const totalVariety = bins.reduce((sum, bin) => sum + bin.unique, 0);
  const baseSummary = `${bins.length} dolu bin · ${totalUnits} adet · ${totalVariety} çeşit${hrvNote}`;
  setStatus(`${range}: ${baseSummary}. (${source})`, 'ok');

  const cards = [];
  const shelves = [];
  const sections = groupBins(bins).map((aisle) => {
    const section = el('section', 'locbar-aisle');
    section.append(el('h3', null, `Koridor ${aisle.aisle}`));
    for (const shelf of aisle.shelves) {
      const group = el('div', 'locbar-shelf');
      const title = el('h4', null, `Raf ${shelf.shelf} · ${shelf.bins.length} bin`);
      group.append(title);
      const grid = el('div', 'locbar-grid');
      const shelfCards = [];
      for (const bin of shelf.bins) {
        const card = binCard(bin, filters);
        cards.push(card);
        shelfCards.push(card);
        grid.append(card);
      }
      shelves.push({ shelf: shelf.shelf, title, group, cards: shelfCards });
      group.append(grid);
      section.append(group);
    }
    return section;
  });

  const toolbar = el('div', 'locbar-toolbar');
  const allButton = el('button', null, `Tüm ürünleri getir (${cards.length} bin)`);
  allButton.type = 'button';
  allButton.addEventListener('click', () => loadAllProducts(cards, allButton, run));
  const printButton = el('button', null, 'Yazdır');
  printButton.type = 'button';
  printButton.addEventListener('click', () => {
    document.body.classList.add('printing-locbar');
    window.print();
    document.body.classList.remove('printing-locbar');
  });
  toolbar.append(allButton, printButton);

  // Under the buttons: bins, units and variety; with a product filter also
  // how many bins hold a matching product.
  const summary = el('div', 'locbar-summary', baseSummary);

  output.replaceChildren(toolbar, summary, ...sections);

  if (filters) {
    const view = { run, range, source, sections, shelves, cards, summary, baseSummary, label: filterLabel };
    for (const card of cards) card.onLoaded = () => updateFilteredView(view);
    updateFilteredView(view);
  }

  // PENDING_RESEARCH / LPN are only in Inventory (HRV in FC Research), so a product filter always fetches.
  if (autoProductsInput.checked || filters) {
    const ok =
      cards.length <= AUTO_PRODUCTS_CONFIRM_ABOVE ||
      window.confirm(
        `${cards.length} binin ürünleri getirilecek: ${cards.length} Inventory isteği + her yeni ürün için bir FC Research isteği. ` +
          'Bu biraz sürebilir; raf raf (ör. P-1-A219D) aramak daha hızlıdır. Devam edilsin mi?'
      );
    if (!ok) {
      if (filters) {
        // Not fetched: show every bin so its "Ürünler" button can be used one by one.
        for (const card of cards) card.hidden = false;
        for (const shelf of shelves) shelf.group.hidden = false;
        for (const section of sections) section.hidden = false;
        setStatus(`${range}: ${filterLabel} için ürünler getirilmedi. Binleri tek tek "Ürünler" ile açabilirsiniz. (${source})`, 'warn');
      }
      return;
    }
    await loadAllProducts(cards, allButton, run);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  show();
});

setStatus('');
chrome.storage.local.get([QUERY_KEY, OPTIONS_KEY]).then((data) => {
  input.value = data[QUERY_KEY] ?? '';
  hrvInput.checked = data[OPTIONS_KEY]?.hrvOnly === true;
  autoProductsInput.checked = data[OPTIONS_KEY]?.autoProducts === true;
  pendingInput.checked = data[OPTIONS_KEY]?.pendingOnly === true;
  lpnInput.checked = data[OPTIONS_KEY]?.lpnOnly === true;
  hrvProductInput.checked = data[OPTIONS_KEY]?.hrvProductsOnly === true;
});

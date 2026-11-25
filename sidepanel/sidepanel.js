import {
  COLUMNS,
  columnsForKind,
  dedupeDropZoneDisplay,
  describeSourceStatus,
  filterRows,
  hasHighValue,
  renderRows,
  reorderColumns,
} from '../shared/resultsView.js';
import {
  cellHighlightClass,
  dropZoneColumnClass,
  evaluateTote,
  TOTE_SCAN_CODE,
  hasNotPermitted,
  isMoveNeeded,
} from '../shared/toteChecks.js';
import { classifyLookupInput } from '../shared/lookupInput.js';
import { isFeatureAllowed } from '../shared/access.js';
import { renderUserResults } from './userResults.js';
import { renderLocationResults } from './locationResults.js';

const form = document.getElementById('search-form');
const toteInput = document.getElementById('tote-input');
const searchButton = document.getElementById('search-button');
const retryButton = document.getElementById('retry-button');
const loadingEl = document.getElementById('loading');
const sourceStatusEl = document.getElementById('source-status');
const toteVerdictEl = document.getElementById('tote-verdict');
const filterBarEl = document.getElementById('filter-bar');
const showImagesInput = document.getElementById('show-images');

// Per-viewer preference only: browser storage may be unavailable.
const SHOW_IMAGES_KEY = 'showProductImages';
function readShowImages() {
  try {
    return localStorage.getItem(SHOW_IMAGES_KEY) !== 'false';
  } catch {
    return true;
  }
}
showImagesInput.checked = readShowImages();
showImagesInput.addEventListener('change', () => {
  try {
    localStorage.setItem(SHOW_IMAGES_KEY, String(showImagesInput.checked));
  } catch {
    // keep the choice for this session only
  }
  buildTableHead();
  applyFilterAndRender();
});

function visibleColumns() {
  const columns = columnsForKind(currentColumns, lastKind, { showImages: showImagesInput.checked });
  // "İşlem" only when a row can be changed to Sellable.
  const showSellable = sellableAllowed && lastRows.some(needsSellableFix);
  return showSellable ? columns : columns.filter((column) => column.key !== 'sellableAction');
}
const filterInput = document.getElementById('filter-input');
const resultsWrapperEl = document.getElementById('results-wrapper');
const resultsHeadEl = document.getElementById('results-head');
const resultsBodyEl = document.getElementById('results-body');
const toastEl = document.getElementById('toast');
const lastToteEl = document.getElementById('last-tote');
const lastToteValueEl = document.getElementById('last-tote-value');
const copyToteButton = document.getElementById('copy-tote-button');
const copyFeedbackEl = document.getElementById('copy-feedback');
const autoCopyInput = document.getElementById('auto-copy-input');
const userResultsEl = document.getElementById('user-results');
const locationResultsEl = document.getElementById('location-results');
const lastToteKindEl = document.getElementById('last-tote-kind');

const COLUMN_ORDER_STORAGE_KEY = 'toteLookupColumnOrder';
const AUTO_COPY_STORAGE_KEY = 'toteLookupAutoCopy';
// Optional slow sources, asked only when their box is ticked (remembered).
const SOURCE_TOGGLE_STORAGE_KEY = 'toteLookupOptionalSources';
const sourceToggleInputs = {
  qt: document.getElementById('source-qt-input'),
  sideline: document.getElementById('source-sideline-input'),
};

function selectedSources() {
  return Object.fromEntries(Object.entries(sourceToggleInputs).map(([key, input]) => [key, input.checked]));
}

async function loadSourceToggles() {
  const data = await chrome.storage.local.get(SOURCE_TOGGLE_STORAGE_KEY);
  const stored = data[SOURCE_TOGGLE_STORAGE_KEY] ?? {};
  for (const [key, input] of Object.entries(sourceToggleInputs)) input.checked = stored[key] === true;
}

for (const input of Object.values(sourceToggleInputs)) {
  input.addEventListener('change', () => {
    chrome.storage.local.set({ [SOURCE_TOGGLE_STORAGE_KEY]: selectedSources() });
    toteInput.focus();
  });
}
const COPY_FEEDBACK_MS = 1500;
const NOT_PERMITTED_TOAST_MESSAGE = 'NOT_PERMITTED ISS';
const HRV_TOAST_MESSAGE = 'HRV ÜRÜN';
const TOAST_DURATION_MS = 2000;

let lastRows = [];
let lastToteNumber = '';
let lastKind = 'container';
let currentColumns = COLUMNS;
let draggedColumnKey = null;
let toastTimeoutId = null;
const toastQueue = [];
let copyFeedbackTimeoutId = null;

async function copyToteNumber(toteNumber) {
  if (!toteNumber) return;
  try {
    await navigator.clipboard.writeText(toteNumber);
  } catch {
    showToast('Kopyalanamadı');
    return;
  }
  if (copyFeedbackTimeoutId) clearTimeout(copyFeedbackTimeoutId);
  copyFeedbackEl.hidden = false;
  copyFeedbackTimeoutId = setTimeout(() => {
    copyFeedbackEl.hidden = true;
  }, COPY_FEEDBACK_MS);
}

function showLastTote(toteNumber, kindLabel = 'tote') {
  lastToteKindEl.textContent = kindLabel;
  lastToteValueEl.textContent = toteNumber;
  lastToteEl.hidden = false;
}

async function loadAutoCopy() {
  const data = await chrome.storage.local.get(AUTO_COPY_STORAGE_KEY);
  autoCopyInput.checked = data[AUTO_COPY_STORAGE_KEY] ?? true;
}

function showNextToast() {
  const next = toastQueue.shift();
  if (!next) {
    toastEl.hidden = true;
    toastTimeoutId = null;
    return;
  }
  toastEl.textContent = next.message;
  toastEl.className = next.variant ? `toast-${next.variant}` : '';
  toastEl.hidden = false;
  toastTimeoutId = setTimeout(showNextToast, next.durationMs);
}

/**
 * Shows a short message at the bottom. Toasts raised together (e.g.
 * NOT_PERMITTED and HRV for the same tote) are shown one after another.
 * @param {string} message
 * @param {{ variant?: 'info', durationMs?: number }} [options] - 'info' = blue
 */
function showToast(message, { variant = null, durationMs = TOAST_DURATION_MS } = {}) {
  toastQueue.push({ message, variant, durationMs });
  if (!toastTimeoutId) showNextToast();
}

// New lookup: drop toasts still waiting from the previous one.
function clearToasts() {
  toastQueue.length = 0;
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = null;
  toastEl.hidden = true;
}

async function loadColumnOrder() {
  const data = await chrome.storage.local.get(COLUMN_ORDER_STORAGE_KEY);
  currentColumns = reorderColumns(data[COLUMN_ORDER_STORAGE_KEY]);
}

function saveColumnOrder() {
  chrome.storage.local.set({ [COLUMN_ORDER_STORAGE_KEY]: currentColumns.map((c) => c.key) });
}

function moveColumn(draggedKey, targetKey) {
  if (draggedKey === targetKey) return;

  const keys = currentColumns.map((c) => c.key);
  const fromIndex = keys.indexOf(draggedKey);
  if (fromIndex === -1) return;
  keys.splice(fromIndex, 1);

  const toIndex = keys.indexOf(targetKey);
  if (toIndex === -1) return;
  keys.splice(toIndex, 0, draggedKey);

  currentColumns = reorderColumns(keys);
  saveColumnOrder();
  buildTableHead();
  applyFilterAndRender();
}

function buildTableHead() {
  const tr = document.createElement('tr');
  for (const column of visibleColumns()) {
    const th = document.createElement('th');
    th.textContent = column.label;
    th.draggable = true;
    th.dataset.columnKey = column.key;
    th.title = 'Sütunu yeniden sıralamak için sürükleyin';

    th.addEventListener('dragstart', (event) => {
      draggedColumnKey = column.key;
      event.dataTransfer.effectAllowed = 'move';
      th.classList.add('dragging');
    });

    th.addEventListener('dragend', () => {
      draggedColumnKey = null;
      th.classList.remove('dragging');
    });

    th.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    th.addEventListener('drop', (event) => {
      event.preventDefault();
      if (draggedColumnKey) moveColumn(draggedColumnKey, column.key);
    });

    tr.appendChild(th);
  }
  resultsHeadEl.replaceChildren(tr);
}

const ERROR_STATUSES = new Set([
  'auth_required',
  'request_failed',
  'network_error',
  'error',
  'content_script_unreachable',
]);
const WARN_STATUSES = new Set([
  'no_data',
  'not_found',
  'skipped_no_asin',
  'no_datelot_screen',
  'no_qt_tab',
  'partial_failure',
]);

// Normal answers that just mean "nothing to show" (green like ok).
const OK_STATUSES = new Set(['ok', 'no_datelot_items']);

function badgeClass(status) {
  if (OK_STATUSES.has(status)) return 'ok';
  if (ERROR_STATUSES.has(status)) return 'error';
  if (WARN_STATUSES.has(status)) return 'warn';
  return 'warn';
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} sn`;
}

function renderSourceStatus(sourceStatus, sourceMessages = {}, timings = {}) {
  const labels = {
    inventory: 'Inventory',
    pandash: 'Pandash',
    product: 'Ürün (HRV)',
    prep: 'Prep',
    sideline: 'Sideline',
    qt: 'QT',
    history: 'Inventory History',
  };
  const badges = Object.entries(sourceStatus).map(([key, status]) => {
    const badge = document.createElement('span');
    badge.className = `status-badge ${badgeClass(status)}`;
    const time = typeof timings[key] === 'number' ? ` · ${formatSeconds(timings[key])}` : '';
    badge.textContent = `${labels[key] ?? key}: ${describeSourceStatus(status)}${time}`;
    if (sourceMessages[key]) badge.title = sourceMessages[key];
    return badge;
  });

  // Why a source failed, written out (not only on hover) so it can be read
  // and copied; normal answers keep it in the tooltip only.
  const details = Object.entries(sourceMessages)
    .filter(([key]) => sourceStatus[key] && !OK_STATUSES.has(sourceStatus[key]))
    .map(([key, message]) => buildSourceMessage(`${labels[key] ?? key}: ${message}`));

  if (typeof timings.total === 'number') {
    const total = document.createElement('span');
    total.className = 'status-badge ok';
    total.textContent = `Toplam: ${formatSeconds(timings.total)} (${timings.asins ?? 0} ürün)`;
    badges.push(total);
  }

  sourceStatusEl.replaceChildren(...badges, ...details);
}

function buildSourceMessage(text) {
  const box = document.createElement('div');
  box.className = 'source-message';
  const body = document.createElement('span');
  body.className = 'source-message-text';
  body.textContent = text;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'source-message-copy';
  copy.textContent = 'Kopyala';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Kopyalandı ✔';
    } catch {
      copy.textContent = 'Kopyalanamadı';
    }
    setTimeout(() => {
      copy.textContent = 'Kopyala';
    }, 1500);
  });
  box.append(body, copy);
  return box;
}

function setLoading(isLoading) {
  loadingEl.hidden = !isLoading;
  searchButton.disabled = isLoading;
  toteInput.disabled = isLoading;
}

// Readies the input for the next scan: clears it and puts the cursor back,
// so a barcode scanner can fire the next tote without any mouse interaction.
function prepareForNextScan() {
  toteInput.value = '';
  toteInput.placeholder = lastToteNumber
    ? `Son aranan: ${lastToteNumber} — yeni tote okutun`
    : 'Tote, lokasyon, ASIN/LPN veya kullanıcı adı girin';
  toteInput.focus();
}

// Totes and csX can be opened at a Receive station to clear "Tote Taraması".
const RECEIVE_OPENABLE = /^(ts|cs)x/i;

/**
 * "Receive'de aç" button: opens the tote as the PRIMARY container at a free
 * Receive station (background tries the stations in order) and stops there.
 */
function buildReceiveOpener(toteNumber) {
  const box = document.createElement('div');
  box.className = 'receive-opener';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = "Receive'de aç";
  const status = document.createElement('div');
  status.className = 'receive-status';
  status.hidden = true;

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.hidden = false;
    status.className = 'receive-status';
    status.textContent = `${toteNumber} Receive'de açılıyor…`;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RECEIVE_OPEN_TOTE', toteNumber });
      if (!response) throw new Error('Arka plan betiğinden yanıt alınamadı.');
      if (response.status === 'ok') {
        const count = response.container?.itemCount;
        status.classList.add('receive-ok');
        status.textContent = `✔ ${toteNumber} ${response.workstation} masasında açıldı${
          Number.isFinite(count) ? ` · ${count} ürün` : ''
        }. Tote'u yeniden aratın.`;
      } else {
        status.classList.add('receive-error');
        status.textContent = `✖ ${response.message ?? 'Açılamadı.'}`;
        button.disabled = false;
      }
      if (response.log?.length) status.title = response.log.join(' → ');
    } catch (error) {
      status.classList.add('receive-error');
      status.textContent = `✖ ${error?.message ?? error}`;
      button.disabled = false;
    }
  });

  box.append(button, status);
  return box;
}

// "Sellable'a çek": PENDING_RESEARCH / EXPIRED rows are changed to Sellable
// in QT (EACH mode, one unit per pass). Only on a click, after a confirm.
let sellableAllowed = false;
// Rows being changed right now (by scan value), so a re-render while the
// run is going keeps their button disabled.
const sellableRunning = new Set();

function needsSellableFix(row) {
  const consumer = (row.consumer ?? '').trim().toUpperCase();
  const disposition = (row.disposition ?? '').trim().toUpperCase();
  return consumer === 'PENDING_RESEARCH' || disposition === 'EXPIRED';
}

function sellableItemOf(row) {
  return { scan: row.lpn || row.fcSku || row.asin || '', fcSku: row.fcSku ?? null, quantity: Number(row.quantity) };
}

function describeSellableResult(responses) {
  const items = responses.flatMap((response) => response.items ?? []);
  const ok = items.filter((item) => item.status === 'ok');
  const units = items.reduce((sum, item) => sum + (item.changed ?? 0), 0);
  const parts = [];
  if (ok.length > 0) parts.push(`✔ ${ok.length}/${items.length} ürün Sellable (${units} adet)`);
  for (const item of items) {
    if (item.status === 'ok') continue;
    if (item.status === 'skipped') {
      parts.push(`– ${item.scan}: yapılmadı`);
      continue;
    }
    const done = item.changed > 0 ? ` (${item.changed}/${item.quantity} yapıldı)` : '';
    parts.push(`✖ ${item.scan}${done}: ${item.message ?? 'başarısız'}`);
  }
  for (const response of responses) if (response.message) parts.push(response.message);
  return parts.join(' · ') || 'Sonuç alınamadı.';
}

/**
 * Changes `rows` to Sellable. Rows of one container go in one QT run
 * (one mode pick, one tote scan, one "Change container"); QT allows one
 * workflow per user, so the items themselves go one after another.
 */
async function runSellableFix(rows) {
  const groups = new Map();
  for (const row of rows) {
    // The row's own container (the tote QT has to open), else the scanned one.
    const tote = row.container || lastToteNumber;
    if (!groups.has(tote)) groups.set(tote, []);
    groups.get(tote).push(sellableItemOf(row));
  }
  const all = [...groups.values()].flat();
  const units = all.reduce((sum, item) => sum + item.quantity, 0);
  const list = all.slice(0, 15).map((item) => `• ${item.scan} (${item.quantity} adet)`).join('
');
  const more = all.length > 15 ? `
… ve ${all.length - 15} ürün daha` : '';
  const ok = window.confirm(
    `${[...groups.keys()].join(', ')} içindeki ${all.length} ürün (${units} adet) QT'de Sellable'a çekilecek:

${list}${more}

` +
      "QT EACH moduna alınır, her adet okutulup Inventory'ye (UNOWNED / SELLABLE) onaylanır. Devam edilsin mi?"
  );
  if (!ok) return;

  for (const item of all) sellableRunning.add(item.scan);
  applyFilterAndRender();
  const responses = [];
  try {
    for (const [toteNumber, items] of groups) {
      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: 'QT_CHANGE_TO_SELLABLE', toteNumber, items });
        if (!response) throw new Error('Arka plan betiğinden yanıt alınamadı.');
      } catch (error) {
        response = { status: 'error', message: String(error?.message ?? error), items: [] };
      }
      if (response.log?.length) console.info(`[tote-lookup] Sellable adımları (${toteNumber}):`, response.log.join(' → '));
      responses.push(response);
    }
  } finally {
    sellableRunning.clear();
  }

  // Search the tote again so the table shows what Inventory says now.
  if (lastKind === 'container' && lastToteNumber) await runLookup(lastToteNumber, 'container');
  else applyFilterAndRender();
  const allOk = responses.every((response) => response.status === 'ok');
  showToast(describeSellableResult(responses), { variant: allOk ? 'info' : null, durationMs: allOk ? 6000 : 20000 });
}

/** "Tümünü Sellable'a çek" in the verdict, when more than one row needs it. */
function buildSellableAllButton(rows) {
  const eligible = sellableAllowed ? rows.filter((row) => needsSellableFix(row) && sellableItemOf(row).scan) : [];
  if (eligible.length < 2) return null;
  const units = eligible.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const box = document.createElement('div');
  box.className = 'receive-opener';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Tümünü Sellable'a çek (${eligible.length} ürün, ${units} adet)`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = `Çekiliyor… (${eligible.length} ürün)`;
    await runSellableFix(eligible);
    button.disabled = false;
  });
  box.appendChild(button);
  return box;
}

function buildSellableButton(row) {
  if (!sellableAllowed || lastKind !== 'container' || !row.container || !needsSellableFix(row)) return null;
  const item = sellableItemOf(row);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sellable-button';
  const running = sellableRunning.has(item.scan);
  button.textContent = running ? 'Çekiliyor…' : "Sellable'a çek";
  button.disabled = running || sellableRunning.size > 0 || !item.scan;
  button.title = item.scan ? `${item.scan} · ${item.quantity} adet` : 'LPN / FCSku yok';
  // The row's own container (the tote QT has to open), else the scanned one.
  button.addEventListener('click', () => runSellableFix([row]));
  return button;
}

// Always evaluated on the full tote (lastRows), never the filtered view,
// so typing in the filter box can't make a tote look ready.
function renderToteVerdict(rows, options) {
  const verdict = evaluateTote(rows, options);
  if (!verdict) {
    toteVerdictEl.hidden = true;
    toteVerdictEl.replaceChildren();
    return;
  }

  const items = [];
  if (verdict.ready) {
    const ready = document.createElement('div');
    ready.className = 'verdict verdict-ready';
    ready.textContent = "✔ Ürün Stow'a hazır";
    const note = document.createElement('div');
    note.className = 'verdict-note';
    note.textContent = 'Fiziksel doğrulama gerekir — toplam ürün ve çeşit sayısını kontrol edin.';
    ready.appendChild(note);
    items.push(ready);
  } else {
    for (const finding of verdict.findings) {
      const el = document.createElement('div');
      el.className = `verdict verdict-${finding.level}`;
      const icon = { action: '✖', move: '➜', warn: '⚠', info: 'ℹ' }[finding.level] ?? '•';
      el.textContent = `${icon} ${finding.message}`;
      if (finding.code === TOTE_SCAN_CODE && RECEIVE_OPENABLE.test(lastToteNumber)) {
        el.appendChild(buildReceiveOpener(lastToteNumber));
      }
      items.push(el);
    }
  }

  // Every PENDING_RESEARCH / EXPIRED row of the tote at once.
  const sellableAll = buildSellableAllButton(rows);
  if (sellableAll) {
    sellableAll.classList.add('verdict', 'verdict-action');
    items.push(sellableAll);
  }

  const counts = document.createElement('div');
  counts.className = 'verdict-counts';
  counts.textContent = `Toplam ürün: ${verdict.totalQuantity} · Çeşit: ${verdict.variety}`;
  items.push(counts);

  toteVerdictEl.replaceChildren(...items);
  toteVerdictEl.hidden = false;
}

function applyFilterAndRender() {
  const filtered = filterRows(lastRows, filterInput.value);
  const highlightContext = {
    moveNeeded: isMoveNeeded(lastRows),
    columnClass: dropZoneColumnClass(lastRows),
  };
  const columns = visibleColumns();
  renderRows(resultsBodyEl, dedupeDropZoneDisplay(filtered), columns, (row, key) =>
    key === 'hrv'
      ? row.highValue === true
        ? 'cell-hrv'
        : null
      : cellHighlightClass(row, key, highlightContext),
    (row) => buildSellableButton(row)
  );
}

/**
 * Tote, bin (location) or product barcode lookup.
 * @param {string} toteNumber - the scanned value
 * @param {'container'|'location'|'product'} [kind]
 */
async function runLookup(toteNumber, kind = 'container') {
  setLoading(true);
  clearToasts();
  retryButton.hidden = true;
  userResultsEl.hidden = true;
  locationResultsEl.hidden = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP_TOTE', toteNumber, kind, sources: selectedSources() });
    if (!response) {
      throw new Error('Arka plan betiğinden yanıt alınamadı.');
    }

    lastRows = response.rows ?? [];
    lastKind = kind;
    sellableAllowed = kind === 'container' && (await isFeatureAllowed('sellableFix'));
    buildTableHead();
    renderSourceStatus(response.sourceStatus ?? {}, response.sourceMessages ?? {}, response.timings ?? {});
    const pandashStatus = response.sourceStatus?.pandash;
    // A failed (or partly failed) Pandash request leaves DropZones unknown;
    // only a real "no value" answer may be read as NOT_PERMITTED.
    const pandashOk = !ERROR_STATUSES.has(pandashStatus) && pandashStatus !== 'partial_failure';
    // Stow-readiness rules are about a tote; a bin or product search skips them.
    const isTote = kind === 'container';
    renderToteVerdict(isTote ? lastRows : [], { pandashOk, qtStatus: response.sourceStatus?.qt });
    filterBarEl.hidden = false;
    resultsWrapperEl.hidden = false;
    applyFilterAndRender();

    if (!isTote) {
      renderLocationResults(locationResultsEl, { ...response, kind });
      locationResultsEl.hidden = false;
    }

    if (isTote && pandashOk && hasNotPermitted(lastRows)) {
      showToast(NOT_PERMITTED_TOAST_MESSAGE);
    }
    if (hasHighValue(lastRows)) {
      showToast(HRV_TOAST_MESSAGE, { variant: 'info' });
    }
  } catch (error) {
    renderToteVerdict([]);
    renderErrorBadge(error?.message ?? error);
    retryButton.hidden = false;
  } finally {
    setLoading(false);
    // Disabling the input during loading drops its focus; restore it here.
    prepareForNextScan();
  }
}

function hideToteResults() {
  renderToteVerdict([]);
  locationResultsEl.hidden = true;
  filterBarEl.hidden = true;
  resultsWrapperEl.hidden = true;
}

function renderErrorBadge(message) {
  const badge = document.createElement('span');
  badge.className = 'status-badge error';
  badge.textContent = `Hata: ${message}`;
  sourceStatusEl.replaceChildren(badge);
}

// Opens one of the associate's containers in the normal tote view.
function openContainer(scannableId) {
  lastToteNumber = scannableId;
  showLastTote(scannableId);
  runLookup(scannableId);
}

/**
 * Associate lookup (letters-only input): lists the totes/csX on
 * pc99<login> with a barcode each, plus their Inventory contents.
 */
async function runUserLookup({ login, query }) {
  setLoading(true);
  clearToasts();
  retryButton.hidden = true;
  hideToteResults();
  userResultsEl.hidden = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP_USER', login, query });
    if (!response) throw new Error('Arka plan betiğinden yanıt alınamadı.');
    if (response.status === 'error') throw new Error(response.message ?? 'İstek başarısız');

    renderSourceStatus({ 'FC Research': response.status });
    renderUserResults(userResultsEl, response, openContainer);
    userResultsEl.hidden = false;
  } catch (error) {
    renderErrorBadge(error?.message ?? error);
    retryButton.hidden = false;
  } finally {
    setLoading(false);
    prepareForNextScan();
  }
}

async function runSearch(value) {
  const input = classifyLookupInput(value);
  if (!input) return;
  lastToteNumber = input.query;
  showLastTote(input.query, input.label.toLocaleLowerCase('tr'));
  if (input.kind === 'user') {
    if (await isFeatureAllowed('userLookup')) runUserLookup(input);
    else {
      renderErrorBadge('Kullanıcı araması bu profilde kapalı.');
      prepareForNextScan();
    }
    return;
  }
  if (autoCopyInput.checked) copyToteNumber(input.query);
  runLookup(input.query, input.kind);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch(toteInput.value);
});

retryButton.addEventListener('click', () => {
  if (lastToteNumber) runSearch(lastToteNumber);
});

filterInput.addEventListener('input', applyFilterAndRender);

copyToteButton.addEventListener('click', () => {
  copyToteNumber(lastToteNumber);
  toteInput.focus();
});

autoCopyInput.addEventListener('change', () => {
  chrome.storage.local.set({ [AUTO_COPY_STORAGE_KEY]: autoCopyInput.checked });
  toteInput.focus();
});

// When the panel regains focus (e.g. after clicking into a web page), jump back
// to the tote input unless the user is deliberately typing in the filter box
// or is on another tab (e.g. Rapor).
const lookupPanelEl = document.getElementById('tab-lookup');
window.addEventListener('focus', () => {
  if (lookupPanelEl.hidden) return;
  if (document.activeElement !== filterInput && !toteInput.disabled) {
    toteInput.focus();
  }
});

async function init() {
  await Promise.all([loadColumnOrder(), loadAutoCopy(), loadSourceToggles()]);
  buildTableHead();
  toteInput.focus();
}

init();

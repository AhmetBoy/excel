import {
  COLUMNS,
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
  hasNotPermitted,
  isMoveNeeded,
} from '../shared/toteChecks.js';
import { classifyLookupInput } from '../shared/lookupInput.js';
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
const COPY_FEEDBACK_MS = 1500;
const NOT_PERMITTED_TOAST_MESSAGE = 'NOT_PERMITTED ISS';
const HRV_TOAST_MESSAGE = 'HRV ÜRÜN';
const TOAST_DURATION_MS = 2000;

let lastRows = [];
let lastToteNumber = '';
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
  for (const column of currentColumns) {
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

function badgeClass(status) {
  if (status === 'ok') return 'ok';
  if (ERROR_STATUSES.has(status)) return 'error';
  if (WARN_STATUSES.has(status)) return 'warn';
  return 'warn';
}

function renderSourceStatus(sourceStatus) {
  const labels = {
    inventory: 'Inventory',
    pandash: 'Pandash',
    product: 'Ürün (HRV)',
    sideline: 'Sideline',
    qt: 'QT',
    history: 'Inventory History',
  };
  sourceStatusEl.replaceChildren(
    ...Object.entries(sourceStatus).map(([key, status]) => {
      const badge = document.createElement('span');
      badge.className = `status-badge ${badgeClass(status)}`;
      badge.textContent = `${labels[key] ?? key}: ${describeSourceStatus(status)}`;
      return badge;
    })
  );
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
      items.push(el);
    }
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
  renderRows(resultsBodyEl, dedupeDropZoneDisplay(filtered), currentColumns, (row, key) =>
    key === 'hrv'
      ? row.highValue === true
        ? 'cell-hrv'
        : null
      : cellHighlightClass(row, key, highlightContext)
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
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP_TOTE', toteNumber, kind });
    if (!response) {
      throw new Error('Arka plan betiğinden yanıt alınamadı.');
    }

    lastRows = response.rows ?? [];
    renderSourceStatus(response.sourceStatus ?? {});
    const pandashStatus = response.sourceStatus?.pandash;
    // A failed (or partly failed) Pandash request leaves DropZones unknown;
    // only a real "no value" answer may be read as NOT_PERMITTED.
    const pandashOk = !ERROR_STATUSES.has(pandashStatus) && pandashStatus !== 'partial_failure';
    // Stow-readiness rules are about a tote; a bin or product search skips them.
    const isTote = kind === 'container';
    renderToteVerdict(isTote ? lastRows : [], { pandashOk });
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

function runSearch(value) {
  const input = classifyLookupInput(value);
  if (!input) return;
  lastToteNumber = input.query;
  showLastTote(input.query, input.label.toLocaleLowerCase('tr'));
  if (input.kind === 'user') {
    runUserLookup(input);
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
  await Promise.all([loadColumnOrder(), loadAutoCopy()]);
  buildTableHead();
  toteInput.focus();
}

init();

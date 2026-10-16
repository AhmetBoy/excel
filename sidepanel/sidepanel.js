import {
  COLUMNS,
  dedupeDropZoneDisplay,
  describeSourceStatus,
  filterRows,
  renderRows,
  reorderColumns,
} from '../shared/resultsView.js';
import { cellHighlightClass, evaluateTote, hasNotPermitted, isMoveNeeded } from '../shared/toteChecks.js';

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

const COLUMN_ORDER_STORAGE_KEY = 'toteLookupColumnOrder';
const AUTO_COPY_STORAGE_KEY = 'toteLookupAutoCopy';
const COPY_FEEDBACK_MS = 1500;
const NOT_PERMITTED_TOAST_MESSAGE = 'NOT_PERMITTED ISS';
const TOAST_DURATION_MS = 2000;

let lastRows = [];
let lastToteNumber = '';
let currentColumns = COLUMNS;
let draggedColumnKey = null;
let toastTimeoutId = null;
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

function showLastTote(toteNumber) {
  lastToteValueEl.textContent = toteNumber;
  lastToteEl.hidden = false;
}

async function loadAutoCopy() {
  const data = await chrome.storage.local.get(AUTO_COPY_STORAGE_KEY);
  autoCopyInput.checked = data[AUTO_COPY_STORAGE_KEY] ?? true;
}

function showToast(message, durationMs = TOAST_DURATION_MS) {
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastTimeoutId = setTimeout(() => {
    toastEl.hidden = true;
  }, durationMs);
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
  const labels = { inventory: 'Inventory', pandash: 'Pandash', qt: 'QT' };
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
    : 'Tote / TOT numarası girin';
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
  const highlightContext = { moveNeeded: isMoveNeeded(lastRows) };
  renderRows(resultsBodyEl, dedupeDropZoneDisplay(filtered), currentColumns, (row, key) =>
    cellHighlightClass(row, key, highlightContext)
  );
}

async function runLookup(toteNumber) {
  setLoading(true);
  retryButton.hidden = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP_TOTE', toteNumber });
    if (!response) {
      throw new Error('Arka plan betiğinden yanıt alınamadı.');
    }

    lastRows = response.rows ?? [];
    renderSourceStatus(response.sourceStatus ?? {});
    const pandashStatus = response.sourceStatus?.pandash;
    // A failed (or partly failed) Pandash request leaves DropZones unknown;
    // only a real "no value" answer may be read as NOT_PERMITTED.
    const pandashOk = !ERROR_STATUSES.has(pandashStatus) && pandashStatus !== 'partial_failure';
    renderToteVerdict(lastRows, { pandashOk });
    filterBarEl.hidden = false;
    resultsWrapperEl.hidden = false;
    applyFilterAndRender();

    if (pandashOk && hasNotPermitted(lastRows)) {
      showToast(NOT_PERMITTED_TOAST_MESSAGE);
    }
  } catch (error) {
    renderToteVerdict([]);
    sourceStatusEl.replaceChildren();
    const badge = document.createElement('span');
    badge.className = 'status-badge error';
    badge.textContent = `Hata: ${error?.message ?? error}`;
    sourceStatusEl.appendChild(badge);
    retryButton.hidden = false;
  } finally {
    setLoading(false);
    // Disabling the input during loading drops its focus; restore it here.
    prepareForNextScan();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const toteNumber = toteInput.value.trim();
  if (!toteNumber) return;
  lastToteNumber = toteNumber;
  showLastTote(toteNumber);
  if (autoCopyInput.checked) copyToteNumber(toteNumber);
  runLookup(toteNumber);
});

retryButton.addEventListener('click', () => {
  if (lastToteNumber) runLookup(lastToteNumber);
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

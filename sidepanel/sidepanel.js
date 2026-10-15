import {
  COLUMNS,
  dedupeDropZoneDisplay,
  describeSourceStatus,
  filterRows,
  renderRows,
  reorderColumns,
} from '../shared/resultsView.js';

const form = document.getElementById('search-form');
const toteInput = document.getElementById('tote-input');
const searchButton = document.getElementById('search-button');
const retryButton = document.getElementById('retry-button');
const loadingEl = document.getElementById('loading');
const sourceStatusEl = document.getElementById('source-status');
const filterBarEl = document.getElementById('filter-bar');
const filterInput = document.getElementById('filter-input');
const resultsWrapperEl = document.getElementById('results-wrapper');
const resultsHeadEl = document.getElementById('results-head');
const resultsBodyEl = document.getElementById('results-body');
const toastEl = document.getElementById('toast');

const COLUMN_ORDER_STORAGE_KEY = 'toteLookupColumnOrder';
const NOT_PERMITTED_TOAST_MESSAGE = 'NOT_PERMITTED ISS';
const TOAST_DURATION_MS = 2000;

let lastRows = [];
let lastToteNumber = '';
let currentColumns = COLUMNS;
let draggedColumnKey = null;
let toastTimeoutId = null;

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

function applyFilterAndRender() {
  const filtered = filterRows(lastRows, filterInput.value);
  renderRows(resultsBodyEl, dedupeDropZoneDisplay(filtered), currentColumns);
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
    filterBarEl.hidden = false;
    resultsWrapperEl.hidden = false;
    applyFilterAndRender();

    if (lastRows.some((row) => row.dropZone === 'NOT_PERMITTED')) {
      showToast(NOT_PERMITTED_TOAST_MESSAGE);
    }
  } catch (error) {
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
  runLookup(toteNumber);
});

retryButton.addEventListener('click', () => {
  if (lastToteNumber) runLookup(lastToteNumber);
});

filterInput.addEventListener('input', applyFilterAndRender);

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
  await loadColumnOrder();
  buildTableHead();
  toteInput.focus();
}

init();

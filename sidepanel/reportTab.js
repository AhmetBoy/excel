import { buildTimeRange } from '../shared/parsers/atlasReportParser.js';
import { describeSourceStatus } from '../shared/resultsView.js';
import {
  buildCombinedTable,
  buildHourlySlots,
  buildStowSheetRows,
  buildStowTable,
  DEFAULT_PROCESSES,
  departmentsFor,
  formatSlotLabel,
  missingProcesses,
  parseUserEntries,
  parseUserList,
  processById,
  PROCESSES,
  slotRowsForProcess,
  UNKNOWN_NAME,
} from '../shared/stowReportTable.js';
import { buildXlsx, XLSX_STYLE } from '../shared/xlsxWriter.js';

const tabButtons = document.querySelectorAll('.tab');
const tabPanels = {
  lookup: document.getElementById('tab-lookup'),
  report: document.getElementById('tab-report'),
  barcode: document.getElementById('tab-barcode'),
  stowmap: document.getElementById('tab-stowmap'),
  rozet: document.getElementById('tab-rozet'),
  admin: document.getElementById('tab-admin'),
};

const form = document.getElementById('report-form');
const startDateInput = document.getElementById('report-start-date');
const startTimeInput = document.getElementById('report-start-time');
const endDateInput = document.getElementById('report-end-date');
const endTimeInput = document.getElementById('report-end-time');
const warehouseInput = document.getElementById('report-warehouse');
const hourlyCheckbox = document.getElementById('report-hourly');
const usersInput = document.getElementById('report-users-input');
const usersSummaryEl = document.getElementById('report-users-summary');
const queryHashInput = document.getElementById('report-query-hash');
const settingsEl = document.getElementById('report-settings');
const reportButton = document.getElementById('report-button');
const statusEl = document.getElementById('report-status');
const loadingEl = document.getElementById('report-loading');
const filterBarEl = document.getElementById('report-filter-bar');
const filterInput = document.getElementById('report-filter-input');
const exportButton = document.getElementById('report-export-button');
const wrapperEl = document.getElementById('report-wrapper');
const headEl = document.getElementById('report-head');
const bodyEl = document.getElementById('report-body');
const footEl = document.getElementById('report-foot');
const processesEl = document.getElementById('report-processes');
const viewsEl = document.getElementById('report-views');
const noteEl = document.getElementById('report-note');

const COMBINED_VIEW = 'toplam';

const SETTINGS_STORAGE_KEY = 'stowReportSettings';
const DEFAULT_SETTINGS = {
  warehouseId: 'XSA9',
  startTime: '15:00',
  endTime: '23:00',
  queryHash: '',
  hourly: false,
  users: '',
  processes: DEFAULT_PROCESSES,
};

for (const process of PROCESSES) {
  const label = document.createElement('label');
  label.className = 'checkbox-label';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = process.id;
  box.addEventListener('change', saveSettings);
  label.append(box, document.createTextNode(` ${process.label}`));
  processesEl.append(label);
}

function selectedProcesses() {
  return [...processesEl.querySelectorAll('input:checked')].map((box) => box.value);
}

// { tables, combined, processes, view, slots, hourly, warehouseId, range }
// from the last successful fetch
let lastReport = null;

function switchTab(name) {
  for (const button of tabButtons) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
  for (const [key, panel] of Object.entries(tabPanels)) {
    panel.hidden = key !== name;
  }
  if (name === 'lookup') document.getElementById('tote-input').focus();
}

for (const button of tabButtons) {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
}

function todayLocalIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function updateUsersSummary() {
  const count = parseUserList(usersInput.value).length;
  usersSummaryEl.textContent =
    count > 0 ? `Kullanıcı listesi (${count} kişi)` : 'Kullanıcı listesi (boş - herkes gösterilir)';
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const settings = { ...DEFAULT_SETTINGS, ...data[SETTINGS_STORAGE_KEY] };
  const today = todayLocalIso();
  startDateInput.value = today;
  endDateInput.value = today;
  startTimeInput.value = settings.startTime;
  endTimeInput.value = settings.endTime;
  warehouseInput.value = settings.warehouseId;
  hourlyCheckbox.checked = settings.hourly;
  usersInput.value = settings.users;
  queryHashInput.value = settings.queryHash;
  const processes = new Set(settings.processes);
  for (const box of processesEl.querySelectorAll('input')) box.checked = processes.has(box.value);
  // Always editable; only expanded when the hash is missing or Atlas rejects it.
  settingsEl.open = !settings.queryHash;
  updateUsersSummary();
}

function saveSettings() {
  chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: {
      warehouseId: warehouseInput.value.trim(),
      startTime: startTimeInput.value,
      endTime: endTimeInput.value,
      queryHash: queryHashInput.value.trim(),
      hourly: hourlyCheckbox.checked,
      users: usersInput.value,
      processes: selectedProcesses(),
    },
  });
}

function showStatus(status, message) {
  const badge = document.createElement('span');
  badge.className = `status-badge ${status === 'ok' ? 'ok' : status === 'no_data' || status === 'partial_failure' ? 'warn' : 'error'}`;
  badge.textContent = `Atlas: ${describeSourceStatus(status)}${message ? ` - ${message}` : ''}`;
  statusEl.replaceChildren(badge);
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

const fmt = (n) => n.toLocaleString('tr-TR');
const isTop = (value, max) => value > 0 && value === max;

/**
 * What the table shows now: one process (hourly columns or a single
 * value) or the combined "Toplam" view (one column per process).
 * `columns` = value column labels, null for the single-value layout.
 */
function currentView() {
  const { view, tables, combined, processes, slots, hourly } = lastReport;
  if (view === COMBINED_VIEW) {
    return {
      id: COMBINED_VIEW,
      label: 'Toplam',
      table: combined,
      columns: processes.map((id) => processById(id).label),
    };
  }
  const process = processById(view);
  return {
    id: process.id,
    label: process.label,
    table: tables[view],
    columns: hourly ? slots.map(formatSlotLabel) : null,
    valueLabel: `${process.label} (Opportunities)`,
  };
}

function renderViews() {
  const { processes, view } = lastReport;
  const ids = processes.length > 1 ? [...processes, COMBINED_VIEW] : processes;
  viewsEl.hidden = ids.length < 2;
  viewsEl.replaceChildren(
    ...ids.map((id) => {
      const button = el('button', id === COMBINED_VIEW ? 'Toplam' : processById(id).label, 'view-button');
      button.type = 'button';
      button.classList.toggle('active', id === view);
      button.addEventListener('click', () => {
        lastReport.view = id;
        renderReport();
      });
      return button;
    })
  );
}

function renderHead({ columns, valueLabel }) {
  const tr = document.createElement('tr');
  tr.append(el('th', '#'), el('th', 'Kullanıcı', 'sticky-col'), el('th', 'İsim'));
  if (columns) {
    for (const label of columns) tr.append(el('th', label, 'num'));
    tr.append(el('th', 'Toplam', 'num total-col'));
  } else {
    tr.append(el('th', 'Manager'), el('th', valueLabel, 'num total-col'));
  }
  headEl.replaceChildren(tr);
}

function visibleRows() {
  const query = filterInput.value.trim().toLowerCase();
  const { rows } = currentView().table;
  return query
    ? rows.filter((r) => `${r.login} ${r.name ?? ''} ${r.managerId ?? ''}`.toLowerCase().includes(query))
    : rows;
}

function renderReport() {
  if (!lastReport) return;
  const viewInfo = currentView();
  const { table, columns } = viewInfo;
  const hourly = Boolean(columns);
  const columnCount = hourly ? columns.length + 4 : 5;
  const rows = visibleRows();

  renderViews();
  renderHead(viewInfo);

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = el('td', 'Sonuç bulunamadı.', 'empty-state');
    td.colSpan = columnCount;
    tr.appendChild(td);
    bodyEl.replaceChildren(tr);
  } else {
    bodyEl.replaceChildren(
      ...rows.map((row, index) => {
        const tr = document.createElement('tr');
        tr.append(
          el('td', String(index + 1)),
          el('td', row.login, 'sticky-col'),
          el('td', row.name ?? UNKNOWN_NAME, row.name ? null : 'unknown-name')
        );
        if (hourly) {
          row.values.forEach((value, i) => {
            tr.append(el('td', fmt(value), `num${isTop(value, table.columnMax[i]) ? ' top' : ''}`));
          });
        } else {
          tr.append(el('td', row.managerId ?? '-'));
        }
        tr.append(
          el('td', fmt(row.total), `num total-col${isTop(row.total, table.totalMax) ? ' top' : ''}`)
        );
        return tr;
      })
    );
  }

  // Footer totals follow the filter so they always match the visible rows.
  const tr = document.createElement('tr');
  tr.append(el('td', ''), el('td', `Toplam (${rows.length} kişi)`, 'sticky-col'), el('td', ''));
  if (hourly) {
    columns.forEach((_, i) => {
      tr.append(el('td', fmt(rows.reduce((sum, r) => sum + r.values[i], 0)), 'num'));
    });
  } else {
    tr.append(el('td', ''));
  }
  tr.append(el('td', fmt(rows.reduce((sum, r) => sum + r.total, 0)), 'num total-col'));
  footEl.replaceChildren(tr);
}

function setLoading(isLoading, text = 'Rapor getiriliyor...') {
  loadingEl.textContent = text;
  loadingEl.hidden = !isLoading;
  reportButton.disabled = isLoading;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const range = buildTimeRange(
    startDateInput.value,
    startTimeInput.value,
    endDateInput.value,
    endTimeInput.value
  );
  if (!range) {
    showStatus('error', 'Bitiş zamanı başlangıçtan sonra olmalı');
    return;
  }

  const warehouseId = warehouseInput.value.trim().toUpperCase();
  warehouseInput.value = warehouseId;
  const queryHash = queryHashInput.value.trim();
  saveSettings();
  if (!queryHash) {
    settingsEl.open = true;
    showStatus('config_missing');
    queryHashInput.focus();
    return;
  }

  const processes = PROCESSES.map((p) => p.id).filter((id) => selectedProcesses().includes(id));
  if (processes.length === 0) {
    showStatus('error', 'En az bir süreç seçin (Stow, Receive, Pick)');
    return;
  }

  const hourly = hourlyCheckbox.checked;
  const slots = hourly ? buildHourlySlots(range) : [range];
  setLoading(true, hourly ? `Rapor getiriliyor (${slots.length} saatlik dilim)...` : undefined);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_STOW_REPORT',
      params: { warehouseId, queryHash, timeRanges: slots, departments: departmentsFor(processes) },
    });
    if (!response) throw new Error('Arka plan betiğinden yanıt alınamadı.');

    // A stale hash (Atlas shipped a new query version) - surface the setting again.
    if (response.status === 'config_missing' || /PersistedQueryNotFound/i.test(response.message ?? '')) {
      settingsEl.open = true;
    }

    const entries = parseUserEntries(usersInput.value);
    const options = {
      users: entries.map((e) => e.login),
      names: Object.fromEntries(entries.map((e) => [e.login, e.name])),
    };
    const tables = Object.fromEntries(
      processes.map((id) => [id, buildStowTable(slotRowsForProcess(response.slots ?? [], processById(id)), options)])
    );
    const combined = processes.length > 1 ? buildCombinedTable(tables, processes) : null;
    const previousView = lastReport?.view;
    const view = processes.includes(previousView) || (previousView === COMBINED_VIEW && combined)
      ? previousView
      : processes[0];
    lastReport = { tables, combined, processes, view, slots, hourly, warehouseId, range };

    showStatus(response.status, response.message);
    // A process Atlas has no section for: list what it did return, so the
    // right processPath name can be picked (Pick's is not verified yet).
    const missing = response.status === 'ok' ? missingProcesses(processes, response.paths) : [];
    noteEl.hidden = missing.length === 0;
    noteEl.textContent = missing.length
      ? `Atlas'ta ${missing.map((p) => p.label).join(', ')} bölümü bulunamadı. Gelen bölümler: ${
          (response.paths ?? []).join(', ') || 'yok'
        }`
      : '';
    filterBarEl.hidden = Object.values(tables).every((t) => t.rows.length === 0);
    wrapperEl.hidden = false;
    renderReport();
  } catch (error) {
    showStatus('error', error?.message ?? String(error));
  } finally {
    setLoading(false);
  }
});

function formatDateTime(seconds, { forFileName = false } = {}) {
  const d = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return forFileName
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function exportToXlsx() {
  if (!lastReport) return;
  const { warehouseId, range } = lastReport;
  const viewInfo = currentView();
  const hourly = Boolean(viewInfo.columns) && viewInfo.id !== COMBINED_VIEW;

  const title =
    `${viewInfo.label} Raporu - ${warehouseId} - ` +
    `${formatDateTime(range.startTime)} / ${formatDateTime(range.endTime)}`;
  const rows = buildStowSheetRows(
    {
      table: viewInfo.table,
      rows: visibleRows(),
      columns: viewInfo.columns,
      valueLabel: viewInfo.valueLabel,
      title,
    },
    XLSX_STYLE
  );
  const columnWidths = viewInfo.columns
    ? [5, 16, 18, ...viewInfo.columns.map(() => 13), 10]
    : [5, 16, 18, 14, 20];

  const bytes = buildXlsx({
    sheetName: hourly ? `Saatlik ${viewInfo.label}` : viewInfo.label,
    rows,
    columnWidths,
    freeze: { rows: 3, cols: 3 },
  });

  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    `${viewInfo.id}-raporu_${warehouseId}_${formatDateTime(range.startTime, { forFileName: true })}` +
    `-${formatDateTime(range.endTime, { forFileName: true }).split('_')[1]}` +
    `${hourly ? '_saatlik' : ''}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

filterInput.addEventListener('input', renderReport);
exportButton.addEventListener('click', exportToXlsx);
usersInput.addEventListener('input', updateUsersSummary);
usersInput.addEventListener('change', saveSettings);
hourlyCheckbox.addEventListener('change', saveSettings);
queryHashInput.addEventListener('change', saveSettings);

loadSettings();

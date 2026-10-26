import { buildTimeRange } from '../shared/parsers/atlasReportParser.js';
import { describeSourceStatus } from '../shared/resultsView.js';
import {
  buildHourlySlots,
  buildStowSheetRows,
  buildStowTable,
  formatSlotLabel,
  parseUserList,
} from '../shared/stowReportTable.js';
import { buildXlsx, XLSX_STYLE } from '../shared/xlsxWriter.js';

const tabButtons = document.querySelectorAll('.tab');
const tabPanels = {
  lookup: document.getElementById('tab-lookup'),
  report: document.getElementById('tab-report'),
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

const SETTINGS_STORAGE_KEY = 'stowReportSettings';
const DEFAULT_SETTINGS = {
  warehouseId: 'XSA9',
  startTime: '15:00',
  endTime: '23:00',
  queryHash: '',
  hourly: false,
  users: '',
};

// { table, slots, hourly, warehouseId, range } from the last successful fetch
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

function renderHead({ slots, hourly }) {
  const tr = document.createElement('tr');
  tr.append(el('th', '#'), el('th', 'Kullanıcı', 'sticky-col'));
  if (hourly) {
    for (const slot of slots) tr.append(el('th', formatSlotLabel(slot), 'num'));
    tr.append(el('th', 'Toplam', 'num total-col'));
  } else {
    tr.append(el('th', 'Manager'), el('th', 'Stow (Opportunities)', 'num'));
  }
  headEl.replaceChildren(tr);
}

function visibleRows() {
  const query = filterInput.value.trim().toLowerCase();
  const { rows } = lastReport.table;
  return query
    ? rows.filter((r) => `${r.login} ${r.managerId ?? ''}`.toLowerCase().includes(query))
    : rows;
}

function renderReport() {
  if (!lastReport) return;
  const { table, slots, hourly } = lastReport;
  const columnCount = hourly ? slots.length + 3 : 4;
  const rows = visibleRows();

  renderHead(lastReport);

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
        tr.append(el('td', String(index + 1)), el('td', row.login, 'sticky-col'));
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
  tr.append(el('td', ''), el('td', `Toplam (${rows.length} kişi)`, 'sticky-col'));
  if (hourly) {
    slots.forEach((_, i) => {
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

  const hourly = hourlyCheckbox.checked;
  const slots = hourly ? buildHourlySlots(range) : [range];
  setLoading(true, hourly ? `Rapor getiriliyor (${slots.length} saatlik dilim)...` : undefined);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_STOW_REPORT',
      params: { warehouseId, queryHash, timeRanges: slots },
    });
    if (!response) throw new Error('Arka plan betiğinden yanıt alınamadı.');

    // A stale hash (Atlas shipped a new query version) - surface the setting again.
    if (response.status === 'config_missing' || /PersistedQueryNotFound/i.test(response.message ?? '')) {
      settingsEl.open = true;
    }

    const slotRows = (response.slots ?? []).map((s) => s?.rows ?? []);
    const table = buildStowTable(slotRows, { users: parseUserList(usersInput.value) });
    lastReport = { table, slots, hourly, warehouseId, range };

    showStatus(response.status, response.message);
    filterBarEl.hidden = table.rows.length === 0;
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
  const { slots, hourly, warehouseId, range } = lastReport;

  const title =
    `Stow Raporu - ${warehouseId} - ` +
    `${formatDateTime(range.startTime)} / ${formatDateTime(range.endTime)}`;
  const rows = buildStowSheetRows({ ...lastReport, rows: visibleRows(), title }, XLSX_STYLE);
  const columnWidths = hourly
    ? [5, 16, ...slots.map(() => 13), 10]
    : [5, 16, 14, 20];

  const bytes = buildXlsx({
    sheetName: hourly ? 'Saatlik Stow' : 'Stow',
    rows,
    columnWidths,
    freeze: { rows: 3, cols: 2 },
  });

  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    `stow-raporu_${warehouseId}_${formatDateTime(range.startTime, { forFileName: true })}` +
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

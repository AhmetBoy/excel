// "Analiz" tab: the latest activity of every associate in the Rapor user
// list - what they did last, where, how many minutes ago, and whether they
// are still at it. The data is written by the Rozet scan in the background
// (shared/userActivity.js); "Şimdi Tara" runs that scan right away.

import { parseUserEntries } from '../shared/stowReportTable.js';
import { formatLocalDateTime } from '../shared/shifts.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY, STATE_KEY } from '../shared/rozetWatch.js';
import { STOW_TOOL } from '../shared/stowTool.js';
import {
  ACTIVITY_KEY,
  classifyUser,
  DEFAULT_THRESHOLD,
  locationBreakdown,
  LONG_ABSENCE_MINUTES,
  THRESHOLD_OPTIONS,
  toolsSeen,
  TYPE_ANY,
  TYPE_STOW,
  zoneOf,
} from '../shared/userActivity.js';

const USERS_SETTINGS_KEY = 'stowReportSettings';
const PREFS_KEY = 'userAnalysisPrefs'; // per-viewer, localStorage
const REFRESH_MS = 30_000; // "x dk" keeps counting between scans
// Bars run 0 → this many minutes; longer absences fill the track ("120+").
const BAR_MAX_MINUTES = 120;

const typeSelect = document.getElementById('ua-type');
const thresholdSelect = document.getElementById('ua-threshold');
const sortSelect = document.getElementById('ua-sort');
const scanButton = document.getElementById('ua-scan-button');
const scanStatusEl = document.getElementById('ua-scan-status');
const tilesEl = document.getElementById('ua-tiles');
const insightsEl = document.getElementById('ua-insights');
const bodyEl = document.getElementById('ua-body');
const floorsEl = document.getElementById('ua-floors');

// Status colors are reserved for state and always come with an icon + label.
const STATES = {
  active: { icon: '✔', label: 'Devam ediyor', className: 'ua-active' },
  other: { icon: '↪', label: 'Başka işte', className: 'ua-other' },
  idle: { icon: '⏸', label: 'Ara verdi', className: 'ua-idle' },
  away: { icon: '✖', label: `${LONG_ABSENCE_MINUTES}+ dk yok`, className: 'ua-away' },
  none: { icon: '—', label: 'Veri yok', className: 'ua-none' },
};
const STATE_ORDER = ['active', 'other', 'idle', 'away', 'none'];

const TOOL_LABELS = {
  [STOW_TOOL]: 'Stow',
  EachStow: 'Stow hata kaydı',
  MoveItemsApp: 'Taşıma',
  FCReceiveWebUIWebsi: 'Receive',
};

let entries = [];
let activity = { users: {} };
let scanState = {};
let rozetSettings = DEFAULT_SETTINGS;
let scanning = false;
let scanError = null; // shown until the next scan

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function toolLabel(tool) {
  return TOOL_LABELS[tool] ?? tool ?? '—';
}

function typeLabel(type) {
  if (type === TYPE_ANY) return 'herhangi bir işlem';
  if (type === TYPE_STOW) return 'stow';
  return toolLabel(type);
}

function capitalize(text) {
  return text ? text.charAt(0).toLocaleUpperCase('tr') + text.slice(1) : text;
}

function timeOfDay(timeMs) {
  const date = new Date(timeMs);
  const text = formatLocalDateTime(date);
  return date.toDateString() === new Date().toDateString() ? text.slice(-5) : text;
}

/* ---------- preferences ---------- */

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ type: typeSelect.value, threshold: thresholdSelect.value, sort: sortSelect.value })
    );
  } catch {
    // kept for this session only
  }
}

for (const minutes of THRESHOLD_OPTIONS) {
  const option = el('option', minutes);
  option.value = String(minutes);
  thresholdSelect.append(option);
}
const prefs = readPrefs();
thresholdSelect.value = String(THRESHOLD_OPTIONS.includes(Number(prefs.threshold)) ? prefs.threshold : DEFAULT_THRESHOLD);
if (prefs.sort) sortSelect.value = prefs.sort;
let wantedType = prefs.type ?? TYPE_STOW;

/** Tüm işlemler / Stow / every other tool the data contains. */
function fillTypeOptions() {
  const tools = toolsSeen(Object.values(activity.users ?? {})).filter((tool) => tool !== STOW_TOOL);
  const options = [
    [TYPE_ANY, 'Son işlem (hepsi)'],
    [TYPE_STOW, 'Stow'],
    ...tools.map((tool) => [tool, toolLabel(tool)]),
  ];
  const current = typeSelect.value || wantedType;
  typeSelect.replaceChildren(
    ...options.map(([value, label]) => {
      const option = el('option', label);
      option.value = value;
      return option;
    })
  );
  typeSelect.value = options.some(([value]) => value === current) ? current : TYPE_STOW;
}

for (const select of [typeSelect, thresholdSelect, sortSelect]) {
  select.addEventListener('change', () => {
    wantedType = typeSelect.value;
    savePrefs();
    render();
  });
}

/* ---------- rows ---------- */

function buildRows(nowMs) {
  const type = typeSelect.value || TYPE_STOW;
  const threshold = Number(thresholdSelect.value) || DEFAULT_THRESHOLD;
  return entries.map((entry) => {
    const summary = activity.users?.[entry.login] ?? null;
    return {
      ...entry,
      summary,
      classification: classifyUser(summary, { type, threshold, nowMs }),
      scanStatus: scanState.users?.[entry.login]?.status ?? null,
    };
  });
}

function sortRows(rows) {
  const by = sortSelect.value;
  const name = (row) => (row.name ?? row.login).toLocaleLowerCase('tr');
  // Associates without data go last in every order.
  const minutes = (row) => row.classification.minutes ?? -1;
  return [...rows].sort((a, b) => {
    if (by === 'name') return name(a).localeCompare(name(b), 'tr');
    if (by === 'recent') return (minutes(a) < 0) - (minutes(b) < 0) || minutes(a) - minutes(b);
    return minutes(b) - minutes(a) || name(a).localeCompare(name(b), 'tr');
  });
}

function stateBadge(classification) {
  const meta = STATES[classification.state];
  const wrap = el('div');
  const badge = el('span', null, `ua-state ${meta.className}`);
  badge.append(el('span', meta.icon, 'ua-state-icon'), el('span', meta.label));
  wrap.append(badge);
  if (classification.state === 'other') {
    const extra = el('div', toolLabel(classification.otherTool), 'ua-sub ua-state-extra');
    extra.title = classification.otherTool ?? '';
    wrap.append(extra);
  }
  return wrap;
}

/** Minutes since the action as a bar on a shared 0–120 dk baseline. */
function minutesBar(classification) {
  const cell = el('div', null, 'ua-bar-cell');
  if (classification.minutes === null) {
    cell.append(el('span', '—', 'ua-bar-text'));
    return cell;
  }
  const track = el('div', null, 'ua-bar-track');
  const fill = el('div', null, `ua-bar-fill ${STATES[classification.state].className}`);
  fill.style.width = `${Math.max(2, (Math.min(classification.minutes, BAR_MAX_MINUTES) / BAR_MAX_MINUTES) * 100)}%`;
  track.append(fill);
  const over = classification.minutes > BAR_MAX_MINUTES;
  cell.append(track, el('span', `${classification.minutes}${over ? '+' : ''} dk`, 'ua-bar-text'));
  return cell;
}

function tooltip(row) {
  const action = row.classification.action;
  if (!action) return `${row.name ?? row.login}: bu listede işlem görülmedi`;
  const lines = [
    `${row.name ?? row.login} (${row.login})`,
    `${toolLabel(action.tool)} · ${action.op ?? ''} · ${formatLocalDateTime(new Date(action.timeMs))}`,
    `${action.from ?? '—'} → ${action.to ?? '—'}`,
  ];
  if (action.product) lines.push(`${action.product.kind}: ${action.product.id}`);
  if (action.failed) lines.push('Hatalı stow (PROBLEM_SOLVE)');
  const latest = row.summary?.lastAny;
  if (latest && latest !== action && latest.timeMs > action.timeMs) {
    lines.push(`En son işlem: ${toolLabel(latest.tool)} · ${timeOfDay(latest.timeMs)}`);
  }
  return lines.join('\n');
}

function tableRow(row) {
  const tr = el('tr');
  tr.title = tooltip(row);
  const action = row.classification.action;
  const zone = zoneOf(action?.bin);
  const failedScan = row.scanStatus && !['ok', 'no_data'].includes(row.scanStatus);

  // Login under the name keeps the table narrow enough for the side panel.
  const nameCell = el('td');
  nameCell.append(el('div', row.name ?? 'Bilinmiyor', 'ua-name'));
  const loginLine = el('div', row.login, 'ua-sub');
  if (failedScan) loginLine.append(el('span', ' ⚠ tarama hatası', 'ua-scan-warn'));
  nameCell.append(loginLine);
  const binCell = el('td');
  if (action?.bin) {
    binCell.append(el('strong', action.bin));
    if (zone) binCell.append(el('div', `Kat ${zone.floor} · ${zone.aisle}`, 'ua-sub'));
  } else {
    binCell.textContent = '—';
  }
  const opCell = el('td', action ? toolLabel(action.tool) : '—');
  if (action?.failed) opCell.append(el('div', 'Hatalı stow', 'ua-sub ua-failed'));

  const stateCell = el('td');
  stateCell.append(stateBadge(row.classification));
  const barCell = el('td');
  barCell.append(minutesBar(row.classification));

  tr.append(
    nameCell,
    stateCell,
    barCell,
    binCell,
    el('td', action ? timeOfDay(action.timeMs) : '—'),
    opCell,
    el('td', action?.product ? `${action.product.id}` : '—'),
    el('td', row.summary ? row.summary.shiftStows ?? 0 : '—')
  );
  return tr;
}

/* ---------- summary ---------- */

function renderTiles(rows) {
  const counts = Object.fromEntries(STATE_ORDER.map((state) => [state, 0]));
  for (const row of rows) counts[row.classification.state]++;
  tilesEl.replaceChildren(
    ...STATE_ORDER.filter((state) => state !== 'none' || counts.none > 0).map((state) => {
      const meta = STATES[state];
      const tile = el('div', null, `ua-tile ${meta.className}`);
      tile.append(el('div', counts[state], 'ua-tile-value'), el('div', `${meta.icon} ${meta.label}`, 'ua-tile-label'));
      return tile;
    })
  );
}

function namesOf(rows) {
  return rows.map((row) => row.name ?? row.login).join(', ');
}

function renderInsights(rows, nowMs) {
  const type = typeSelect.value;
  const threshold = Number(thresholdSelect.value) || DEFAULT_THRESHOLD;
  const lines = [];
  const by = (state) => rows.filter((row) => row.classification.state === state);

  const lastScanMs = Date.parse(scanState.lastScanAt ?? '');
  if (Number.isFinite(lastScanMs) && nowMs - lastScanMs > threshold * 60_000) {
    lines.push({
      level: 'warn',
      text: `Veriler ${Math.floor((nowMs - lastScanMs) / 60_000)} dk önce tarandı — "devam ediyor" bilgisi eski olabilir. Şimdi Tara ile güncelleyin.`,
    });
  }

  const active = by('active');
  lines.push({
    level: 'info',
    text: `${active.length} / ${rows.length} kişi son ${threshold} dk içinde ${typeLabel(type)} yaptı.`,
  });

  const other = by('other');
  if (other.length > 0) {
    lines.push({
      level: 'info',
      text: `${capitalize(typeLabel(type))} yerine başka işte: ${other
        .map((row) => `${row.name ?? row.login} (${toolLabel(row.classification.otherTool)})`)
        .join(', ')}`,
    });
  }

  const away = by('away');
  if (away.length > 0) {
    lines.push({ level: 'warn', text: `${LONG_ABSENCE_MINUTES} dk'dan uzun süredir ${typeLabel(type)} yok: ${namesOf(away)}` });
  }

  const failedLast = rows.filter((row) => row.classification.action?.failed);
  if (failedLast.length > 0) {
    lines.push({ level: 'warn', text: `Son stow'u hatalı (PROBLEM_SOLVE): ${namesOf(failedLast)}` });
  }

  const { crowdedAisles } = locationBreakdown(rows);
  for (const aisle of crowdedAisles) {
    const names = aisle.logins.map((login) => rows.find((row) => row.login === login)?.name ?? login);
    lines.push({ level: 'info', text: `${aisle.zone} koridorunda ${names.length} kişi: ${names.join(', ')}` });
  }

  const missing = by('none');
  if (missing.length > 0) lines.push({ level: 'muted', text: `Taramada işlemi görülmeyen: ${namesOf(missing)}` });

  insightsEl.replaceChildren(
    ...lines.map((line) => el('div', line.text, `ua-insight ua-insight-${line.level}`))
  );
}

/** Associates currently doing the chosen action, per floor (ranked bars). */
function renderFloors(rows) {
  const { floors } = locationBreakdown(rows);
  if (floors.length === 0) {
    floorsEl.replaceChildren();
    return;
  }
  const max = Math.max(...floors.map((f) => f.count));
  const title = el('div', `Şu an ${typeLabel(typeSelect.value)} yapanların katları`, 'ua-section-title');
  const list = el('div', null, 'ua-floor-list');
  for (const { floor, count } of floors) {
    const row = el('div', null, 'ua-floor-row');
    row.title = `Kat ${floor}: ${count} kişi`;
    const track = el('div', null, 'ua-floor-track');
    const fill = el('div', null, 'ua-floor-fill');
    fill.style.width = `${(count / max) * 100}%`;
    track.append(fill);
    row.append(el('span', `Kat ${floor}`, 'ua-floor-name'), track, el('span', `${count} kişi`, 'ua-floor-count'));
    list.append(row);
  }
  floorsEl.replaceChildren(title, list);
}

function renderStatus(nowMs) {
  if (scanning || scanState.running) {
    scanStatusEl.textContent = 'Taranıyor…';
    return;
  }
  const parts = scanError ? [`✖ ${scanError}`] : [];
  const lastScanMs = Date.parse(scanState.lastScanAt ?? '');
  parts.push(
    Number.isFinite(lastScanMs)
      ? `Son tarama: ${timeOfDay(lastScanMs)} (${Math.floor((nowMs - lastScanMs) / 60_000)} dk önce)`
      : 'Henüz tarama yapılmadı'
  );
  parts.push(
    rozetSettings.autoScan
      ? `otomatik tarama her ${rozetSettings.intervalMinutes} dk (Rozet sekmesindeki ayar)`
      : 'otomatik tarama kapalı (Rozet sekmesinden açılır)'
  );
  scanStatusEl.textContent = parts.join(' · ');
}

function render() {
  const nowMs = Date.now();
  renderStatus(nowMs);
  if (entries.length === 0) {
    tilesEl.replaceChildren();
    insightsEl.replaceChildren(el('div', 'Rapor sekmesindeki kullanıcı listesi boş — önce kullanıcıları ekleyin.', 'ua-insight ua-insight-warn'));
    bodyEl.replaceChildren();
    floorsEl.replaceChildren();
    return;
  }
  const rows = sortRows(buildRows(nowMs));
  renderTiles(rows);
  renderInsights(rows, nowMs);
  bodyEl.replaceChildren(...rows.map(tableRow));
  renderFloors(rows);
}

/* ---------- data ---------- */

async function load() {
  const data = await chrome.storage.local.get([USERS_SETTINGS_KEY, ACTIVITY_KEY, STATE_KEY, SETTINGS_KEY]);
  entries = parseUserEntries(data[USERS_SETTINGS_KEY]?.users ?? '');
  activity = data[ACTIVITY_KEY] ?? { users: {} };
  scanState = data[STATE_KEY] ?? {};
  rozetSettings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] ?? {}) };
  fillTypeOptions();
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ([USERS_SETTINGS_KEY, ACTIVITY_KEY, STATE_KEY, SETTINGS_KEY].some((key) => key in changes)) load();
});

scanButton.addEventListener('click', async () => {
  scanning = true;
  scanError = null;
  scanButton.disabled = true;
  render();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ACTIVITY_SCAN_NOW' });
    if (!result) scanError = 'Arka plan yanıt vermedi. Eklentiyi yeniden yükleyin.';
    else if (result.status === 'error') scanError = result.message ?? 'Tarama başarısız';
    else if (result.status === 'no_users') scanError = 'Rapor sekmesindeki kullanıcı listesi boş.';
  } catch (error) {
    scanError = `Arka plana ulaşılamadı: ${error?.message ?? error}. Eklentiyi yeniden yükleyin.`;
  } finally {
    scanning = false;
    scanButton.disabled = false;
    await load();
  }
});

setInterval(() => {
  if (!document.getElementById('tab-userAnalysis').hidden) render();
}, REFRESH_MS);

load();

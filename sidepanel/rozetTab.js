// "Rozet" tab: settings for the background failed-stow scan, a per-associate
// report and the list of failed stows to pick back and mark resolved.
// Scanning and every change to the records go through the background
// (background/rozetScanner.js) so they never overwrite each other.

import { parseUserEntries } from '../shared/stowReportTable.js';
import { formatLocalDateTime } from '../shared/shifts.js';
import {
  DEFAULT_SETTINGS,
  EVENTS_KEY,
  INTERVAL_OPTIONS,
  ROZET_LIMIT,
  SETTINGS_KEY,
  STATE_KEY,
  summarizeByUser,
} from '../shared/rozetWatch.js';

const USERS_SETTINGS_KEY = 'stowReportSettings';
const FOCUS_KEY = 'rozetFocusAt';

const autoInput = document.getElementById('rozet-auto');
const intervalSelect = document.getElementById('rozet-interval');
const notifyInput = document.getElementById('rozet-notify');
const scanButton = document.getElementById('rozet-scan-button');
const scanStatusEl = document.getElementById('rozet-scan-status');
const summaryBody = document.getElementById('rozet-summary-body');
const summaryFoot = document.getElementById('rozet-summary-foot');
const openOnlyInput = document.getElementById('rozet-open-only');
const clearResolvedButton = document.getElementById('rozet-clear-resolved');
const clearAllButton = document.getElementById('rozet-clear-all');
const listEl = document.getElementById('rozet-list');
const tabCountEl = document.getElementById('rozet-tab-count');

let events = [];
let scanState = {};
let entries = [];
let scanning = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function button(text, className, onClick, title) {
  const node = el('button', text, className);
  node.type = 'button';
  if (title) node.title = title;
  node.addEventListener('click', onClick);
  return node;
}

function send(message) {
  return chrome.runtime.sendMessage(message).catch((error) => ({
    status: 'error',
    message: String(error?.message ?? error),
  }));
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso ?? '';
  const sameDay = date.toDateString() === new Date().toDateString();
  const text = formatLocalDateTime(date);
  return sameDay ? text.slice(-5) : text;
}

/* ---------- settings ---------- */

for (const minutes of INTERVAL_OPTIONS) {
  const option = el('option', minutes);
  option.value = String(minutes);
  intervalSelect.append(option);
}

function applySettings(settings) {
  autoInput.checked = settings.autoScan;
  notifyInput.checked = settings.notify;
  intervalSelect.value = String(settings.intervalMinutes);
  intervalSelect.disabled = !settings.autoScan;
}

function saveSettings() {
  const settings = {
    autoScan: autoInput.checked,
    notify: notifyInput.checked,
    intervalMinutes: Number(intervalSelect.value) || DEFAULT_SETTINGS.intervalMinutes,
  };
  intervalSelect.disabled = !settings.autoScan;
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

autoInput.addEventListener('change', saveSettings);
notifyInput.addEventListener('change', saveSettings);
intervalSelect.addEventListener('change', saveSettings);

/* ---------- scan ---------- */

const STATUS_TEXT = {
  ok: 'tamam',
  partial_failure: 'bazı kişiler okunamadı',
  error: 'okunamadı - FC Research oturumu açık mı?',
  no_users: 'Rapor sekmesinde kullanıcı listesi boş',
};

function renderScanStatus() {
  if (scanning || scanState.running) {
    scanStatusEl.textContent = `Taranıyor... (${entries.length} kişi)`;
    scanButton.disabled = true;
    return;
  }
  scanButton.disabled = false;
  if (!scanState.lastScanAt) {
    scanStatusEl.textContent =
      entries.length > 0 ? `${entries.length} kişi izleniyor. Henüz tarama yapılmadı.` : STATUS_TEXT.no_users;
    return;
  }
  const failed = Object.entries(scanState.users ?? {})
    .filter(([, u]) => u.status !== 'ok' && u.status !== 'no_data')
    .map(([login]) => login);
  const kind = scanState.trigger === 'manual' ? 'elle' : 'otomatik';
  let text = `Son tarama (${kind}): ${formatTime(scanState.lastScanAt)} · ${
    Object.keys(scanState.users ?? {}).length
  } kişi · ${STATUS_TEXT[scanState.status] ?? scanState.status}`;
  if (failed.length > 0 && scanState.status !== 'error') text += ` (${failed.join(', ')})`;
  scanStatusEl.textContent = text;
}

scanButton.addEventListener('click', async () => {
  scanning = true;
  renderScanStatus();
  const result = await send({ type: 'ROZET_SCAN_NOW' });
  scanning = false;
  // No status = nothing in the background handled the message, usually an
  // old service worker still running after the extension files changed.
  const problem = !result?.status
    ? "Arka plan cevap vermedi. chrome://extensions sayfasında eklentiyi yenileyip (⟳) tekrar deneyin."
    : result.status === 'error' && result.message
      ? `Tarama hatası: ${result.message}`
      : null;
  if (problem) {
    scanStatusEl.textContent = problem;
    scanButton.disabled = false;
    return;
  }
  // The new state may arrive via storage.onChanged a moment after the reply.
  const data = await chrome.storage.local.get(STATE_KEY);
  scanState = data[STATE_KEY] ?? scanState;
  renderScanStatus();
});

/* ---------- report + list ---------- */

function renderSummary(summary) {
  const rows = summary.rows.map((row) => {
    const tr = el('tr', undefined, row.open > 0 ? 'rozet-row-open' : '');
    tr.append(
      el('td', row.name ?? '-'),
      el('td', row.login),
      el('td', row.failed),
      el('td', row.open, row.open > 0 ? 'rozet-num-open' : ''),
      el('td', row.resolved),
      el('td', row.rozet, row.rozet > 0 ? 'rozet-num-badge' : ''),
      el('td', row.rozetResolved)
    );
    if (row.failed > 0) {
      tr.classList.add('rozet-row-link');
      tr.title = 'Detaya git';
      tr.addEventListener('click', () => {
        const target = document.getElementById(`rozet-user-${row.login}`);
        if (target) {
          target.open = true;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    return tr;
  });
  if (rows.length === 0) {
    const tr = el('tr');
    const td = el('td', 'Kullanıcı yok - Rapor sekmesindeki listeye ekleyin.', 'empty-state');
    td.colSpan = 7;
    tr.append(td);
    rows.push(tr);
  }
  summaryBody.replaceChildren(...rows);

  const t = summary.total;
  const foot = el('tr');
  const label = el('td', 'Toplam');
  label.colSpan = 2;
  foot.append(label, el('td', t.failed), el('td', t.open), el('td', t.resolved), el('td', t.rozet), el('td', t.rozetResolved));
  summaryFoot.replaceChildren(foot);
}

function renderEvent(event) {
  const row = el('div', undefined, `rozet-event${event.resolvedAt ? ' is-resolved' : ''}`);
  row.append(
    el('span', formatTime(event.time), 'rozet-event-time'),
    el('span', event.bin, 'rozet-event-bin'),
    el('span', `${event.quantity} adet`, 'rozet-event-qty'),
    el('span', event.resolvedAt ? `Çözüldü ${formatTime(event.resolvedAt)}` : 'Açık', 'rozet-event-state'),
    event.resolvedAt
      ? button('Geri al', 'btn-secondary', () => send({ type: 'ROZET_SET_RESOLVED', ids: [event.id], resolved: false }))
      : button('Çözüldü', 'btn-resolve', () => send({ type: 'ROZET_SET_RESOLVED', ids: [event.id], resolved: true })),
    button('×', 'btn-icon', () => send({ type: 'ROZET_DELETE', ids: [event.id] }), 'Kaydı sil')
  );
  return row;
}

function renderGroup(group, openOnly) {
  const card = el('div', undefined, `rozet-group${group.rozet ? ' is-rozet' : ''}${group.resolved ? ' is-resolved' : ''}`);
  const head = el('div', undefined, 'rozet-group-head');
  const title = el('span', undefined, 'rozet-group-title');
  title.append(
    el('strong', group.tote),
    document.createTextNode(` · ${group.asin ?? '-'}${group.fnSku && group.fnSku !== group.asin ? ` / ${group.fnSku}` : ''}`)
  );
  head.append(
    title,
    el('span', `${group.count}/${ROZET_LIMIT}`, `rozet-count${group.rozet ? ' is-rozet' : ''}`)
  );
  if (group.rozet) head.append(el('span', 'ROZET', 'rozet-badge'));
  const openIds = group.events.filter((e) => !e.resolvedAt).map((e) => e.id);
  if (openIds.length > 1) {
    head.append(
      button('Hepsi çözüldü', 'btn-resolve', () => send({ type: 'ROZET_SET_RESOLVED', ids: openIds, resolved: true }))
    );
  }
  card.append(head);
  const shown = openOnly ? group.events.filter((e) => !e.resolvedAt) : group.events;
  card.append(...shown.map(renderEvent));
  return card;
}

function renderList(summary) {
  const openOnly = openOnlyInput.checked;
  const sections = [];
  for (const row of summary.rows) {
    const groups = openOnly ? row.groups.filter((g) => !g.resolved) : row.groups;
    if (groups.length === 0) continue;
    const details = el('details', undefined, 'rozet-user');
    details.id = `rozet-user-${row.login}`;
    details.open = true;
    const summaryEl = el('summary');
    summaryEl.append(
      el('strong', row.name ? `${row.name} (${row.login})` : row.login),
      document.createTextNode(` · açık ${row.open} / hatalı ${row.failed}`)
    );
    details.append(summaryEl, ...groups.map((g) => renderGroup(g, openOnly)));
    sections.push(details);
  }
  if (sections.length === 0) {
    sections.push(el('p', openOnly ? 'Açık hatalı stow yok.' : 'Kayıt yok.', 'empty-state'));
  }
  listEl.replaceChildren(...sections);
}

function render() {
  const summary = summarizeByUser(events, entries);
  renderSummary(summary);
  renderList(summary);
  renderScanStatus();
  const open = summary.total.open;
  tabCountEl.hidden = open === 0;
  tabCountEl.textContent = String(open);
  clearResolvedButton.disabled = summary.total.resolved === 0;
  clearAllButton.disabled = events.length === 0;
}

openOnlyInput.addEventListener('change', render);

clearResolvedButton.addEventListener('click', () => {
  if (confirm('Çözüldü işaretli tüm kayıtlar silinsin mi?')) send({ type: 'ROZET_CLEAR', mode: 'resolved' });
});

clearAllButton.addEventListener('click', () => {
  if (confirm('Tüm hatalı stow kayıtları silinsin mi? Bu geri alınamaz.')) send({ type: 'ROZET_CLEAR', mode: 'all' });
});

function showRozetTab() {
  document.querySelector('.tab[data-tab="rozet"]')?.click();
}

/* ---------- storage ---------- */

function applyUsers(reportSettings) {
  entries = parseUserEntries(reportSettings?.users ?? '');
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[EVENTS_KEY]) events = changes[EVENTS_KEY].newValue ?? [];
  if (changes[STATE_KEY]) scanState = changes[STATE_KEY].newValue ?? {};
  if (changes[USERS_SETTINGS_KEY]) applyUsers(changes[USERS_SETTINGS_KEY].newValue);
  if (changes[SETTINGS_KEY]) applySettings({ ...DEFAULT_SETTINGS, ...changes[SETTINGS_KEY].newValue });
  if (changes[FOCUS_KEY]) showRozetTab();
  if (changes[EVENTS_KEY] || changes[STATE_KEY] || changes[USERS_SETTINGS_KEY]) render();
});

chrome.storage.local
  .get([SETTINGS_KEY, EVENTS_KEY, STATE_KEY, USERS_SETTINGS_KEY, FOCUS_KEY])
  .then((data) => {
    applySettings({ ...DEFAULT_SETTINGS, ...data[SETTINGS_KEY] });
    events = data[EVENTS_KEY] ?? [];
    scanState = data[STATE_KEY] ?? {};
    applyUsers(data[USERS_SETTINGS_KEY]);
    render();
    // Opened from a notification click a moment ago.
    if (Date.now() - (data[FOCUS_KEY] ?? 0) < 10_000) showRozetTab();
  });

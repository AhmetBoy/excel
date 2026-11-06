import {
  expandBin,
  findCandidates,
  parseAisleSpec,
  parseStowMapCsv,
  summarizeBins,
} from '../shared/stowMap.js';

// Storage layout (chrome.storage.local, needs "unlimitedStorage"; a floor is ~2 MB):
//   stowMap:floor:<n>  -> { fileName, importedAt, bins: stored bin arrays }
//   stowMap:marks:<n>  -> { [binId]: { added: number, full?: boolean } }
//   stowMap:floors     -> { [n]: { fileName, importedAt, count } }
//   stowMap:criteria   -> last selection
const FLOORS_KEY = 'stowMap:floors';
const CRITERIA_KEY = 'stowMap:criteria';
const floorKey = (floor) => `stowMap:floor:${floor}`;
const marksKey = (floor) => `stowMap:marks:${floor}`;

const NEXT_COUNT = 5;

const fileInput = document.getElementById('stowmap-file');
const floorsEl = document.getElementById('stowmap-floors');
const criteriaForm = document.getElementById('stowmap-criteria');
const floorSelect = document.getElementById('stowmap-floor');
const towerSelect = document.getElementById('stowmap-tower');
const aislesInput = document.getElementById('stowmap-aisles');
const dropzoneSelect = document.getElementById('stowmap-dropzone');
const shelvesEl = document.getElementById('stowmap-shelves');
const hrvInput = document.getElementById('stowmap-hrv');
const resultEl = document.getElementById('stowmap-result');
const detailEl = document.getElementById('stowmap-detail');
const detailSummaryEl = document.getElementById('stowmap-detail-summary');
const detailBodyEl = document.getElementById('stowmap-detail-body');

let floorsMeta = {};
let savedCriteria = {};
// Bins and records of the floor currently selected.
let current = { floor: null, bins: [], marks: {} };
// "Atla" is only for this session; it isn't saved.
const skipped = new Set();
// Last actions, so a mis-click can be undone.
const undoStack = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const uniqueSorted = (values) => [...new Set(values)].filter(Boolean).sort();

function fillSelect(select, values, { emptyLabel = null, selected = null } = {}) {
  const options = [];
  if (emptyLabel != null) options.push(new Option(emptyLabel, ''));
  for (const value of values) options.push(new Option(value, value));
  select.replaceChildren(...options);
  if (selected != null && [...select.options].some((o) => o.value === selected)) select.value = selected;
}

function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderFloors() {
  const floors = Object.keys(floorsMeta).sort();
  floorsEl.replaceChildren(
    ...floors.map((floor) => {
      const meta = floorsMeta[floor];
      const records = floor === current.floor ? Object.keys(current.marks).length : null;
      const text =
        `Kat ${floor}: ${meta.count.toLocaleString('tr-TR')} lokasyon · ${meta.fileName} · ${formatDate(meta.importedAt)}` +
        (records != null ? ` · ${records} kayıt` : '');
      return el('li', null, text);
    })
  );
  criteriaForm.hidden = floors.length === 0;
}

function selectedShelves() {
  return [...shelvesEl.querySelectorAll('input:checked')].map((input) => input.value);
}

function readCriteria() {
  return {
    floor: floorSelect.value,
    tower: towerSelect.value,
    aisles: aislesInput.value,
    dropzone: dropzoneSelect.value,
    shelves: selectedShelves(),
    hrvOnly: hrvInput.checked,
  };
}

function saveCriteria() {
  savedCriteria = readCriteria();
  chrome.storage.local.set({ [CRITERIA_KEY]: savedCriteria });
}

/** Tower / dropzone / shelf choices depend on what the selected floor (and tower) has. */
function fillFloorOptions() {
  fillSelect(towerSelect, uniqueSorted(current.bins.map((b) => b.tower)), {
    selected: savedCriteria.tower,
  });
  fillTowerOptions();
}

function fillTowerOptions() {
  const towerBins = current.bins.filter((b) => b.tower === towerSelect.value);
  fillSelect(dropzoneSelect, uniqueSorted(towerBins.map((b) => b.dropzone)), {
    emptyLabel: 'Hepsi',
    selected: savedCriteria.dropzone,
  });

  const checked = new Set(savedCriteria.shelves ?? []);
  shelvesEl.replaceChildren(
    ...uniqueSorted(towerBins.map((b) => b.shelf)).map((shelf) => {
      const label = el('label', 'shelf-option');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = shelf;
      input.checked = checked.has(shelf);
      label.append(input, ` ${shelf}`);
      return label;
    })
  );
}

async function loadFloor(floor) {
  if (!floor) {
    current = { floor: null, bins: [], marks: {} };
    return;
  }
  const data = await chrome.storage.local.get([floorKey(floor), marksKey(floor)]);
  current = {
    floor,
    bins: (data[floorKey(floor)]?.bins ?? []).map(expandBin),
    marks: data[marksKey(floor)] ?? {},
  };
}

function saveMarks() {
  chrome.storage.local.set({ [marksKey(current.floor)]: current.marks });
}

function record(binId, change) {
  const before = current.marks[binId] ? { ...current.marks[binId] } : null;
  undoStack.push({ floor: current.floor, binId, before, skipped: change === 'skip' });

  if (change === 'skip') {
    skipped.add(binId);
  } else {
    const mark = current.marks[binId] ?? { added: 0 };
    if (change === 'stowed') mark.added = (mark.added ?? 0) + 1;
    if (change === 'full') mark.full = true;
    current.marks[binId] = mark;
    saveMarks();
  }
  render();
}

function undo() {
  const last = undoStack.pop();
  if (!last || last.floor !== current.floor) return;
  if (last.skipped) {
    skipped.delete(last.binId);
  } else {
    if (last.before) current.marks[last.binId] = last.before;
    else delete current.marks[last.binId];
    saveMarks();
  }
  render();
}

function binDetails(bin) {
  const parts = [
    `Tower ${bin.tower}`,
    `Kat ${bin.floor}`,
    `Koridor ${bin.aisle}`,
    `Sıra ${bin.position}`,
    `Bin ${bin.shelf}`,
  ];
  return parts.join(' · ');
}

function renderSuggestion(bin, total) {
  const card = el('article', 'stowmap-card');
  card.append(
    el('div', 'stowmap-count', `Uygun lokasyon: ${total.toLocaleString('tr-TR')}`),
    el('div', 'stowmap-bin', bin.id),
    el('div', 'stowmap-parts', binDetails(bin)),
    el(
      'div',
      'stowmap-meta',
      `Unique ASIN: ${bin.effectiveUnique}/${bin.max} · ${bin.free} farklı ASIN daha atılabilir · ` +
        `Total Units: ${bin.totalUnits}`
    ),
    el('div', 'stowmap-meta', `Bin Type: ${bin.binType} · ${bin.dropzone}${bin.canHoldHrv ? ' · HRV alabilir' : ''}`)
  );

  const mark = current.marks[bin.id];
  if (mark?.added) card.append(el('div', 'stowmap-note', `Bu oturumda ${mark.added} stow kaydedildi`));

  const actions = el('div', 'stowmap-actions');
  const button = (label, className, onClick) => {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  actions.append(
    button('Stow yapıldı (+1)', 'btn-stowed', () => record(bin.id, 'stowed')),
    button('Dolu', 'btn-full', () => record(bin.id, 'full')),
    button('Atla', 'btn-skip', () => record(bin.id, 'skip'))
  );
  card.append(actions);
  return card;
}

const fmt = (n) => n.toLocaleString('tr-TR');
const fmtPercent = (p) => (p === null ? '-' : `%${p.toLocaleString('tr-TR')}`);

// Occupancy colors: green = plenty of room, yellow = filling up, red = nearly full.
function occupancyClass(percent) {
  if (percent === null) return null;
  if (percent >= 90) return 'occ-high';
  if (percent >= 70) return 'occ-mid';
  return 'occ-low';
}

function detailTable(title, groups, { highlight = null } = {}) {
  const table = el('table', 'stowmap-detail-table');
  const head = el('tr');
  for (const label of [title, 'Doluluk', 'Boş yeri olan', 'Toplam', 'Boş ASIN yeri', 'Kilitli']) head.append(el('th', null, label));
  table.append(el('thead'));
  table.tHead.append(head);
  const body = el('tbody');
  for (const g of groups) {
    const tr = el('tr', highlight?.has(String(g.key)) ? 'is-selected' : null);
    tr.append(el('td', null, String(g.key)));
    const occupancy = el('td', occupancyClass(g.occupancy), fmtPercent(g.occupancy));
    occupancy.title = `${fmt(g.used)} / ${fmt(g.capacity)} ASIN yeri dolu`;
    tr.append(occupancy);
    for (const value of [fmt(g.available), fmt(g.total), fmt(g.freeSlots), fmt(g.locked)]) {
      tr.append(el('td', null, String(value)));
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}

/** "Detay": how many bins of the current selection still have room. */
function renderDetail(criteria, aisles) {
  detailEl.hidden = false;
  const summary = summarizeBins(current.bins, current.marks, {
    tower: criteria.tower,
    aisles,
    dropzone: criteria.dropzone,
    hrvOnly: criteria.hrvOnly,
    shelves: criteria.shelves,
  });
  const s = summary.selection;
  detailSummaryEl.textContent =
    `Detay — ${fmt(s.available)} lokasyonda boş yer var (${fmt(s.freeSlots)} farklı ASIN yeri)`;

  const scope = [
    `Kat ${criteria.floor}`,
    `Tower ${criteria.tower}`,
    criteria.aisles.trim() ? `Koridor ${criteria.aisles.trim()}` : 'tüm koridorlar',
    criteria.shelves.length > 0 ? `Bin ${criteria.shelves.join(', ')}` : 'tüm binler',
    criteria.dropzone || null,
    criteria.hrvOnly ? 'HRV alabilen' : null,
  ].filter(Boolean);

  const children = [
    el('div', 'stowmap-detail-scope', scope.join(' · ')),
    el(
      'div',
      'stowmap-detail-totals',
      `Doluluk ${fmtPercent(s.occupancy)} (${fmt(s.used)} / ${fmt(s.capacity)} ASIN yeri) · ` +
        `Toplam ${fmt(s.total)} lokasyon · ${fmt(s.available)} boş yeri olan · ` +
        `${fmt(s.total - s.available - s.locked)} dolu · ${fmt(s.locked)} kilitli`
    ),
  ];
  if (summary.byShelf.length > 0) {
    // Every shelf is listed so they can be compared; the chosen ones are highlighted.
    children.push(detailTable('Bin', summary.byShelf, { highlight: new Set(criteria.shelves) }));
    children.push(detailTable('Koridor', summary.byAisle));
    children.push(detailTable('Bin Type', summary.byBinType));
  }
  detailBodyEl.replaceChildren(...children);
}

function render() {
  renderFloors();
  if (!current.floor) {
    detailEl.hidden = true;
    resultEl.replaceChildren();
    return;
  }

  const criteria = readCriteria();
  renderDetail(criteria, parseAisleSpec(criteria.aisles));
  const candidates = findCandidates(current.bins, current.marks, {
    tower: criteria.tower,
    aisles: parseAisleSpec(criteria.aisles),
    shelves: criteria.shelves,
    dropzone: criteria.dropzone,
    hrvOnly: criteria.hrvOnly,
    skip: skipped,
  });

  const children = [];
  if (candidates.length === 0) {
    children.push(el('div', 'empty-state', 'Bu seçime uygun boş lokasyon kalmadı.'));
  } else {
    children.push(renderSuggestion(candidates[0], candidates.length));
    const next = candidates.slice(1, 1 + NEXT_COUNT);
    if (next.length > 0) {
      const list = el('ul', 'stowmap-next');
      for (const bin of next) {
        list.append(el('li', null, `${bin.id} · ${bin.effectiveUnique}/${bin.max} · ${bin.binType}`));
      }
      children.push(el('div', 'stowmap-next-title', 'Sıradakiler'), list);
    }
  }

  if (undoStack.length > 0 && undoStack.at(-1).floor === current.floor) {
    const undoButton = el('button', 'btn-undo', 'Son işlemi geri al');
    undoButton.type = 'button';
    undoButton.addEventListener('click', undo);
    children.push(undoButton);
  }
  resultEl.replaceChildren(...children);
}

async function selectFloor(floor) {
  await loadFloor(floor);
  fillFloorOptions();
  render();
}

async function importFiles(files) {
  const messages = [];
  const updates = {};
  for (const file of files) {
    const parsed = parseStowMapCsv(await file.text());
    if (parsed.error) {
      messages.push(`${file.name}: ${parsed.error}`);
      continue;
    }
    for (const [floor, bins] of Object.entries(parsed.floors)) {
      const importedAt = Date.now();
      updates[floorKey(floor)] = { fileName: file.name, importedAt, bins };
      // New data from StowMap is the truth again: drop this floor's records.
      updates[marksKey(floor)] = {};
      floorsMeta[floor] = { fileName: file.name, importedAt, count: bins.length };
      messages.push(`${file.name}: Kat ${floor}, ${bins.length.toLocaleString('tr-TR')} lokasyon`);
    }
    if (parsed.skipped > 0) messages.push(`${file.name}: ${parsed.skipped} satır okunamadı, atlandı`);
  }

  updates[FLOORS_KEY] = floorsMeta;
  await chrome.storage.local.set(updates);

  const importedFloors = Object.keys(updates)
    .filter((k) => k.startsWith('stowMap:floor:'))
    .map((k) => k.split(':')[2]);
  undoStack.length = 0;
  skipped.clear();

  fillSelect(floorSelect, Object.keys(floorsMeta).sort(), {
    selected: importedFloors[0] ?? floorSelect.value,
  });
  await selectFloor(floorSelect.value);
  resultEl.prepend(el('div', 'stowmap-import-note', messages.join(' · ')));
}

fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length === 0) return;
  resultEl.replaceChildren(el('div', null, 'Yükleniyor...'));
  try {
    await importFiles(files);
  } catch (error) {
    resultEl.replaceChildren(el('div', 'empty-state', `Yüklenemedi: ${error?.message ?? error}`));
  }
});

floorSelect.addEventListener('change', async () => {
  saveCriteria();
  await selectFloor(floorSelect.value);
});

towerSelect.addEventListener('change', () => {
  saveCriteria();
  fillTowerOptions();
  render();
});

for (const input of [aislesInput, dropzoneSelect, hrvInput]) {
  input.addEventListener(input === aislesInput ? 'input' : 'change', () => {
    saveCriteria();
    render();
  });
}

shelvesEl.addEventListener('change', () => {
  saveCriteria();
  render();
});

async function init() {
  const data = await chrome.storage.local.get([FLOORS_KEY, CRITERIA_KEY]);
  floorsMeta = data[FLOORS_KEY] ?? {};
  savedCriteria = data[CRITERIA_KEY] ?? {};
  aislesInput.value = savedCriteria.aisles ?? '';
  hrvInput.checked = Boolean(savedCriteria.hrvOnly);
  fillSelect(floorSelect, Object.keys(floorsMeta).sort(), { selected: savedCriteria.floor });
  await selectFloor(floorSelect.value || null);
}

init();

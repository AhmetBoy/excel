import {
  DEFAULT_SORT,
  SORT_ORDERS,
  buildExportRows,
  describeSection,
  exportFileName,
  selectSectionBins,
} from '../shared/stowMapExport.js';
import { buildXlsx } from '../shared/xlsxWriter.js';

// chrome.storage.local:
//   stowMap:exports     -> [{ id, name, sections, savedAt }]
//   stowMap:exportDraft -> { name, sections, editingId } (the list being built)
const EXPORTS_KEY = 'stowMap:exports';
const DRAFT_KEY = 'stowMap:exportDraft';
// More header lines than this and freezing them would fill the screen.
const MAX_FROZEN_ROWS = 8;

const sortSelect = document.getElementById('stowmap-export-sort');
const availableInput = document.getElementById('stowmap-export-available');
const addButton = document.getElementById('stowmap-export-add');
const sectionsEl = document.getElementById('stowmap-export-sections');
const nameInput = document.getElementById('stowmap-export-name');
const saveButton = document.getElementById('stowmap-export-save');
const clearButton = document.getElementById('stowmap-export-clear');
const statusEl = document.getElementById('stowmap-export-status');
const savedEl = document.getElementById('stowmap-export-saved');

let lists = [];
let draft = { name: '', sections: [], editingId: null };
let readCriteria;
let floorData;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, title, onClick) {
  const b = el('button', null, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function formatDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function saveDraft() {
  chrome.storage.local.set({ [DRAFT_KEY]: draft });
}

function moveSection(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= draft.sections.length) return;
  const [section] = draft.sections.splice(index, 1);
  draft.sections.splice(target, 0, section);
  saveDraft();
  renderSections();
}

function renderSections() {
  if (draft.sections.length === 0) {
    sectionsEl.replaceChildren(el('li', 'export-sub', 'Henüz bölüm yok.'));
    return;
  }
  sectionsEl.replaceChildren(
    ...draft.sections.map((section, index) => {
      const row = el('li', 'export-row');
      const text = el('div', 'export-text');
      text.append(el('strong', null, `Bölüm ${index + 1}`), el('div', 'export-sub', describeSection(section)));
      row.append(
        text,
        button('↑', 'Yukarı taşı', () => moveSection(index, -1)),
        button('↓', 'Aşağı taşı', () => moveSection(index, 1)),
        button('✕', 'Bölümü çıkar', () => {
          draft.sections.splice(index, 1);
          saveDraft();
          renderSections();
        })
      );
      return row;
    })
  );
}

function renderSaved() {
  if (lists.length === 0) {
    savedEl.replaceChildren(el('li', 'export-sub', 'Kayıtlı liste yok.'));
    return;
  }
  savedEl.replaceChildren(
    ...lists.map((list) => {
      const row = el('li', 'export-row');
      const text = el('div', 'export-text');
      text.append(
        el('strong', null, list.name),
        el('div', 'export-sub', `${list.sections.length} bölüm · kaydedildi ${formatDate(list.savedAt)}`)
      );
      row.append(
        text,
        button('İndir', 'Güncel verilerle Excel indir', () => download(list)),
        button('Düzenle', 'Bölümleri yukarıdaki listeye yükle', () => {
          draft = { name: list.name, sections: structuredClone(list.sections), editingId: list.id };
          nameInput.value = list.name;
          saveDraft();
          renderSections();
          setStatus(`"${list.name}" düzenleniyor. Değişiklikten sonra Kaydet'e basın.`);
        }),
        button('Sil', 'Listeyi sil', async () => {
          if (!confirm(`"${list.name}" listesi silinsin mi?`)) return;
          lists = lists.filter((l) => l.id !== list.id);
          if (draft.editingId === list.id) draft.editingId = null;
          await chrome.storage.local.set({ [EXPORTS_KEY]: lists, [DRAFT_KEY]: draft });
          renderSaved();
        })
      );
      return row;
    })
  );
}

function addSection() {
  const c = readCriteria();
  if (!c.floor) return;
  draft.sections.push({
    floor: c.floor,
    tower: c.tower,
    aisles: c.aisles,
    positions: c.positions,
    shelves: [...c.shelves].sort(),
    dropzone: c.dropzone,
    hrvOnly: c.hrvOnly,
    skipEmpty: c.skipEmpty,
    onlyAvailable: availableInput.checked,
    sort: sortSelect.value || DEFAULT_SORT,
  });
  saveDraft();
  renderSections();
  setStatus('');
}

async function download(list) {
  setStatus(`"${list.name}" hazırlanıyor...`);
  try {
    const cache = new Map();
    const parts = [];
    for (const section of list.sections) {
      if (!cache.has(section.floor)) cache.set(section.floor, await floorData(section.floor));
      const data = cache.get(section.floor);
      parts.push(
        data
          ? { section, bins: selectSectionBins(data.bins, data.marks, section) }
          : { section, bins: [], missing: true }
      );
    }

    const now = new Date();
    const { rows, headerRows, columnWidths } = buildExportRows(list.name, parts, now);
    const bytes = buildXlsx({
      sheetName: list.name,
      rows,
      columnWidths,
      freeze: headerRows <= MAX_FROZEN_ROWS ? { rows: headerRows, cols: 0 } : undefined,
    });
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(list.name, now);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const total = parts.reduce((sum, p) => sum + p.bins.length, 0);
    const missing = parts.filter((p) => p.missing).map((p) => p.section.floor);
    setStatus(
      `"${list.name}" indirildi: ${total.toLocaleString('tr-TR')} lokasyon.` +
        (missing.length > 0 ? ` Yüklü olmayan kat: ${[...new Set(missing)].join(', ')}` : '')
    );
  } catch (error) {
    setStatus(`İndirilemedi: ${error?.message ?? error}`);
  }
}

async function save() {
  const name = nameInput.value.trim();
  if (!name) {
    setStatus('Önce bir liste adı yazın.');
    nameInput.focus();
    return;
  }
  if (draft.sections.length === 0) {
    setStatus('Önce en az bir bölüm ekleyin.');
    return;
  }

  // Same list being edited, or one with the same name, is overwritten.
  const existing =
    lists.find((l) => l.id === draft.editingId) ??
    lists.find((l) => l.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'));
  const list = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    sections: structuredClone(draft.sections),
    savedAt: Date.now(),
  };
  lists = existing ? lists.map((l) => (l.id === existing.id ? list : l)) : [...lists, list];
  draft = { name, sections: draft.sections, editingId: list.id };
  await chrome.storage.local.set({ [EXPORTS_KEY]: lists, [DRAFT_KEY]: draft });
  renderSaved();
  await download(list);
}

/**
 * @param {{ readCriteria: () => object,
 *   floorData: (floor: string) => Promise<{ bins: object[], marks: object } | null> }} deps
 */
export async function initStowMapExport(deps) {
  ({ readCriteria, floorData } = deps);
  sortSelect.replaceChildren(
    ...Object.entries(SORT_ORDERS).map(([value, order]) => new Option(order.label, value))
  );

  const data = await chrome.storage.local.get([EXPORTS_KEY, DRAFT_KEY]);
  lists = data[EXPORTS_KEY] ?? [];
  draft = { name: '', sections: [], editingId: null, ...(data[DRAFT_KEY] ?? {}) };
  nameInput.value = draft.name ?? '';

  addButton.addEventListener('click', addSection);
  saveButton.addEventListener('click', save);
  clearButton.addEventListener('click', () => {
    draft = { name: '', sections: [], editingId: null };
    nameInput.value = '';
    saveDraft();
    renderSections();
    setStatus('');
  });
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value;
    saveDraft();
  });

  renderSections();
  renderSaved();
}

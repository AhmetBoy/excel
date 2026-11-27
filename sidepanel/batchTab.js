// Batch tab: collect brand + batch code + known production date / SKT
// samples and export them as CSV (see shared/batchSamples.js).
import {
  BRANDS,
  SAMPLES_KEY,
  SOURCES,
  brandCounts,
  buildSample,
  formatSampleDate,
  samplesToCsv,
} from '../shared/batchSamples.js';

const form = document.getElementById('batch-form');
const brandInput = document.getElementById('batch-brand');
const brandList = document.getElementById('batch-brand-list');
const codeInput = document.getElementById('batch-code');
const productionInput = document.getElementById('batch-production');
const expiryInput = document.getElementById('batch-expiry');
const sourceSelect = document.getElementById('batch-source');
const noteInput = document.getElementById('batch-note');
const statusEl = document.getElementById('batch-status');
const countsEl = document.getElementById('batch-counts');
const filterInput = document.getElementById('batch-filter');
const exportButton = document.getElementById('batch-export');
const body = document.getElementById('batch-body');
const totalEl = document.getElementById('batch-total');

let samples = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(text, level = 'info') {
  statusEl.className = `locbar-status locbar-${level}`;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

const sourceLabel = (id) => SOURCES.find((s) => s.id === id)?.label ?? id;

function renderOptions() {
  brandList.replaceChildren(...BRANDS.map((brand) => Object.assign(document.createElement('option'), { value: brand })));
  sourceSelect.replaceChildren(
    ...SOURCES.map((s) => Object.assign(document.createElement('option'), { value: s.id, textContent: s.label }))
  );
}

function render() {
  countsEl.replaceChildren(
    ...brandCounts(samples).map(({ brand, count, target }) => {
      const chip = el('button', `batch-chip${count >= target ? ' batch-chip-done' : ''}`, `${brand} ${count}/${target}`);
      chip.type = 'button';
      chip.title = `${brand} örneklerini göster`;
      chip.addEventListener('click', () => {
        filterInput.value = filterInput.value === brand ? '' : brand;
        render();
      });
      return chip;
    })
  );

  const filter = filterInput.value.trim().toLocaleLowerCase('tr');
  const shown = samples
    .filter((s) => !filter || `${s.brand} ${s.batchCode} ${s.note}`.toLocaleLowerCase('tr').includes(filter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  body.replaceChildren(
    ...shown.map((s) => {
      const row = document.createElement('tr');
      const remove = el('button', 'small-button', 'Sil');
      remove.type = 'button';
      remove.addEventListener('click', () => removeSample(s));
      const cells = [
        s.brand,
        s.batchCode,
        formatSampleDate(s.production),
        formatSampleDate(s.expiry),
        sourceLabel(s.source),
        s.note,
      ].map((text, i) => el('td', i === 1 ? 'batch-code-cell' : null, text || '—'));
      const action = el('td');
      action.append(remove);
      row.append(...cells, action);
      return row;
    })
  );
  totalEl.textContent = filter
    ? `${shown.length} / ${samples.length} örnek`
    : `${samples.length} örnek`;
  exportButton.disabled = samples.length === 0;
}

async function save(next) {
  samples = next;
  await chrome.storage.local.set({ [SAMPLES_KEY]: samples });
  render();
}

async function removeSample(sample) {
  if (!window.confirm(`${sample.brand} ${sample.batchCode} silinsin mi?`)) return;
  await save(samples.filter((s) => s.id !== sample.id));
  setStatus(`${sample.brand} ${sample.batchCode} silindi.`, 'info');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = buildSample(
    {
      brand: brandInput.value,
      batchCode: codeInput.value,
      production: productionInput.value,
      expiry: expiryInput.value,
      source: sourceSelect.value,
      note: noteInput.value,
    },
    samples
  );
  if (result.error) {
    setStatus(result.error, 'warn');
    return;
  }
  await save([...samples, result.sample]);
  brandInput.value = result.sample.brand;
  const count = samples.filter((s) => s.brand === result.sample.brand).length;
  setStatus(`Kaydedildi: ${result.sample.brand} ${result.sample.batchCode} (${result.sample.brand} için ${count}. örnek).`, 'ok');
  // Brand and source stay for the next sample of the same brand.
  codeInput.value = '';
  productionInput.value = '';
  expiryInput.value = '';
  noteInput.value = '';
  codeInput.focus();
});

// Pick the whole brand text on focus so typing starts a new search.
brandInput.addEventListener('focus', () => brandInput.select());
filterInput.addEventListener('input', render);

exportButton.addEventListener('click', () => {
  const blob = new Blob([samplesToCsv(samples)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `batch-ornekleri_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`${samples.length} örnek CSV olarak indirildi.`, 'ok');
});

// Samples saved in another panel window show up here too.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SAMPLES_KEY]) {
    samples = changes[SAMPLES_KEY].newValue ?? [];
    render();
  }
});

renderOptions();
setStatus('');
chrome.storage.local.get(SAMPLES_KEY).then((data) => {
  samples = data[SAMPLES_KEY] ?? [];
  render();
});

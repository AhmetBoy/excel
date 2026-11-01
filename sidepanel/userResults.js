import { displayOrMissing } from '../shared/normalize.js';
import { describeSourceStatus } from '../shared/resultsView.js';
import { countVariety, sumQuantity } from '../shared/toteChecks.js';
import { HISTORY_DAYS, analyzeStowErrors, systemQuantityInBin } from '../shared/stowErrors.js';
import { createBarcodeElement } from './barcodeDom.js';

const INVENTORY_COLUMNS = [
  { key: 'asin', label: 'ASIN' },
  { key: 'title', label: 'Title' },
  { key: 'quantity', label: 'Qty' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'consumer', label: 'Consumer' },
];

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = textContent;
  return node;
}

function inventoryBadge(inventory) {
  if (inventory.status !== 'ok') {
    const level = inventory.status === 'not_found' || inventory.status === 'no_data' ? 'warn' : 'error';
    return el('span', `status-badge ${level}`, describeSourceStatus(inventory.status));
  }
  const { records } = inventory;
  return el('span', 'status-badge ok', `${sumQuantity(records)} ürün · ${countVariety(records)} çeşit`);
}

function inventoryTable(records) {
  const table = el('table', 'inventory-mini');
  const headRow = el('tr');
  for (const column of INVENTORY_COLUMNS) headRow.appendChild(el('th', null, column.label));
  table.appendChild(el('thead')).appendChild(headRow);
  const body = table.appendChild(el('tbody'));
  for (const record of records) {
    const row = el('tr');
    for (const column of INVENTORY_COLUMNS) {
      row.appendChild(el('td', null, displayOrMissing(record[column.key])));
    }
    body.appendChild(row);
  }
  return table;
}

function systemQuantityText(binInventory, group) {
  if (!binInventory) return 'Adres sorgulanamadı';
  if (binInventory.status !== 'ok' && binInventory.status !== 'no_data' && binInventory.status !== 'not_found') {
    return `Adres: ${describeSourceStatus(binInventory.status)}`;
  }
  return `Sistemde olması gereken: ${systemQuantityInBin(binInventory.records, group)} adet`;
}

function stowErrorBlock(container, analysis, binInventory) {
  const block = el('div', 'stow-errors');
  const { history } = container;

  if (!history || (history.status !== 'ok' && history.status !== 'no_data')) {
    block.appendChild(
      el('span', 'status-badge error', `History: ${describeSourceStatus(history?.status ?? 'error')}`)
    );
    return block;
  }

  if (analysis.groups.length === 0) {
    block.appendChild(el('span', 'stow-ok', `Stow hatası yok (son ${HISTORY_DAYS} gün)`));
  } else {
    block.classList.add('has-errors');
    block.appendChild(el('div', 'stow-errors-title', `Geri toplanacak: ${analysis.totalToPick} adet`));
    for (const group of analysis.groups) {
      const line = el('div', 'stow-error-line');
      line.append(
        el('strong', null, group.bin),
        el('span', null, ` · ${group.fnSku ?? group.asin ?? '—'}`),
        el('span', 'stow-pick', ` → ${group.toPick} adet geri topla`),
        el('span', 'stow-detail', ` (atılamadı ${group.failed}, atıldı ${group.succeeded})`)
      );
      block.appendChild(line);
      block.appendChild(el('div', 'stow-system-qty', systemQuantityText(binInventory?.[group.bin], group)));
    }
  }

  if (analysis.otherPeopleFailed > 0) {
    block.appendChild(
      el('div', 'stow-detail', `Başka kullanıcılara ait ${analysis.otherPeopleFailed} hatalı kayıt sayılmadı.`)
    );
  }
  if (history.status === 'partial_failure') {
    block.appendChild(el('span', 'status-badge warn', 'History eksik olabilir'));
  }
  return block;
}

function containerCard(container, analysis, binInventory, onOpenContainer) {
  const card = el('article', 'container-card');
  card.appendChild(createBarcodeElement(container.scannableId));

  const head = el('div', 'card-head');
  head.append(
    el('strong', null, container.scannableId),
    el('span', 'card-type', container.type ?? ''),
    inventoryBadge(container.inventory)
  );
  const openButton = el('button', 'small-button', 'Ara');
  openButton.type = 'button';
  openButton.title = 'Bu konteyneri normal tote aramasıyla aç';
  openButton.addEventListener('click', () => onOpenContainer(container.scannableId));
  head.appendChild(openButton);
  card.appendChild(head);
  card.appendChild(stowErrorBlock(container, analysis, binInventory));

  if (container.inventory.records.length > 0) {
    const details = el('details');
    details.appendChild(el('summary', null, 'Inventory'));
    details.appendChild(inventoryTable(container.inventory.records));
    card.appendChild(details);
  }
  return card;
}

/**
 * Renders the result of a LOOKUP_USER request: where the associate is, a
 * barcode per tote/csX on them, and each container's Inventory contents.
 *
 * @param {HTMLElement} target
 * @param {object} response - from background lookupUser()
 * @param {(scannableId: string) => void} onOpenContainer
 */
export function renderUserResults(target, response, onOpenContainer) {
  const summary = el('div', 'user-summary');
  summary.appendChild(el('strong', null, response.query));

  const location = (response.path ?? []).filter((step) => step.id !== response.query);
  if (location.length > 0) {
    summary.appendChild(el('div', 'user-location', `Konum: ${location.map((s) => s.id).join(' › ')}`));
  }

  const containers = response.containers ?? [];
  const allRecords = containers.flatMap((c) => c.inventory.records);
  const analyses = containers.map((c) =>
    analyzeStowErrors(c.history?.records ?? [], { container: c.scannableId, person: response.login })
  );
  const totalToPick = analyses.reduce((sum, a) => sum + a.totalToPick, 0);
  let countText;
  if (containers.length > 0) {
    countText = `${containers.length} konteyner · toplam ${sumQuantity(allRecords)} ürün`;
  } else if (response.status === 'no_data') {
    countText = 'Kullanıcının üzerinde konteyner yok.';
  } else {
    countText = `FC Research: ${describeSourceStatus(response.status)}`;
  }
  summary.appendChild(el('div', 'user-count', countText));
  if (totalToPick > 0) {
    const bins = new Set(analyses.flatMap((a) => a.groups.map((g) => g.bin)));
    summary.appendChild(
      el('div', 'verdict verdict-action', `✖ Stow hatası: ${bins.size} adresten toplam ${totalToPick} adet geri toplanacak`)
    );
  }
  if (response.status === 'partial_failure') {
    summary.appendChild(el('div', 'status-badge warn', 'Liste eksik olabilir: sonraki sayfa alınamadı'));
  }

  const grid = el('div', 'barcode-grid');
  containers.forEach((container, index) => {
    grid.appendChild(containerCard(container, analyses[index], response.binInventory, onOpenContainer));
  });

  target.replaceChildren(summary, grid);
}

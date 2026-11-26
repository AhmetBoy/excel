// An LPN is one physical unit, so it can be in one place only. From where
// Inventory says it is (or, when Inventory has none, its Inventory History)
// this tells the associate what to do with it. First version, from the
// rules given 2026-11-26; to be refined on a real example.

// Bin address, e.g. P-1-A200A100 (same shape as the lookup's location rule).
const BIN_PATTERN = /^[A-Z]{1,3}-\d{1,3}-[A-Z0-9]+$/i;
// Virtual containers start with "vt" (vttsCRETSELL, vttsXSA90...).
const VIRTUAL_PATTERN = /^vt/i;
// A virtual container of this site's totes (vttsXSA90...) is cleared with
// Sideline; any other virtual container (vttsCRETSELL) with LPN Move.
const VIRTUAL_SIDELINE_PATTERN = /XSA9/i;

// Inventory History: RS "M" = missed, OP or RS "D" = deleted.
function lossOf(record) {
  const op = (record.op ?? '').trim().toUpperCase();
  const rs = (record.rs ?? '').trim().toUpperCase();
  if (rs === 'M') return 'miss';
  if (op === 'D' || rs === 'D') return 'delete';
  return null;
}

const LOSS_LABELS = { miss: 'miss', delete: 'delete' };

function byDateDesc(a, b) {
  return (b.date ?? '').localeCompare(a.date ?? '');
}

function describeContainer(container) {
  if (BIN_PATTERN.test(container)) {
    return { level: 'move', message: `Lütfen bu ürünü ${container} adresine götürün.` };
  }
  if (VIRTUAL_PATTERN.test(container)) {
    return VIRTUAL_SIDELINE_PATTERN.test(container)
      ? { level: 'action', message: `Ürün ${container} üzerinde — Sideline ile ürünü çekiniz.` }
      : { level: 'action', message: `Ürün ${container} üzerinde — LPN Move ile çekin.` };
  }
  return { level: 'move', message: `Lütfen bu ürünü ${container} üzerinden stowlayın.` };
}

/**
 * @param {{ rows?: object[], history?: object[], historyStatus?: string }} input
 *   rows: Inventory rows of the LPN; history: its Inventory History records
 * @returns {{ level: 'move'|'action'|'warn'|'info', message: string, detail?: string } | null}
 */
export function lpnGuidance({ rows = [], history = [], historyStatus } = {}) {
  const containers = [...new Set(rows.map((row) => row.container).filter(Boolean))];

  if (containers.length > 1) {
    return {
      level: 'warn',
      message: `LPN tek yerde olmalı ama Inventory ${containers.length} yerde gösteriyor: ${containers.join(', ')}`,
    };
  }
  if (containers.length === 1) return describeContainer(containers[0]);

  // Not in Inventory: what happened to it last.
  const records = [...history].sort(byDateDesc);
  const lost = records.find((record) => lossOf(record));
  if (lost) {
    const kind = LOSS_LABELS[lossOf(lost)];
    const who = lost.person ? ` (${lost.person})` : '';
    const where = lost.oldBin ? ` · ${lost.oldBin}` : '';
    return {
      level: 'action',
      message: `Ürün ${kind} edilmiş — fiziksel olarak bizde olduğuna göre Found edilmesi gerekiyor, ICQA'e gidecek.`,
      detail: `${lost.date ?? '?'}${who}${where}`,
    };
  }

  if (records.length > 0) {
    const last = records[0];
    const move = [last.oldBin, last.newBin].filter(Boolean).join(' → ');
    return {
      level: 'warn',
      message: "Ürün Inventory'de yok; History'de miss / delete kaydı da yok.",
      detail: `Son kayıt: ${last.date ?? '?'} · ${last.op ?? '?'}${move ? ` · ${move}` : ''}${last.person ? ` · ${last.person}` : ''}`,
    };
  }

  if (historyStatus && !['ok', 'not_found', 'no_data'].includes(historyStatus)) {
    return { level: 'warn', message: "Ürün Inventory'de yok; Inventory History okunamadı." };
  }
  return { level: 'warn', message: "Ürün Inventory'de ve Inventory History'de bulunamadı." };
}

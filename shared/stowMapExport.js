// StowMap Excel lists: a saved list is an ordered set of "sections", each
// one a bin selection (floor, tower, aisles, positions, shelves...) with
// its own sort order. The list keeps only the layout; the bins are read
// from the latest imported CSV every time it is downloaded.

import { effectiveUnique, inRanges, isStowablePosition, parseAisleSpec } from './stowMap.js';
import { XLSX_STYLE } from './xlsxWriter.js';

export const SORT_ORDERS = {
  'aisle-position-shelf': { label: 'Koridor › Sıra › Bin', keys: ['aisle', 'position', 'shelf'] },
  'shelf-aisle-position': { label: 'Bin › Koridor › Sıra', keys: ['shelf', 'aisle', 'position'] },
  'aisle-shelf-position': { label: 'Koridor › Bin › Sıra', keys: ['aisle', 'shelf', 'position'] },
};
export const DEFAULT_SORT = 'aisle-position-shelf';

function compareBy(keys) {
  return (a, b) => {
    for (const key of keys) {
      const x = a[key];
      const y = b[key];
      const diff = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
      if (diff !== 0) return diff;
    }
    return 0;
  };
}

/**
 * Bins of one section, in the section's sort order.
 *
 * @param {object[]} bins - expanded bins of the section's floor
 * @param {Record<string, {added?: number, full?: boolean}>} marks
 * @param {{ tower?: string, aisles?: string, positions?: string, shelves?: string[],
 *   dropzone?: string, hrvOnly?: boolean, skipEmpty?: boolean, onlyAvailable?: boolean, sort?: string }} section
 * @returns {Array<object & { effectiveUnique: number, free: number }>}
 */
export function selectSectionBins(bins, marks, section) {
  const aisles = parseAisleSpec(section.aisles);
  const positions = parseAisleSpec(section.positions);
  const shelfSet = section.shelves?.length > 0 ? new Set(section.shelves) : null;
  const keys = (SORT_ORDERS[section.sort] ?? SORT_ORDERS[DEFAULT_SORT]).keys;

  return bins
    .filter(
      (bin) =>
        isStowablePosition(bin) &&
        (!section.tower || bin.tower === section.tower) &&
        (!shelfSet || shelfSet.has(bin.shelf)) &&
        (!section.dropzone || bin.dropzone === section.dropzone) &&
        (!section.hrvOnly || bin.canHoldHrv) &&
        inRanges(aisles, bin.aisle) &&
        inRanges(positions, bin.position)
    )
    .map((bin) => {
      const used = effectiveUnique(bin, marks?.[bin.id]);
      return { ...bin, effectiveUnique: used, free: bin.locked ? 0 : bin.max - used };
    })
    .filter((bin) => !section.onlyAvailable || (!bin.locked && bin.free > 0))
    .filter((bin) => !section.skipEmpty || bin.effectiveUnique > 0)
    .sort(compareBy(keys));
}

/** Short Turkish description of a section, e.g. for the list and the "Bölüm" column. */
export function describeSection(section) {
  return [
    `Kat ${section.floor}`,
    section.tower ? `Tower ${section.tower}` : null,
    section.aisles?.trim() ? `Koridor ${section.aisles.trim()}` : null,
    section.positions?.trim() ? `Sıra ${section.positions.trim()}` : null,
    section.shelves?.length > 0 ? `Bin ${section.shelves.join(', ')}` : 'tüm binler',
    section.dropzone || null,
    section.hrvOnly ? 'HRV alabilen' : null,
    section.skipEmpty ? 'boş (0 ürün) olanlar hariç' : null,
    section.onlyAvailable ? 'boş yeri olanlar' : 'hepsi',
    (SORT_ORDERS[section.sort] ?? SORT_ORDERS[DEFAULT_SORT]).label,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const EXPORT_COLUMNS = [
  { label: 'No', width: 6, value: (bin, i) => i + 1 },
  { label: 'Bölüm', width: 8, value: (bin, i, sectionNo) => sectionNo },
  { label: 'Lokasyon', width: 16, value: (bin) => bin.id },
  { label: 'Kat', width: 5, value: (bin) => Number(bin.floor) },
  { label: 'Tower', width: 7, value: (bin) => bin.tower },
  { label: 'Koridor', width: 8, value: (bin) => bin.aisle },
  { label: 'Sıra', width: 6, value: (bin) => bin.position },
  { label: 'Bin', width: 5, value: (bin) => bin.shelf },
  { label: 'Bin Type', width: 18, value: (bin) => bin.binType },
  { label: 'Dropzone', width: 18, value: (bin) => bin.dropzone },
  { label: 'Unique ASIN', width: 11, value: (bin) => bin.effectiveUnique },
  { label: 'Max', width: 6, value: (bin) => bin.max },
  { label: 'Boş yer', width: 8, value: (bin) => bin.free },
  { label: 'Total Units', width: 11, value: (bin) => bin.totalUnits },
  { label: 'HRV', width: 6, value: (bin) => (bin.canHoldHrv ? 'Evet' : 'Hayır') },
  { label: 'Kilitli', width: 7, value: (bin) => (bin.locked ? 'Evet' : 'Hayır') },
];

/**
 * Sheet rows for buildXlsx(): title, one line per section describing it,
 * a header, then every section's bins in list order (numbered 1..n overall).
 *
 * @param {string} name
 * @param {Array<{ section: object, bins: object[], missing?: boolean }>} parts
 * @param {Date} [now]
 */
export function buildExportRows(name, parts, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const total = parts.reduce((sum, p) => sum + p.bins.length, 0);

  const rows = [[{ v: `${name} · ${stamp} · ${total} lokasyon`, s: XLSX_STYLE.BOLD }]];
  parts.forEach((part, i) => {
    const note = part.missing ? ' · KAT YÜKLÜ DEĞİL' : '';
    rows.push([{ v: `Bölüm ${i + 1}: ${describeSection(part.section)} · ${part.bins.length} lokasyon${note}` }]);
  });
  rows.push([]);
  const headerIndex = rows.length;
  rows.push(EXPORT_COLUMNS.map((c) => ({ v: c.label, s: XLSX_STYLE.HEADER })));

  let n = 0;
  parts.forEach((part, sectionIndex) => {
    for (const bin of part.bins) {
      rows.push(EXPORT_COLUMNS.map((c) => ({ v: c.value(bin, n, sectionIndex + 1) })));
      n++;
    }
  });
  return { rows, headerRows: headerIndex + 1, columnWidths: EXPORT_COLUMNS.map((c) => c.width) };
}

/** File-name friendly version of a list name. */
export function exportFileName(name, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const safe = String(name || 'stowmap').trim().replace(/[\\/:*?"<>|\s]+/g, '_');
  return `${safe}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
}

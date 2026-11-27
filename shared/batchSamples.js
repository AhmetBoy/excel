// Batch kod örnekleri: brand + batch code + a known production date and/or
// SKT, collected by hand so the per-brand batch code rules can be worked out
// later (the brands don't publish them). Stored in chrome.storage.local and
// exported as CSV.

export const SAMPLES_KEY = 'batchSamples';

export const BRANDS = [
  'Nivea',
  'Fa',
  'Maybelline',
  'Burberry',
  'Calvin Klein',
  'Chanel',
  'Flormar',
  'Gucci',
  'Guess',
  'Koleston',
  "L'Oréal",
  'Old Spice',
  'Rexona',
  'Schwarzkopf',
  'Taft',
];

// Samples worth collecting per brand before a rule can be derived.
export const TARGET_SAMPLES = { Nivea: 20 };
export const DEFAULT_TARGET = 8;

export const SOURCES = [
  { id: 'package', label: 'Ürünün üzerinde' },
  { id: 'website', label: 'Batch sitesi (checkfresh vb.)' },
  { id: 'other', label: 'Diğer' },
];

/** The listed spelling of a brand typed in any case ("nivea" → "Nivea"); other names kept as typed. */
export function normalizeBrand(text) {
  const value = (text ?? '').trim().replace(/\s+/g, ' ');
  const key = value.toLocaleLowerCase('tr').replace(/['’]/g, '').replace('é', 'e');
  return BRANDS.find((b) => b.toLocaleLowerCase('tr').replace(/['’]/g, '').replace('é', 'e') === key) ?? value;
}

/** Batch code as stamped: upper case, inner spaces kept single. */
export function normalizeBatchCode(text) {
  return (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

const pad = (n) => String(n).padStart(2, '0');

function validDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * A date as printed on a package: "15.04.2027", "15/04/27", "04.2027",
 * "04/27", "2027-04-15", "2027-04". Returns "YYYY-MM-DD" or "YYYY-MM"
 * (month only), '' for empty input, or null when it can't be read.
 */
export function parseSampleDate(text) {
  const value = (text ?? '').trim();
  if (!value) return '';
  const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = /^(\d{4})[-./](\d{1,2})(?:[-./](\d{1,2}))?$/.exec(value);
  if (m) return build(Number(m[1]), Number(m[2]), m[3] && Number(m[3]));
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/.exec(value);
  if (m) return build(year(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[-./](\d{2}|\d{4})$/.exec(value);
  if (m) return build(year(m[2]), Number(m[1]));
  return null;

  function build(y, month, day) {
    if (y < 1990 || y > 2100 || month < 1 || month > 12) return null;
    if (day == null) return `${y}-${pad(month)}`;
    return validDay(y, month, day) ? `${y}-${pad(month)}-${pad(day)}` : null;
  }
}

/** "2027-04-15" → "15.04.2027", "2027-04" → "04.2027". */
export function formatSampleDate(value) {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return d ? `${d}.${m}.${y}` : `${m}.${y}`;
}

/**
 * Checks and normalizes a form entry.
 * @returns {{ sample: object } | { error: string }}
 */
export function buildSample({ brand, batchCode, production, expiry, source, note }, existing = []) {
  const cleanBrand = normalizeBrand(brand);
  if (!cleanBrand) return { error: 'Marka seçin.' };
  const code = normalizeBatchCode(batchCode);
  if (!code) return { error: 'Batch kodu yazın.' };
  const productionDate = parseSampleDate(production);
  if (productionDate === null) return { error: `Üretim tarihi okunamadı: "${production}". Ör. 15.04.2025 veya 04.2025.` };
  const expiryDate = parseSampleDate(expiry);
  if (expiryDate === null) return { error: `SKT okunamadı: "${expiry}". Ör. 15.04.2027 veya 04.2027.` };
  if (!productionDate && !expiryDate) return { error: 'Üretim tarihi veya SKT’den en az birini yazın.' };
  if (productionDate && expiryDate && expiryDate.slice(0, 7) < productionDate.slice(0, 7)) {
    return { error: 'SKT üretim tarihinden önce olamaz.' };
  }
  const duplicate = existing.find((s) => s.brand === cleanBrand && s.batchCode === code);
  if (duplicate) return { error: `${cleanBrand} ${code} zaten kayıtlı.` };
  return {
    sample: {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      brand: cleanBrand,
      batchCode: code,
      production: productionDate,
      expiry: expiryDate,
      source: SOURCES.some((s) => s.id === source) ? source : 'package',
      note: (note ?? '').trim(),
      createdAt: new Date().toISOString(),
    },
  };
}

/** [{ brand, count, target }] for the brands with samples plus the listed ones, most samples first. */
export function brandCounts(samples) {
  const counts = new Map();
  for (const s of samples ?? []) counts.set(s.brand, (counts.get(s.brand) ?? 0) + 1);
  return [...counts]
    .map(([brand, count]) => ({ brand, count, target: TARGET_SAMPLES[brand] ?? DEFAULT_TARGET }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'tr'));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS = [
  ['brand', 'marka'],
  ['batchCode', 'batch_kod'],
  ['production', 'uretim'],
  ['expiry', 'skt'],
  ['source', 'kaynak'],
  ['note', 'not'],
  ['createdAt', 'kayit_zamani'],
];

/** CSV (with a BOM so Excel reads ç/ğ/ş), ordered by brand then batch code. Dates stay ISO. */
export function samplesToCsv(samples) {
  const rows = [...(samples ?? [])].sort(
    (a, b) => a.brand.localeCompare(b.brand, 'tr') || a.batchCode.localeCompare(b.batchCode)
  );
  const lines = [CSV_COLUMNS.map(([, header]) => header).join(',')];
  for (const s of rows) lines.push(CSV_COLUMNS.map(([key]) => csvCell(s[key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

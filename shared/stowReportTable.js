const HOUR_SECONDS = 3600;

/**
 * Splits a range into consecutive one-hour slots. The last slot is
 * shorter if the range doesn't end on a whole hour (e.g. 15:00-17:30 ->
 * 15-16, 16-17, 17-17:30).
 *
 * @param {{ startTime: number, endTime: number }} range - Unix seconds
 * @returns {Array<{ startTime: number, endTime: number }>}
 */
export function buildHourlySlots({ startTime, endTime }) {
  const slots = [];
  for (let start = startTime; start < endTime; start += HOUR_SECONDS) {
    slots.push({ startTime: start, endTime: Math.min(start + HOUR_SECONDS, endTime) });
  }
  return slots;
}

/**
 * Parses a free-text list of logins (newline, comma, semicolon or space
 * separated). Case-insensitive, duplicates removed, input order kept.
 * @param {string} text
 * @returns {string[]} lowercased logins
 */
export function parseUserList(text) {
  const logins = (text ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(logins)];
}

function maxOf(values) {
  return values.reduce((max, v) => (v > max ? v : max), 0);
}

/**
 * Pivots per-slot report rows into a user x slot table with totals.
 *
 * When `users` is non-empty, only those logins are included - and every
 * one of them is included, with zeros if they had no stows in the range,
 * so an idle associate is visible rather than silently missing.
 *
 * `columnMax`/`totalMax` are the highest value per column (0 when the
 * column is empty) so the UI can highlight the top performer(s); ties all
 * share the highlight.
 *
 * @param {Array<Array<{login: string, managerId: string|null, opportunities: number}>>} slotRows - one row list per slot
 * @param {{ users?: string[] }} [options]
 */
export function buildStowTable(slotRows, { users = [] } = {}) {
  const slotCount = slotRows.length;
  const byLogin = new Map();

  const ensure = (login, managerId = null) => {
    const key = login.toLowerCase();
    let entry = byLogin.get(key);
    if (!entry) {
      entry = { login, managerId, values: new Array(slotCount).fill(0), total: 0 };
      byLogin.set(key, entry);
    } else if (!entry.managerId && managerId) {
      entry.managerId = managerId;
    }
    return entry;
  };

  const allowed = users.length > 0 ? new Set(users.map((u) => u.toLowerCase())) : null;
  if (allowed) for (const login of users) ensure(login);

  slotRows.forEach((rows, slotIndex) => {
    for (const row of rows ?? []) {
      if (allowed && !allowed.has(row.login.toLowerCase())) continue;
      const entry = ensure(row.login, row.managerId);
      entry.values[slotIndex] += row.opportunities;
      entry.total += row.opportunities;
    }
  });

  const rows = [...byLogin.values()].sort(
    (a, b) => b.total - a.total || a.login.localeCompare(b.login)
  );

  const columnTotals = Array.from({ length: slotCount }, (_, i) =>
    rows.reduce((sum, r) => sum + r.values[i], 0)
  );

  return {
    rows,
    columnTotals,
    grandTotal: rows.reduce((sum, r) => sum + r.total, 0),
    columnMax: Array.from({ length: slotCount }, (_, i) => maxOf(rows.map((r) => r.values[i]))),
    totalMax: maxOf(rows.map((r) => r.total)),
  };
}

/**
 * Converts the report (as currently shown, i.e. after filtering) into
 * spreadsheet rows for xlsxWriter - same columns, same green highlights,
 * same footer totals as the side panel table.
 *
 * @param {{ table: ReturnType<typeof buildStowTable>, rows: object[], slots: object[], hourly: boolean, title: string }} report
 * @param {{ HEADER: number, TOP: number, FOOTER: number, BOLD: number }} styles
 * @returns {Array<Array<{ v: string|number|null, s?: number }>>}
 */
export function buildStowSheetRows({ table, rows, slots, hourly, title }, styles) {
  const isTop = (value, max) => value > 0 && value === max;
  const header = (v) => ({ v, s: styles.HEADER });
  const footer = (v) => ({ v, s: styles.FOOTER });

  const headerRow = [header('#'), header('Kullanıcı')];
  if (hourly) {
    headerRow.push(...slots.map((slot) => header(formatSlotLabel(slot))), header('Toplam'));
  } else {
    headerRow.push(header('Manager'), header('Stow (Opportunities)'));
  }

  const bodyRows = rows.map((row, index) => {
    const cells = [{ v: index + 1 }, { v: row.login }];
    if (hourly) {
      row.values.forEach((value, i) => {
        cells.push(isTop(value, table.columnMax[i]) ? { v: value, s: styles.TOP } : { v: value });
      });
    } else {
      cells.push({ v: row.managerId ?? '-' });
    }
    cells.push({ v: row.total, s: isTop(row.total, table.totalMax) ? styles.TOP : styles.BOLD });
    return cells;
  });

  const footerRow = [footer(null), footer(`Toplam (${rows.length} kişi)`)];
  if (hourly) {
    slots.forEach((_, i) => footerRow.push(footer(rows.reduce((sum, r) => sum + r.values[i], 0))));
  } else {
    footerRow.push(footer(null));
  }
  footerRow.push(footer(rows.reduce((sum, r) => sum + r.total, 0)));

  return [[{ v: title, s: styles.BOLD }], [], headerRow, ...bodyRows, footerRow];
}

/**
 * "15:00-16:00" style label in the browser's local time.
 * @param {{ startTime: number, endTime: number }} slot
 */
export function formatSlotLabel({ startTime, endTime }) {
  const fmt = (seconds) => {
    const d = new Date(seconds * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(startTime)}-${fmt(endTime)}`;
}

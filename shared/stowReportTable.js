const HOUR_SECONDS = 3600;

// Report processes. Atlas answers per department: inbound holds Stow and
// Receive, outbound holds Pick. `paths` are the processPath names to read
// (case-insensitive); Pick's name is not verified against live data yet.
export const PROCESSES = [
  { id: 'stow', label: 'Stow', department: 'inbound', paths: ['Stow'] },
  { id: 'receive', label: 'Receive', department: 'inbound', paths: ['Receive'] },
  { id: 'pick', label: 'Pick', department: 'outbound', paths: ['Pick'] },
];
export const DEFAULT_PROCESSES = ['stow'];

export function processById(id) {
  return PROCESSES.find((p) => p.id === id) ?? null;
}

/** Departments Atlas has to be asked for the chosen processes. */
export function departmentsFor(processIds) {
  return [...new Set(processIds.map((id) => processById(id)?.department).filter(Boolean))];
}

function pathKeysFor(process, byPath) {
  const wanted = new Set(process.paths.map((p) => p.toLowerCase()));
  return Object.keys(byPath ?? {}).filter((key) => wanted.has(key.toLowerCase()));
}

/** One row list per slot for a process (its paths merged). */
export function slotRowsForProcess(slots, process) {
  return slots.map((slot) => pathKeysFor(process, slot?.byPath).flatMap((key) => slot.byPath[key]));
}

/** Processes Atlas returned no section for (none of their paths appear). */
export function missingProcesses(processIds, paths) {
  const seen = Object.fromEntries((paths ?? []).map((p) => [p, []]));
  return processIds
    .map(processById)
    .filter((process) => process && pathKeysFor(process, seen).length === 0);
}

// Shown in the İsim column when the user list gives no name for a login.
export const UNKNOWN_NAME = 'Bilinmiyor';

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
 * Parses the Rapor user list: one person per line (or comma/semicolon
 * separated), either "login" or "Name login" - the last word is the login,
 * anything before it is the display name ("Ahmet Yılmaz ahmet123" works).
 * Logins are lowercased; duplicates are merged, keeping input order.
 *
 * @param {string} text
 * @returns {Array<{ login: string, name: string|null }>}
 */
export function parseUserEntries(text) {
  const byLogin = new Map();
  for (const line of (text ?? '').split(/[\r\n,;]+/)) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const login = words.pop().toLowerCase();
    const name = words.join(' ') || null;
    const existing = byLogin.get(login);
    if (!existing) byLogin.set(login, { login, name });
    else if (!existing.name && name) existing.name = name;
  }
  return [...byLogin.values()];
}

/**
 * @param {string} text
 * @returns {string[]} lowercased logins from parseUserEntries()
 */
export function parseUserList(text) {
  return parseUserEntries(text).map((entry) => entry.login);
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
 * `names` maps a lowercased login to a display name (row.name; null when
 * unknown).
 *
 * @param {{ users?: string[], names?: Record<string, string|null> }} [options]
 */
export function buildStowTable(slotRows, { users = [], names = {} } = {}) {
  const slotCount = slotRows.length;
  const byLogin = new Map();

  const ensure = (login, managerId = null) => {
    const key = login.toLowerCase();
    let entry = byLogin.get(key);
    if (!entry) {
      entry = { login, name: names[key] ?? null, managerId, values: new Array(slotCount).fill(0), total: 0 };
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
export function buildStowSheetRows(
  { table, rows, slots, hourly, title, columns = null, valueLabel = 'Stow (Opportunities)' },
  styles
) {
  const isTop = (value, max) => value > 0 && value === max;
  const header = (v) => ({ v, s: styles.HEADER });
  const footer = (v) => ({ v, s: styles.FOOTER });
  // `columns` (labels) for the combined view; hourly reports use the slots.
  const labels = columns ?? (hourly ? slots.map(formatSlotLabel) : null);
  hourly = Boolean(labels);

  const headerRow = [header('#'), header('Kullanıcı'), header('İsim')];
  if (hourly) {
    headerRow.push(...labels.map(header), header('Toplam'));
  } else {
    headerRow.push(header('Manager'), header(valueLabel));
  }

  const bodyRows = rows.map((row, index) => {
    const cells = [{ v: index + 1 }, { v: row.login }, { v: row.name ?? UNKNOWN_NAME }];
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

  const footerRow = [footer(null), footer(`Toplam (${rows.length} kişi)`), footer(null)];
  if (hourly) {
    labels.forEach((_, i) => footerRow.push(footer(rows.reduce((sum, r) => sum + r.values[i], 0))));
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

/**
 * The "Toplam" view: one column per process with each person's total for
 * the whole range, plus an overall total. Same shape as buildStowTable so
 * the panel and Excel export render it like an hourly table.
 *
 * @param {Record<string, ReturnType<typeof buildStowTable>>} tables - by process id
 * @param {string[]} processIds - column order
 */
export function buildCombinedTable(tables, processIds) {
  const byLogin = new Map();
  processIds.forEach((id, column) => {
    for (const row of tables[id]?.rows ?? []) {
      const key = row.login.toLowerCase();
      let entry = byLogin.get(key);
      if (!entry) {
        entry = { login: row.login, name: row.name, managerId: row.managerId, values: new Array(processIds.length).fill(0), total: 0 };
        byLogin.set(key, entry);
      }
      entry.name ??= row.name;
      entry.managerId ??= row.managerId;
      entry.values[column] += row.total;
      entry.total += row.total;
    }
  });

  const rows = [...byLogin.values()].sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));
  const columnTotals = processIds.map((_, i) => rows.reduce((sum, r) => sum + r.values[i], 0));
  return {
    rows,
    columnTotals,
    grandTotal: rows.reduce((sum, r) => sum + r.total, 0),
    columnMax: processIds.map((_, i) => maxOf(rows.map((r) => r.values[i]))),
    totalMax: maxOf(rows.map((r) => r.total)),
  };
}

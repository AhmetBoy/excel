// VERIFIED from a real Atlas /graphql response (getReportingByWarehouseId):
// per-associate rows live under rawReports[processPath].processLevelReport,
// each with aggregationField "<warehouseId>-<login>" and a defectMap of
// { k, v } pairs where k === 'Opportunities' is the unit count (stows,
// receives, ...). The inbound department holds Stow and Receive; Pick is
// asked for with department "outbound".
const OPPORTUNITIES_KEY = 'Opportunities';

function loginFromAggregationField(aggregationField, warehouseId) {
  const value = String(aggregationField ?? '');
  const prefix = warehouseId ? `${warehouseId}-` : null;
  if (prefix && value.toUpperCase().startsWith(prefix.toUpperCase())) {
    return value.slice(prefix.length);
  }
  const dashIndex = value.indexOf('-');
  return dashIndex === -1 ? value : value.slice(dashIndex + 1);
}

function opportunitiesFromDefectMap(defectMap) {
  if (!Array.isArray(defectMap)) return 0;
  const entry = defectMap.find((item) => item?.k === OPPORTUNITIES_KEY);
  const value = Number(entry?.v);
  return Number.isFinite(value) ? value : 0;
}

/** Sums the items per login, sorted by opportunities descending. */
function rowsOfItems(items, warehouseId) {
  const byLogin = new Map();

  for (const item of items) {
    const login = loginFromAggregationField(item?.aggregationField, warehouseId);
    if (!login) continue;

    const existing = byLogin.get(login);
    const opportunities = opportunitiesFromDefectMap(item.defectMap);
    const totalDefects = Number(item.totalDefects) || 0;

    if (existing) {
      existing.opportunities += opportunities;
      existing.totalDefects += totalDefects;
    } else {
      byLogin.set(login, {
        login,
        managerId: item.managerId ?? null,
        opportunities,
        totalDefects,
      });
    }
  }

  return [...byLogin.values()].sort(
    (a, b) => b.opportunities - a.opportunities || a.login.localeCompare(b.login)
  );
}

/**
 * Per-associate opportunity counts for every process path in an Atlas
 * reporting response. Rows for the same login within a path are summed.
 *
 * @param {string|object} raw - response body text or parsed JSON
 * @param {{ warehouseId?: string }} [options]
 * @returns {{ byPath: Record<string, Array<{login: string, managerId: string|null, opportunities: number, totalDefects: number}>>,
 *   paths: string[], errorMessage: string|null, valid: boolean }}
 */
export function parseAtlasProcessReports(raw, { warehouseId } = {}) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { byPath: {}, paths: [], errorMessage: null, valid: false };
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const message = data.errors.map((e) => e?.message).filter(Boolean).join('; ');
    return { byPath: {}, paths: [], errorMessage: message || 'GraphQL error', valid: true };
  }

  const report = data?.data?.getReportingByWarehouseId;
  if (!report) return { byPath: {}, paths: [], errorMessage: null, valid: false };

  // A path listed twice is merged before summing.
  const itemsByPath = new Map();
  for (const rawReport of report.rawReports ?? []) {
    const path = rawReport?.processPath;
    if (!path) continue;
    if (!itemsByPath.has(path)) itemsByPath.set(path, []);
    itemsByPath.get(path).push(...(rawReport.processLevelReport ?? []));
  }

  const byPath = {};
  for (const [path, items] of itemsByPath) byPath[path] = rowsOfItems(items, warehouseId);
  return {
    byPath,
    paths: Object.keys(byPath),
    errorMessage: report.rawReportsErrorMessage ?? null,
    valid: true,
  };
}

/**
 * Per-associate opportunity counts of one process path (default Stow).
 *
 * @param {string|object} raw - response body text or parsed JSON
 * @param {{ processPath?: string, warehouseId?: string }} [options]
 * @returns {{ rows: Array<{login: string, managerId: string|null, opportunities: number, totalDefects: number}>, errorMessage: string|null, valid: boolean }}
 */
export function parseAtlasReport(raw, { processPath = 'Stow', warehouseId } = {}) {
  const parsed = parseAtlasProcessReports(raw, { warehouseId });
  return {
    rows: parsed.byPath[processPath] ?? [],
    errorMessage: parsed.errorMessage,
    valid: parsed.valid,
  };
}

/**
 * Converts the date/time inputs (interpreted in the browser's local time
 * zone, same as the Atlas UI) into the Unix-second range Atlas expects.
 * e.g. 2026-10-14 15:00 in Türkiye (UTC+3) -> 1791979200.
 *
 * @returns {{ startTime: number, endTime: number } | null} null if invalid or end <= start
 */
export function buildTimeRange(startDate, startTime, endDate, endTime) {
  const start = new Date(`${startDate}T${startTime}`).getTime();
  const end = new Date(`${endDate}T${endTime}`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { startTime: Math.floor(start / 1000), endTime: Math.floor(end / 1000) };
}

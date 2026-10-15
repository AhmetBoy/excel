// VERIFIED from a real Atlas /graphql response (getReportingByWarehouseId):
// per-associate rows live under rawReports[processPath].processLevelReport,
// each with aggregationField "<warehouseId>-<login>" and a defectMap of
// { k, v } pairs where k === 'Opportunities' is the number of stows.
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

/**
 * Extracts per-associate opportunity (stow) counts for one process path
 * from an Atlas reporting response. Rows for the same login are summed
 * rather than shown twice, and sorted by opportunities descending.
 *
 * @param {string|object} raw - response body text or parsed JSON
 * @param {{ processPath?: string, warehouseId?: string }} [options]
 * @returns {{ rows: Array<{login: string, managerId: string|null, opportunities: number, totalDefects: number}>, errorMessage: string|null, valid: boolean }}
 */
export function parseAtlasReport(raw, { processPath = 'Stow', warehouseId } = {}) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { rows: [], errorMessage: null, valid: false };
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const message = data.errors.map((e) => e?.message).filter(Boolean).join('; ');
    return { rows: [], errorMessage: message || 'GraphQL error', valid: true };
  }

  const report = data?.data?.getReportingByWarehouseId;
  if (!report) return { rows: [], errorMessage: null, valid: false };

  const rawReport = (report.rawReports ?? []).find((r) => r?.processPath === processPath);
  const byLogin = new Map();

  for (const item of rawReport?.processLevelReport ?? []) {
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

  const rows = [...byLogin.values()].sort(
    (a, b) => b.opportunities - a.opportunities || a.login.localeCompare(b.login)
  );

  return { rows, errorMessage: report.rawReportsErrorMessage ?? null, valid: true };
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

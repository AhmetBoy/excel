import { describe, expect, it } from 'vitest';
import { buildTimeRange, parseAtlasReport } from '../shared/parsers/atlasReportParser.js';

function rawRow(login, managerId, opportunities, totalDefects = 0) {
  return {
    aggregationField: `XSA9-${login}`,
    managerId,
    subProcess: '-',
    defectMap: [
      { k: 'Bin Collision', v: totalDefects },
      { k: 'Opportunities', v: opportunities },
    ],
    totalDefects,
  };
}

function response(rawReports, extra = {}) {
  return {
    data: {
      getReportingByWarehouseId: {
        totalsReports: [],
        managerLevelReports: [],
        rawReports,
        rawReportsErrorMessage: null,
        ...extra,
      },
    },
  };
}

describe('parseAtlasReport', () => {
  it('extracts login, manager and opportunities from Stow rows only', () => {
    const json = response([
      { processPath: 'Receive', processLevelReport: [rawRow('colfatma', 'akanahmy', 10792)] },
      {
        processPath: 'Stow',
        processLevelReport: [rawRow('sseahmet', 'elifcery', 42, 13), rawRow('colfatma', 'akanahmy', 1061, 295)],
      },
    ]);

    const result = parseAtlasReport(JSON.stringify(json), { warehouseId: 'XSA9' });

    expect(result.valid).toBe(true);
    expect(result.rows).toEqual([
      { login: 'colfatma', managerId: 'akanahmy', opportunities: 1061, totalDefects: 295 },
      { login: 'sseahmet', managerId: 'elifcery', opportunities: 42, totalDefects: 13 },
    ]);
  });

  it('sums duplicate rows for the same login instead of listing them twice', () => {
    const json = response([
      {
        processPath: 'Stow',
        processLevelReport: [rawRow('aslandot', 'akanahmy', 500, 1), rawRow('aslandot', 'akanahmy', 360, 2)],
      },
    ]);
    const { rows } = parseAtlasReport(json, { warehouseId: 'XSA9' });
    expect(rows).toEqual([{ login: 'aslandot', managerId: 'akanahmy', opportunities: 860, totalDefects: 3 }]);
  });

  it('treats a missing Opportunities entry as 0 rather than failing', () => {
    const json = response([
      { processPath: 'Stow', processLevelReport: [{ aggregationField: 'XSA9-x', defectMap: [] }] },
    ]);
    expect(parseAtlasReport(json).rows[0].opportunities).toBe(0);
  });

  it('returns no rows when there is no Stow section', () => {
    const json = response([{ processPath: 'Receive', processLevelReport: [rawRow('a', 'm', 5)] }]);
    expect(parseAtlasReport(json)).toMatchObject({ rows: [], valid: true });
  });

  it('surfaces GraphQL errors (e.g. PersistedQueryNotFound)', () => {
    const result = parseAtlasReport({ errors: [{ message: 'PersistedQueryNotFound' }] });
    expect(result.errorMessage).toBe('PersistedQueryNotFound');
  });

  it('flags non-JSON or unrelated bodies (e.g. an SSO login page) as invalid', () => {
    expect(parseAtlasReport('<html>login</html>').valid).toBe(false);
    expect(parseAtlasReport({ data: {} }).valid).toBe(false);
  });
});

describe('buildTimeRange', () => {
  it('converts local date/time inputs to Unix seconds', () => {
    const range = buildTimeRange('2026-10-14', '15:00', '2026-10-14', '23:00');
    expect(range).toEqual({
      startTime: new Date('2026-10-14T15:00').getTime() / 1000,
      endTime: new Date('2026-10-14T23:00').getTime() / 1000,
    });
    expect(range.endTime - range.startTime).toBe(8 * 3600);
  });

  it('supports shifts that cross midnight', () => {
    const range = buildTimeRange('2026-10-14', '23:00', '2026-10-15', '07:00');
    expect(range.endTime - range.startTime).toBe(8 * 3600);
  });

  it('rejects an end time that is not after the start', () => {
    expect(buildTimeRange('2026-10-14', '23:00', '2026-10-14', '15:00')).toBeNull();
    expect(buildTimeRange('', '', '', '')).toBeNull();
  });
});

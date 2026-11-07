import { describe, expect, it } from 'vitest';
import { parseAtlasProcessReports, parseAtlasReport } from '../shared/parsers/atlasReportParser.js';
import {
  buildCombinedTable,
  buildStowSheetRows,
  buildStowTable,
  departmentsFor,
  missingProcesses,
  processById,
  slotRowsForProcess,
} from '../shared/stowReportTable.js';
import { XLSX_STYLE } from '../shared/xlsxWriter.js';

const item = (login, opportunities, managerId = 'mgr') => ({
  aggregationField: `XSA9-${login}`,
  managerId,
  defectMap: [{ k: 'Opportunities', v: opportunities }],
  totalDefects: 0,
});
const response = (rawReports) => ({ data: { getReportingByWarehouseId: { rawReports, rawReportsErrorMessage: null } } });

describe('parseAtlasProcessReports', () => {
  it('reads every process path and merges a path listed twice', () => {
    const parsed = parseAtlasProcessReports(
      response([
        { processPath: 'Stow', processLevelReport: [item('a', 10)] },
        { processPath: 'Receive', processLevelReport: [item('a', 3), item('b', 7)] },
        { processPath: 'Stow', processLevelReport: [item('a', 5)] },
      ]),
      { warehouseId: 'XSA9' }
    );
    expect(parsed.paths).toEqual(['Stow', 'Receive']);
    expect(parsed.byPath.Stow).toEqual([{ login: 'a', managerId: 'mgr', opportunities: 15, totalDefects: 0 }]);
    expect(parsed.byPath.Receive.map((r) => r.login)).toEqual(['b', 'a']);
  });

  it('keeps parseAtlasReport working for one path', () => {
    const raw = response([{ processPath: 'Receive', processLevelReport: [item('a', 3)] }]);
    expect(parseAtlasReport(raw, { warehouseId: 'XSA9', processPath: 'Receive' }).rows).toHaveLength(1);
    expect(parseAtlasReport(raw, { warehouseId: 'XSA9' }).rows).toEqual([]);
  });
});

describe('process helpers', () => {
  it('asks inbound once for Stow + Receive and outbound for Pick', () => {
    expect(departmentsFor(['stow', 'receive'])).toEqual(['inbound']);
    expect(departmentsFor(['stow', 'pick'])).toEqual(['inbound', 'outbound']);
  });

  it('picks a process rows per slot, case-insensitively', () => {
    const slots = [{ byPath: { stow: [{ login: 'a' }], Receive: [{ login: 'b' }] } }, { byPath: {} }];
    expect(slotRowsForProcess(slots, processById('stow'))).toEqual([[{ login: 'a' }], []]);
  });

  it('names the processes Atlas returned no section for', () => {
    expect(missingProcesses(['stow', 'pick'], ['Stow', 'Receive']).map((p) => p.id)).toEqual(['pick']);
  });
});

describe('buildCombinedTable', () => {
  const opts = { users: ['a', 'b'], names: { a: 'Ali' } };
  const tables = {
    stow: buildStowTable([[{ login: 'a', managerId: 'm', opportunities: 10 }]], opts),
    receive: buildStowTable([[{ login: 'b', managerId: 'm', opportunities: 30 }, { login: 'a', managerId: 'm', opportunities: 5 }]], opts),
  };
  const combined = buildCombinedTable(tables, ['stow', 'receive']);

  it('puts each process total in its own column', () => {
    expect(combined.rows.map((r) => [r.login, r.name, r.values, r.total])).toEqual([
      ['b', null, [0, 30], 30],
      ['a', 'Ali', [10, 5], 15],
    ]);
    expect(combined.columnTotals).toEqual([10, 35]);
    expect(combined.grandTotal).toBe(45);
    expect(combined.columnMax).toEqual([10, 30]);
  });

  it('exports with process names as columns', () => {
    const rows = buildStowSheetRows(
      { table: combined, rows: combined.rows, columns: ['Stow', 'Receive'], title: 'T' },
      XLSX_STYLE
    );
    expect(rows[2].map((c) => c.v)).toEqual(['#', 'Kullanıcı', 'İsim', 'Stow', 'Receive', 'Toplam']);
    expect(rows.at(-1).map((c) => c.v)).toEqual([null, 'Toplam (2 kişi)', null, 10, 35, 45]);
  });

  it('labels a single-value process sheet with the process name', () => {
    const rows = buildStowSheetRows(
      { table: tables.receive, rows: tables.receive.rows, valueLabel: 'Receive (Opportunities)', title: 'T' },
      XLSX_STYLE
    );
    expect(rows[2].map((c) => c.v)).toEqual(['#', 'Kullanıcı', 'İsim', 'Manager', 'Receive (Opportunities)']);
  });
});

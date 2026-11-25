import { describe, expect, it } from 'vitest';
import { cellHighlightClass, evaluateTote, dropZoneColumnClass, isMoveNeeded } from '../shared/toteChecks.js';

const readyRow = (overrides = {}) => ({
  asin: 'B0A',
  fnSku: 'FNA',
  fcSku: 'FCA',
  lpn: 'LPN1',
  quantity: '2',
  consumer: 'UNOWNED',
  disposition: 'SELLABLE',
  dropZone: 'NO_RESTRICTION',
  qtMatchStatus: 'no_qt_data',
  ...overrides,
});

const levels = (verdict) => verdict.findings.map((f) => f.level);
const messages = (verdict) => verdict.findings.map((f) => f.message).join(' | ');

describe('evaluateTote', () => {
  it('returns null for an empty tote', () => {
    expect(evaluateTote([])).toBeNull();
  });

  it('marks a clean tote ready and reports quantity and variety', () => {
    const verdict = evaluateTote([
      readyRow(),
      readyRow({ asin: 'B0B', fnSku: 'FNB', fcSku: 'FCB', lpn: 'LPN2', quantity: '3' }),
    ]);
    expect(verdict.ready).toBe(true);
    expect(verdict.findings).toEqual([]);
    expect(verdict.totalQuantity).toBe(5);
    expect(verdict.variety).toBe(2);
  });

  it('requires a Move when DropZones differ', () => {
    const verdict = evaluateTote([readyRow(), readyRow({ fnSku: 'FNB', fcSku: 'FCB', dropZone: 'HAZMAT' })]);
    expect(verdict.ready).toBe(false);
    expect(messages(verdict)).toContain('Move yapılacak');
  });

  it('requires EDIT for PENDING_RESEARCH consumer', () => {
    const verdict = evaluateTote([readyRow({ consumer: 'PENDING_RESEARCH' })]);
    expect(levels(verdict)).toEqual(['action']);
    expect(messages(verdict)).toContain('EDIT yapılacak');
  });

  it('requires Damage Stow / İmha for a non-SELLABLE disposition', () => {
    const verdict = evaluateTote([readyRow({ disposition: 'DAMAGED' })]);
    expect(verdict.findings).toEqual([{ level: 'action', message: 'Damage Stow veya İMHA yapılacak' }]);
  });

  it('asks for an SKT entry on EXPIRED disposition, not Damage/İmha', () => {
    const verdict = evaluateTote([readyRow({ disposition: 'EXPIRED' })]);
    expect(verdict.ready).toBe(false);
    expect(messages(verdict)).toContain("EDIT — Ürün SKT'si girilmesi gerekiyor — Disposition: EXPIRED");
    expect(messages(verdict)).not.toContain('Damage Stow');
  });

  it('reports CUSTOMER_SHIPMENT as an info message (products in picking)', () => {
    const verdict = evaluateTote([readyRow({ consumer: 'CUSTOMER_SHIPMENT' })]);
    expect(verdict.findings).toEqual([
      { level: 'info', message: 'Ürünler toplamada — Consumer: CUSTOMER_SHIPMENT' },
    ]);
    expect(verdict.ready).toBe(false);
    expect(cellHighlightClass(readyRow({ consumer: 'CUSTOMER_SHIPMENT' }), 'consumer', { moveNeeded: false })).toBe(
      'cell-info'
    );
  });

  it('reports PROBLEM_SOLVE as an info message', () => {
    const verdict = evaluateTote([readyRow({ consumer: 'PROBLEM_SOLVE' })]);
    expect(verdict.findings).toEqual([
      { level: 'info', message: "Problem Solve'dan düşmesi bekleniyor" },
    ]);
    expect(verdict.ready).toBe(false);
    expect(cellHighlightClass(readyRow({ consumer: 'PROBLEM_SOLVE' }), 'consumer', { moveNeeded: false })).toBe(
      'cell-info'
    );
  });

  it('warns on an unexpected consumer value', () => {
    const verdict = evaluateTote([readyRow({ consumer: 'SELLABLE' })]);
    expect(levels(verdict)).toEqual(['warn']);
  });

  it('requires a tote scan for repeated FNSku without LPN and same consumer/disposition', () => {
    const verdict = evaluateTote([
      readyRow({ lpn: null }),
      readyRow({ lpn: null, quantity: '1' }),
    ]);
    expect(messages(verdict)).toContain('Tote Taraması gerekiyor');
    expect(messages(verdict)).toContain('Tote Taraması gerekiyor');
    expect(verdict.findings).toContainEqual({ level: 'action', code: 'tote_scan', message: 'Tote Taraması gerekiyor' });
  });

  it('does not ask for a tote scan when only the FCSku repeats', () => {
    const verdict = evaluateTote([
      readyRow({ lpn: null }),
      readyRow({ lpn: null, fnSku: 'FNB' }),
    ]);
    expect(messages(verdict)).not.toContain('Tote Taraması');
  });

  it('does not ask for a tote scan when the repeated FNSku lines carry LPNs', () => {
    const verdict = evaluateTote([readyRow({ lpn: 'L1' }), readyRow({ lpn: 'L2' })]);
    expect(verdict.ready).toBe(true);
  });

  it('treats a blank/None DropZone as NOT_PERMITTED: Move + ISS when only some are', () => {
    const verdict = evaluateTote([
      readyRow(),
      readyRow({ fnSku: 'FNB', fcSku: 'FCB', dropZone: null }),
      readyRow({ fnSku: 'FNC', fcSku: 'FCC', dropZone: 'None' }),
    ]);
    expect(verdict.ready).toBe(false);
    expect(messages(verdict)).toContain("Move yapılacak ve ISS'e gidecek — 2 ürün NOT_PERMITTED");
    // NOT_PERMITTED is not counted as a second "different DropZone"
    expect(messages(verdict)).not.toContain("DropZone'lar farklı");
    expect(levels(verdict)).toEqual(['move']);
  });

  it('sends the whole tote to ISS when every product is NOT_PERMITTED', () => {
    const verdict = evaluateTote([readyRow({ dropZone: '' }), readyRow({ fnSku: 'FNB', dropZone: 'NOT_PERMITTED' })]);
    expect(messages(verdict)).toContain("Tote ISS'e gidecek");
  });

  it('only warns about missing DropZones when Pandash itself failed', () => {
    const verdict = evaluateTote([readyRow({ dropZone: null })], { pandashOk: false });
    expect(levels(verdict)).toEqual(['warn']);
    expect(messages(verdict)).not.toContain('NOT_PERMITTED');
  });

  it('ignores QT-only rows that are not in the tote inventory', () => {
    const verdict = evaluateTote([
      readyRow(),
      { fcSku: 'FCX', consumer: null, disposition: null, dropZone: null, qtMatchStatus: 'qt_only_unmatched' },
    ]);
    expect(verdict.ready).toBe(true);
  });
});

describe('cellHighlightClass', () => {
  it('flags the cells that triggered an action', () => {
    const ctx = { moveNeeded: true };
    expect(cellHighlightClass(readyRow({ consumer: 'PENDING_RESEARCH' }), 'consumer', ctx)).toBe('cell-action');
    expect(cellHighlightClass(readyRow({ disposition: 'DAMAGED' }), 'disposition', ctx)).toBe('cell-action');
    expect(cellHighlightClass(readyRow(), 'dropZone', ctx)).toBe('cell-move');
    expect(cellHighlightClass(readyRow(), 'dropZone', { moveNeeded: false })).toBeNull();
    expect(cellHighlightClass(readyRow(), 'consumer', ctx)).toBeNull();
    expect(cellHighlightClass(readyRow({ dropZone: null }), 'dropZone', { moveNeeded: false })).toBe('cell-move');
    expect(
      cellHighlightClass(readyRow({ dropZone: null, dropZoneHidden: true }), 'dropZone', { moveNeeded: false })
    ).toBeNull();
  });
});

describe('DropZone colors', () => {
  it('colors the whole column green when every product is NO_RESTRICTION', () => {
    const rows = [readyRow(), readyRow({ asin: 'B0B', fnSku: 'FNB' })];
    const columnClass = dropZoneColumnClass(rows);
    expect(columnClass).toBe('cell-ok');
    const ctx = { moveNeeded: isMoveNeeded(rows), columnClass };
    expect(cellHighlightClass(rows[0], 'dropZone', ctx)).toBe('cell-ok');
    expect(cellHighlightClass({ ...rows[1], dropZone: null, dropZoneHidden: true }, 'dropZone', ctx)).toBe('cell-ok');
  });

  it('colors the whole column yellow when every product is MISCH_HEALTH or every one CORROSIVE', () => {
    expect(dropZoneColumnClass([readyRow({ dropZone: 'MISCH_HEALTH' }), readyRow({ dropZone: 'misch_health' })])).toBe(
      'cell-caution'
    );
    expect(dropZoneColumnClass([readyRow({ dropZone: 'CORROSIVE' })])).toBe('cell-caution');
  });

  it('colors the whole column pink when every product is a flammable / aerosol DropZone', () => {
    expect(dropZoneColumnClass([readyRow({ dropZone: 'FLAMMABLES' }), readyRow({ dropZone: 'FLAMMABLES' })])).toBe(
      'cell-hazmat'
    );
    // a mix of hazmat DropZones is still all pink
    expect(dropZoneColumnClass([readyRow({ dropZone: 'AEROSOLS' }), readyRow({ dropZone: 'FLAM_AEROSOLS' })])).toBe(
      'cell-hazmat'
    );
  });

  it('leaves mixed or empty DropZones to the per-cell rules', () => {
    expect(dropZoneColumnClass([readyRow(), readyRow({ dropZone: 'FLAMMABLES' })])).toBeNull();
    expect(dropZoneColumnClass([readyRow({ dropZone: 'MISCH_HEALTH' }), readyRow({ dropZone: 'CORROSIVE' })])).toBeNull();
    expect(dropZoneColumnClass([readyRow(), readyRow({ dropZone: null })])).toBeNull();
    expect(dropZoneColumnClass([])).toBeNull();
  });

  it('colors flammable / aerosol DropZones pink, even when a Move is needed', () => {
    for (const dropZone of ['FLAM_AEROSOLS', 'AEROSOLS', 'flammables']) {
      expect(cellHighlightClass(readyRow({ dropZone }), 'dropZone', { moveNeeded: true })).toBe('cell-hazmat');
    }
    // the other DropZone of a mixed tote stays orange
    expect(cellHighlightClass(readyRow(), 'dropZone', { moveNeeded: true })).toBe('cell-move');
  });
});

describe('isMoveNeeded', () => {
  it('is true only when more than one DropZone is present', () => {
    expect(isMoveNeeded([readyRow(), readyRow()])).toBe(false);
    expect(isMoveNeeded([readyRow(), readyRow({ dropZone: 'HAZMAT' })])).toBe(true);
  });
});

describe('evaluateTote SKT rules', () => {
  const NOW = new Date(2026, 10, 19);
  const dated = (expirationDate, overrides = {}) => readyRow({ qtMatchStatus: 'matched', expirationDate, ...overrides });
  const codes = (verdict) => verdict.findings.map((f) => f.code).filter(Boolean);

  it('keeps a tote ready when every SKT is far enough away', () => {
    const verdict = evaluateTote([dated('Apr 10 2029')], { qtStatus: 'ok', now: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('asks for an SKT when QT shows none', () => {
    const verdict = evaluateTote([dated('None')], { qtStatus: 'ok', now: NOW });
    expect(verdict.ready).toBe(false);
    expect(codes(verdict)).toEqual(['skt_missing']);
    expect(messages(verdict)).toContain('SKT girilmeli');
  });

  it('flags expired and near SKTs together', () => {
    const verdict = evaluateTote(
      [dated('Nov 1 2026'), dated('Jan 5 2027', { fnSku: 'FNB', fcSku: 'FCB' })],
      { qtStatus: 'ok', now: NOW }
    );
    expect(codes(verdict)).toEqual(['skt_expired']);
    expect(messages(verdict)).toContain('SKT geçmiş / çok yaklaşmış — 1 geçmiş, 1 çok yaklaşmış');
  });

  it('ignores rows without a QT record (not date-tracked)', () => {
    const verdict = evaluateTote([readyRow({ qtMatchStatus: 'no_qt_data' })], { qtStatus: 'ok', now: NOW });
    expect(verdict.ready).toBe(true);
  });

  it('is not ready when QT failed, and silent when QT was not asked', () => {
    expect(evaluateTote([readyRow()], { qtStatus: 'no_qt_tab' }).ready).toBe(false);
    expect(messages(evaluateTote([readyRow()], { qtStatus: 'error' }))).toContain('SKT kontrol edilemedi');
    expect(evaluateTote([readyRow()], { qtStatus: 'no_datelot_screen' }).ready).toBe(true);
    expect(evaluateTote([readyRow()], { qtStatus: 'no_datelot_items' }).ready).toBe(true);
    expect(evaluateTote([readyRow()]).ready).toBe(true);
  });

  it('shows only the SKT message when the SKT explains EXPIRED / PENDING_RESEARCH', () => {
    const expired = evaluateTote(
      [dated('Jan 5 2027', { disposition: 'EXPIRED', consumer: 'PENDING_RESEARCH' })],
      { qtStatus: 'ok', now: NOW }
    );
    expect(messages(expired)).toBe('SKT geçmiş / çok yaklaşmış — 1 çok yaklaşmış');

    const missing = evaluateTote([dated('None', { consumer: 'PENDING_RESEARCH' })], { qtStatus: 'ok', now: NOW });
    expect(messages(missing)).toBe('SKT girilmeli — 1 üründe SKT yok');
  });

  it('keeps the EXPIRED / PENDING_RESEARCH messages when the SKT is unknown', () => {
    const row = readyRow({ disposition: 'EXPIRED', consumer: 'PENDING_RESEARCH' });
    const failed = messages(evaluateTote([row], { qtStatus: 'error' }));
    expect(failed).toContain('Disposition: EXPIRED');
    expect(failed).toContain('Consumer: PENDING_RESEARCH');

    // QT answered but this product has no datelot record.
    const noRecord = messages(evaluateTote([row], { qtStatus: 'ok', now: NOW }));
    expect(noRecord).toContain('Disposition: EXPIRED');
    expect(noRecord).toContain('Consumer: PENDING_RESEARCH');
  });

  it('keeps the messages of other products that the SKT does not explain', () => {
    const verdict = evaluateTote(
      [
        dated('None', { consumer: 'PENDING_RESEARCH' }),
        readyRow({ fnSku: 'FNB', fcSku: 'FCB', consumer: 'PENDING_RESEARCH' }),
      ],
      { qtStatus: 'ok', now: NOW }
    );
    expect(messages(verdict)).toContain('SKT girilmeli');
    expect(messages(verdict)).toContain('Consumer: PENDING_RESEARCH');
  });

  it('highlights the Expiration Date cell', () => {
    const ctx = { moveNeeded: false, now: NOW };
    expect(cellHighlightClass(dated('Nov 1 2026'), 'expirationDate', ctx)).toBe('cell-action');
    expect(cellHighlightClass(dated('None'), 'expirationDate', ctx)).toBe('cell-action');
    expect(cellHighlightClass(dated('Apr 10 2029'), 'expirationDate', ctx)).toBeNull();
    expect(cellHighlightClass(readyRow(), 'expirationDate', ctx)).toBeNull();
  });
});

describe('evaluateTote SKT from FC Research (QT off)', () => {
  const NOW = new Date(2026, 10, 19);
  const fc = (expirationDate, overrides = {}) =>
    readyRow({ expirationDate, expirationSource: 'fcresearch', ...overrides });
  const codes = (verdict) => verdict.findings.map((f) => f.code).filter(Boolean);

  it('flags an expired / near FC Research date with QT not asked', () => {
    const verdict = evaluateTote([fc('2026-11-01 00:00:00'), fc('2027-01-05', { fnSku: 'FNB', fcSku: 'FCB' })], { now: NOW });
    expect(codes(verdict)).toEqual(['skt_expired']);
    expect(messages(verdict)).toContain('1 geçmiş, 1 çok yaklaşmış');
  });

  it('keeps the tote ready for a far FC Research date', () => {
    expect(evaluateTote([fc('2029-04-10')], { now: NOW }).ready).toBe(true);
  });

  it('never asks for an SKT from an FC Research row (empty may mean not dated)', () => {
    const verdict = evaluateTote([fc('None')], { now: NOW });
    expect(codes(verdict)).toEqual([]);
  });

  it('highlights the expired FC Research date cell', () => {
    expect(cellHighlightClass(fc('2026-01-01'), 'expirationDate', { moveNeeded: false, now: NOW })).toBe('cell-action');
  });
});

describe('WORK_ORDER consumer', () => {
  it('asks to take the product to the CUBISCAN instead of "Beklenmeyen Consumer"', () => {
    const verdict = evaluateTote([readyRow({ consumer: 'WORK_ORDER' })]);
    expect(verdict.ready).toBe(false);
    expect(verdict.findings).toEqual([{ level: 'cubiscan', message: 'Lütfen ürünü ölçüm cihazına (CUBISCAN) götürün.' }]);
    expect(cellHighlightClass(readyRow({ consumer: 'WORK_ORDER' }), 'consumer', { moveNeeded: false })).toBe('cell-cubiscan');
  });
});

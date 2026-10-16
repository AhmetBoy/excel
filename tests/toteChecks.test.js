import { describe, expect, it } from 'vitest';
import { cellHighlightClass, evaluateTote, isMoveNeeded } from '../shared/toteChecks.js';

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
    expect(verdict.findings).toContainEqual({ level: 'action', message: 'Tote Taraması gerekiyor' });
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

describe('isMoveNeeded', () => {
  it('is true only when more than one DropZone is present', () => {
    expect(isMoveNeeded([readyRow(), readyRow()])).toBe(false);
    expect(isMoveNeeded([readyRow(), readyRow({ dropZone: 'HAZMAT' })])).toBe(true);
  });
});

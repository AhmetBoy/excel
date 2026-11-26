import { describe, expect, it } from 'vitest';
import { lpnGuidance } from '../shared/lpnGuidance.js';

describe('lpnGuidance', () => {
  it('sends a unit in a bin to that bin', () => {
    const g = lpnGuidance({ rows: [{ container: 'P-1-A200A100' }] });
    expect(g.level).toBe('move');
    expect(g.message).toContain('P-1-A200A100 adresine götürün');
  });

  it('stows a unit in a tote or csX from there', () => {
    expect(lpnGuidance({ rows: [{ container: 'tsXSA903245' }] }).message).toContain('tsXSA903245 üzerinden stowlayın');
    expect(lpnGuidance({ rows: [{ container: 'csXhbyjrsav' }] }).message).toContain('csXhbyjrsav üzerinden stowlayın');
  });

  it('uses Sideline for vtts...XSA90 and LPN Move for other virtual containers', () => {
    expect(lpnGuidance({ rows: [{ container: 'vttsXSA903245' }] }).message).toContain('Sideline');
    expect(lpnGuidance({ rows: [{ container: 'vttsCRETSELL' }] }).message).toContain('LPN Move');
  });

  it('warns when Inventory shows the unit in more than one place', () => {
    const g = lpnGuidance({ rows: [{ container: 'P-1-A1' }, { container: 'tsXSA901111' }] });
    expect(g.level).toBe('warn');
  });

  it('sends a missed or deleted unit to ICQA, newest loss first', () => {
    const history = [
      { date: '2026-10-01 10:00:00', op: 'M', rs: '', oldBin: 'tsXSA901111', newBin: 'P-1-A1' },
      { date: '2026-10-05 09:00:00', op: 'A', rs: 'M', oldBin: 'P-1-A1', person: 'icqa1' },
    ];
    const g = lpnGuidance({ rows: [], history, historyStatus: 'ok' });
    expect(g.level).toBe('action');
    expect(g.message).toContain('miss edilmiş');
    expect(g.message).toContain('ICQA');
    expect(g.detail).toContain('2026-10-05');
    expect(lpnGuidance({ history: [{ date: '2026-10-05', op: 'D', rs: '' }] }).message).toContain('delete edilmiş');
  });

  it('does not read a plain move (OP M) as a miss', () => {
    const g = lpnGuidance({ history: [{ date: '2026-10-01', op: 'M', rs: '', oldBin: 'a', newBin: 'b' }] });
    expect(g.level).toBe('warn');
    expect(g.detail).toContain('a → b');
  });

  it('says when there is nothing anywhere, or History failed', () => {
    expect(lpnGuidance({ historyStatus: 'not_found' }).message).toContain('bulunamadı');
    expect(lpnGuidance({ historyStatus: 'auth_required' }).message).toContain('okunamadı');
  });
});

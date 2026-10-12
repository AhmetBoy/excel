import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQtDatelotHtml } from '../shared/parsers/qtDatelotParser.js';

function loadFixture(name) {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf-8');
}

describe('parseQtDatelotHtml', () => {
  it('parses multiple products from the datelot fieldset', () => {
    const html = loadFixture('qt-datelot-multi-item.html');
    const result = parseQtDatelotHtml(html);

    expect(result.found).toBe(true);
    expect(result.products).toHaveLength(2);
    expect(result.products[0]).toEqual({
      title: 'Example Product One',
      fcSku: 'FC0001EXAMPLE',
      quantity: '3',
      owner: 'AMAZON_RETAIL',
      expirationDate: '15-JAN-2027',
    });
  });

  it('leaves missing/blank fields as null instead of fabricating a value', () => {
    const html = loadFixture('qt-datelot-multi-item.html');
    const result = parseQtDatelotHtml(html);

    expect(result.products[1].owner).toBeNull();
    expect(result.products[1].expirationDate).toBeNull();
    expect(result.products[1].title).toBe('Example Product Two');
  });

  it('reports found=false when the datelot fieldset is absent (screen not shown)', () => {
    const html = '<html><body><div>No datelot screen here</div></body></html>';
    const result = parseQtDatelotHtml(html);

    expect(result.found).toBe(false);
    expect(result.products).toEqual([]);
  });

  it('normalizes dt labels regardless of case/whitespace/colon differences', () => {
    const html = `
      <fieldset class="a-box-group a-form-control-group">
        <div class="a-box">
          <dl class="a-definition-list">
            <dt class="a-list-item">  OWNER  </dt>
            <dd class="a-list-item">SELLER_X</dd>
            <dt class="a-list-item">EXPIRATION DATE:</dt>
            <dd class="a-list-item">01-FEB-2026</dd>
          </dl>
        </div>
      </fieldset>
    `;
    const result = parseQtDatelotHtml(html);

    expect(result.products[0].owner).toBe('SELLER_X');
    expect(result.products[0].expirationDate).toBe('01-FEB-2026');
  });

  it('preserves the original expiration date string without reformatting it', () => {
    const html = `
      <fieldset class="a-box-group a-form-control-group">
        <div class="a-box">
          <dl class="a-definition-list">
            <dt class="a-list-item">Expiration date:</dt>
            <dd class="a-list-item">2026/02/01</dd>
          </dl>
        </div>
      </fieldset>
    `;
    const result = parseQtDatelotHtml(html);
    expect(result.products[0].expirationDate).toBe('2026/02/01');
  });
});

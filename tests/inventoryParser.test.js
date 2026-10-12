import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInventoryHtml } from '../shared/parsers/inventoryParser.js';

function loadFixture(name) {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf-8');
}

describe('parseInventoryHtml', () => {
  it('parses multiple items with header-based column matching', () => {
    const html = loadFixture('inventory-multi-item.html');
    const result = parseInventoryHtml(html);

    expect(result.found).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      container: 'TOT0001',
      asin: 'B0EXAMPLE1',
      fnSku: 'X001EXAMPLE',
      lpn: 'LPN0001',
      quantity: '2',
      disposition: 'SELLABLE',
      consumer: 'AMAZON_RETAIL',
      title: 'Example Product One',
    });
    expect(result.records[1].asin).toBe('B0EXAMPLE2');
  });

  it('reports found=false when #table-inventory is absent (e.g. invalid tote)', () => {
    const html = loadFixture('inventory-no-results.html');
    const result = parseInventoryHtml(html);

    expect(result.found).toBe(false);
    expect(result.records).toEqual([]);
  });

  it('is tolerant to header case, spacing, and a trailing colon-like artifact', () => {
    const html = `
      <table id="table-inventory">
        <tr><th> container </th><th>ASIN</th><th>FNSKU</th></tr>
        <tr><td>TOT9999</td><td>B0XYZ</td><td>FNX1</td></tr>
      </table>
    `;
    const result = parseInventoryHtml(html);

    expect(result.found).toBe(true);
    expect(result.records[0]).toMatchObject({
      container: 'TOT9999',
      asin: 'B0XYZ',
      fnSku: 'FNX1',
    });
  });

  it('does not fabricate values for fields missing from the header row', () => {
    const html = `
      <table id="table-inventory">
        <tr><th>ASIN</th><th>Title</th></tr>
        <tr><td>B0ONLY</td><td>Only Title</td></tr>
      </table>
    `;
    const result = parseInventoryHtml(html);

    expect(result.records[0].asin).toBe('B0ONLY');
    expect(result.records[0].title).toBe('Only Title');
    expect(result.records[0].container).toBeNull();
    expect(result.records[0].lpn).toBeNull();
  });

  it('surfaces headers it could not map, instead of silently dropping them', () => {
    const html = `
      <table id="table-inventory">
        <tr><th>ASIN</th><th>Some New Column</th></tr>
        <tr><td>B0ONLY</td><td>value</td></tr>
      </table>
    `;
    const result = parseInventoryHtml(html);

    expect(result.unmappedHeaders).toContain('Some New Column');
  });
});

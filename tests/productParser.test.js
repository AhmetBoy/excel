// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProductHtml } from '../shared/parsers/productParser.js';

describe('parseProductHtml', () => {
  it('reads High Value and image from label/value rows', () => {
    const html = `<div><img src="//m.media-amazon.com/images/I/abc.jpg">
      <table><tr><th>Title</th><td>Kulaklık</td></tr>
      <tr><th>High Value</th><td> true </td></tr></table></div>`;
    expect(parseProductHtml(html)).toEqual({
      found: true,
      highValue: true,
      imageUrl: 'https://m.media-amazon.com/images/I/abc.jpg',
      title: 'Kulaklık',
      expirationDate: null,
    });
  });

  it('reads a header-row table', () => {
    const html = `<table><thead><tr><th>ASIN</th><th>Is High Value</th></tr></thead>
      <tbody><tr><td>B0CV7PGS46</td><td>false</td></tr></tbody></table>`;
    expect(parseProductHtml(html)).toMatchObject({ found: true, highValue: false });
  });

  it('returns highValue null when the field is missing', () => {
    expect(parseProductHtml('<table><tr><td>ASIN</td><td>B0</td></tr></table>').highValue).toBeNull();
    expect(parseProductHtml('<div>No results</div>').found).toBe(false);
  });
});

describe('parseProductHtml on a live FC Research product section', () => {
  const html = readFileSync(join(__dirname, 'fixtures', 'fcresearch-product.html'), 'utf-8');

  it('reads image, title and Very High Value=false', () => {
    const parsed = parseProductHtml(html);
    expect(parsed).toMatchObject({
      found: true,
      highValue: false,
      imageUrl: 'https://m.media-amazon.com/images/I/41S-Dc88gwL._SCLZZZZZZZ__.jpg',
    });
    expect(parsed.title).toMatch(/^Razer Blackshark/);
  });

  it('reads an empty Expiration Date as null', () => {
    expect(parseProductHtml(html).expirationDate).toBeNull();
  });

  it('reads a filled Expiration Date (FCSku search)', () => {
    const dated = html.replace('<td class="timestamp"></td>', '<td class="timestamp">2027-03-15 00:00:00</td>');
    expect(parseProductHtml(dated).expirationDate).toBe('2027-03-15 00:00:00');
  });

  it('reads Very High Value=true', () => {
    const hrv = html.replace(/(<th>Very High Value<\/th>\s*<td>)false/, '$1true');
    expect(parseProductHtml(hrv).highValue).toBe(true);
  });
});

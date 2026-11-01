import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasMorePages,
  parseContainerHierarchyHtml,
} from '../shared/parsers/containerHierarchyParser.js';

const fixture = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'container-hierarchy-user.html'),
  'utf-8'
);

describe('parseContainerHierarchyHtml', () => {
  it('reads the Child Containers of a personal container (live FC Research HTML)', () => {
    const result = parseContainerHierarchyHtml(fixture);

    expect(result.found).toBe(true);
    expect(result.children).toEqual([{ scannableId: 'tsX1c34iy93', type: 'TOTE' }]);
    expect(result.paginationToken).toBeNull();
  });

  it('reads the hierarchy path with container types', () => {
    const { path } = parseContainerHierarchyHtml(fixture);

    expect(path).toEqual([
      { id: 'dzg-General', type: 'CONTAINER_GROUP' },
      { id: 'dz-P-MixStow', type: 'DROP_ZONE_PRIME' },
      { id: 'pc99stowera', type: 'PERSONAL_CONTAINER' },
    ]);
  });

  it('returns no children for an empty Child Containers table', () => {
    const html = `
      <table id="table-container-hierarchy">
        <thead><tr><th>Scannable ID</th><th>Type</th></tr></thead>
        <tbody><tr><td colspan="2">No child containers.</td></tr></tbody>
      </table>`;
    const result = parseContainerHierarchyHtml(html);

    expect(result.found).toBe(true);
    expect(result.children).toEqual([]);
  });

  it('reports found=false when the section is missing (e.g. login page)', () => {
    expect(parseContainerHierarchyHtml('<html><body>Sign in</body></html>').found).toBe(false);
  });

  it('parses bare rows and the token of a "-more" page', () => {
    const html = `
      <tr><td><a href="/XSA9/results?s=csX123">csX123</a></td><td>CASE</td></tr>
      <tr><td><a href="/XSA9/results?s=tsX9">tsX9</a></td><td>TOTE</td></tr>
      <div class="pagination-token">abc123</div>`;
    const result = parseContainerHierarchyHtml(html);

    expect(result.children).toEqual([
      { scannableId: 'csX123', type: 'CASE' },
      { scannableId: 'tsX9', type: 'TOTE' },
    ]);
    expect(result.paginationToken).toBe('abc123');
  });
});

describe('hasMorePages', () => {
  it('follows FC Research: empty or "true…" token means done', () => {
    expect(hasMorePages(null)).toBe(false);
    expect(hasMorePages('')).toBe(false);
    expect(hasMorePages('true')).toBe(false);
    expect(hasMorePages('abc123')).toBe(true);
  });
});

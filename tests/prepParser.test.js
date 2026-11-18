// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePrepHtml } from '../shared/parsers/prepParser.js';

const page = (current, history = '') => `<html><body>
  <div class="panel instruction-box"><div class="panel-body" id="instructions">${current}</div></div>
  <div class="panel history-box"><div id="history"><table><tr><td>${history}</td></tr></table></div></div>
</body></html>`;

describe('parsePrepHtml', () => {
  it('reads the current instruction from a saved live page', () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'prep-view.html'), 'utf-8');
    expect(parsePrepHtml(html)).toEqual({ found: true, instructions: ['Torbalama'] });
  });

  it('returns every current instruction', () => {
    const html = page('<ul><li>Torbalama</li><li> Etiketleme </li></ul>');
    expect(parsePrepHtml(html).instructions).toEqual(['Torbalama', 'Etiketleme']);
  });

  it('treats "No instructions set" as no prep, as text or as a list item', () => {
    const none = { found: true, instructions: [] };
    expect(parsePrepHtml(page('<p>No instructions set</p>'))).toEqual(none);
    expect(parsePrepHtml(page('<ul><li>No instructions set</li></ul>'))).toEqual(none);
  });

  it('never reads an old instruction from the history box', () => {
    const html = page('<p>No instructions set</p>', '<ul><li>Torbalama</li></ul>');
    expect(parsePrepHtml(html)).toEqual({ found: true, instructions: [] });
  });

  it('ignores "No instructions set" in the history when a prep is current', () => {
    const html = page('<ul><li>Torbalama</li></ul>', 'No instructions set');
    expect(parsePrepHtml(html).instructions).toEqual(['Torbalama']);
  });

  it('reports an unreadable page (e.g. a login screen) as not found', () => {
    expect(parsePrepHtml('<html><body>Sign in</body></html>')).toEqual({ found: false, instructions: [] });
    expect(parsePrepHtml(page('<p>Last updated</p>')).found).toBe(false);
  });
});

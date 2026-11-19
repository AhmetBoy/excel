import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQtPage } from '../shared/parsers/qtDatelotParser.js';

const SELECT_ITEM = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'qt-select-item-real.html'), 'utf-8');
const OBJECT_ID = 'XSA9-6cdfbe99-a43f-4c57-8b3f-679d398ef209';

// Minimal pages for the steps not captured yet.
const page = (body) => `<html><body>
<script type="a-state" data-a-state="{&quot;key&quot;:&quot;id&quot;}">{"instructionId":"EditItems","objectId":"${OBJECT_ID}","status":"READY"}</script>
<div id="workflow"><div class="aft-tool-action-box"><h1>${body.title}</h1></div>${body.html ?? ''}</div></body></html>`;
const TOTE_SCAN = page({ title: 'Scan container', html: '<form><input type="text" name="input"/></form>' });
const DATELOT_BUTTON = page({
  title: 'Container contents',
  html: '<span data-action="click-action" data-click-action="{&quot;action&quot;:&quot;ViewDatelotItems&quot;}"><input type="submit"/></span>',
});
const NO_DATELOT = page({ title: 'Container contents' });

/**
 * Fake QT: GET returns the page of the current step /action
 * moves to the next step; /status answers PROCESSING once, then READY.
 */
function fakeQt({ afterInput, start = TOTE_SCAN }) {
  let current = start;
  const actions = [];
  let processing = false;
  const reply = (text, status = 200) => ({ ok: status < 400, status, url: 'https://qt.eu.aftx.amazonoperations.app/x', text: async () => text });

  const fetchMock = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!init.body) return reply(current);
    const body = JSON.parse(init.body);
    expect(body.id).toEqual({ instructionId: 'EditItems', objectId: OBJECT_ID });
    if (path === '/status') {
      if (processing) {
        processing = false;
        return reply('{"status":"PROCESSING"}');
      }
      return reply('{"status":"READY"}');
    }
    if (path === '/action') {
      actions.push([body.action, body.input]);
      processing = true;
      if (body.action === 'Done') current = TOTE_SCAN;
      else if (body.action === 'Input') current = afterInput;
      else if (body.action === 'ViewDatelotItems') current = SELECT_ITEM;
      return reply('');
    }
    return reply('not found', 404);
  });
  return { fetchMock, actions };
}

describe('fetchQtDatelotForTote', () => {
  let fetchQtDatelotForTote;
  beforeEach(async () => {
    vi.resetModules();
    ({ fetchQtDatelotForTote } = await import('../background/services/qtService.js'));
  });
  afterEach(() => vi.unstubAllGlobals());

  const deps = { parsePage: async (html) => parseQtPage(html) };

  it('scans the tote, opens View Datelot Items and reads the dates', async () => {
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('ok');
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ fcSku: 'ZZV1OUR8NU', expirationDate: 'Apr 10 2029' });
    expect(actions).toEqual([
      ['Input', 'tsXSA900154'],
      ['ViewDatelotItems', 'ViewDatelotItems'],
    ]);
  });

  it('goes back with Change container when QT is still on a previous tote', async () => {
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON, start: SELECT_ITEM });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('ok');
    expect(actions[0]).toEqual(['Done', 'Done']);
  });

  it('returns no products when the tote has no datelot button', async () => {
    const { fetchMock } = fakeQt({ afterInput: NO_DATELOT });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result).toMatchObject({ status: 'ok', products: [] });
    expect(result.message).toContain('Container contents');
  });

  it('reports a missing login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, url: 'https://midway-auth.amazon.com/login', text: async () => '' })));
    const result = await fetchQtDatelotForTote('tsXSA900154', deps);
    expect(result.status).toBe('auth_required');
  });
});

describe('parseQtPage', () => {
  it('reads the workflow id and the item list of the real page', () => {
    const parsed = parseQtPage(SELECT_ITEM);
    expect(parsed).toMatchObject({
      found: true,
      objectId: OBJECT_ID,
      instructionId: 'EditItems',
      screen: 'Select item',
      hasTextInput: false,
      actions: ['Done'],
    });
    expect(parsed.products[0].expirationDate).toBe('Apr 10 2029');
  });
});

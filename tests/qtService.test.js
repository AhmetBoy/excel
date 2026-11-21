import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQtPage } from '../shared/parsers/qtDatelotParser.js';

const SELECT_ITEM = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'qt-select-item-real.html'), 'utf-8');
const OBJECT_ID = 'XSA9-6cdfbe99-a43f-4c57-8b3f-679d398ef209';

// Minimal pages for the steps not captured yet; `id`/`status` go into the
// page's a-state like on the real page.
const page = (body) => (id = OBJECT_ID, status = 'READY') => `<html><body>
<script type="a-state" data-a-state="{&quot;key&quot;:&quot;id&quot;}">{"instructionId":"EditItems","objectId":"${id}","status":"${status}"}</script>
<div id="workflow"><div class="aft-tool-action-box"><h1>${body.title}</h1></div>${body.html ?? ''}</div></body></html>`;
const TOTE_SCAN = page({ title: 'Scan container', html: '<form><input type="text" name="input"/></form>' });
const DATELOT_BUTTON = page({
  title: 'Container contents',
  html: '<span data-action="click-action" data-click-action="{&quot;action&quot;:&quot;ViewDatelotItems&quot;}"><input type="submit"/></span>',
});
const NO_DATELOT = page({ title: 'Container contents' });
const LOADING = page({ title: 'Loading' });
// "View Datelot Items" on a tote without dated items. The hidden status
// template mimics the real page, whose hidden boxes must not count.
const NO_DATELOT_ITEMS = page({
  title: 'Select item',
  html: '<div class="a-alert-content">No datelot items found in the container.</div>' +
    '<span data-action="click-action" data-click-action="{&quot;action&quot;:&quot;Done&quot;}"><input type="submit"/></span>' +
    '<div class="a-section aft-tool-hide"><h1>The workflow is closed</h1></div>',
});
const SELECT_ITEM_PAGE = (id = OBJECT_ID) => SELECT_ITEM.replace(OBJECT_ID, id);

/**
 * Fake QT that behaves like qtdatelot.har:
 * - /action moves the step; /status says PROCESSING once, then READY.
 * - "Done" ends the workflow: /status COMPLETE, and GET keeps serving a
 *   "Loading" page (old id, status COMPLETE) until /end closes it.
 * - The next GET opens a new workflow (new objectId) on `afterDone`, shown
 *   as "Loading" (PROCESSING) for `newWorkflowPolls` /status calls.
 */
function fakeQt({ afterInput, afterDatelot = SELECT_ITEM, start = TOTE_SCAN, afterDone = TOTE_SCAN, newWorkflowPolls = 2, stuckLoading = false }) {
  let objectId = OBJECT_ID;
  let workflowNo = 0;
  let step = start;
  let processing = false;
  let complete = false;
  let ended = false;
  let loadingPolls = 0;
  const actions = [];
  const ends = [];
  const reply = (text, status = 200) => ({ ok: status < 400, status, url: 'https://qt.eu.aftx.amazonoperations.app/x', text: async () => text });

  const render = () => {
    if (stuckLoading) return LOADING(objectId, 'READY');
    if (complete && !ended) return LOADING(objectId, 'COMPLETE');
    if (complete && ended) {
      workflowNo++;
      objectId = `XSA9-new-${workflowNo}`;
      complete = false;
      ended = false;
      step = afterDone;
      loadingPolls = newWorkflowPolls;
    }
    if (loadingPolls > 0) return LOADING(objectId, 'PROCESSING');
    return step === SELECT_ITEM ? SELECT_ITEM_PAGE(objectId) : step(objectId);
  };

  const fetchMock = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!init.body) return reply(render());
    const body = JSON.parse(init.body);
    const sameWorkflow = body.id?.objectId === objectId && body.id?.instructionId === 'EditItems';
    if (path === '/status') {
      if (!sameWorkflow) return reply('{"status":"COMPLETE"}');
      if (loadingPolls > 0) return reply(--loadingPolls > 0 ? '{"status":"PROCESSING"}' : '{"status":"READY"}');
      if (processing) {
        processing = false;
        return reply('{"status":"PROCESSING"}');
      }
      return reply(complete ? '{"status":"COMPLETE"}' : '{"status":"READY"}');
    }
    if (path === '/end') {
      ends.push(body);
      if (sameWorkflow && complete) ended = true;
      return reply('');
    }
    if (path === '/action') {
      if (!sameWorkflow) return reply('wrong workflow', 400);
      actions.push([body.action, body.input]);
      processing = true;
      if (body.action === 'Done') complete = true;
      else if (body.action === 'Input') step = afterInput;
      else if (body.action === 'ViewDatelotItems') step = afterDatelot;
      return reply('');
    }
    return reply('not found', 404);
  });
  return { fetchMock, actions, ends };
}

describe('fetchQtDatelotForTote', () => {
  let fetchQtDatelotForTote;
  let whenQtIdle;
  beforeEach(async () => {
    vi.resetModules();
    const service = await import('../background/services/qtService.js');
    ({ fetchQtDatelotForTote, whenQtIdle } = service);
    service.setQtTimingForTests({ statusPoll: 5, statusTimeout: 300, loadingTimeout: 300, loadingFirstDelay: 5, loadingMaxDelay: 20 });
  });
  // The "Change container" sent after a lookup must finish before the
  // fetch stub goes, or it leaks into the next test.
  afterEach(async () => {
    await whenQtIdle();
    vi.unstubAllGlobals();
  });

  const deps = { parsePage: async (html) => parseQtPage(html) };

  it('scans the tote, opens View Datelot Items and reads the dates', async () => {
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('ok');
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ fcSku: 'ZZV1OUR8NU', expirationDate: 'Apr 10 2029' });
    await whenQtIdle();
    expect(actions).toEqual([
      ['Input', 'tsXSA900154'],
      ['ViewDatelotItems', 'ViewDatelotItems'],
      // sent right after, so the next tote finds the scan screen ready
      ['Done', 'Done'],
    ]);
  });

  it('a second lookup right after the first finds the scan screen ready', async () => {
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON, newWorkflowPolls: 3 });
    vi.stubGlobal('fetch', fetchMock);

    await fetchQtDatelotForTote('tsXSA900154', deps);
    const second = await fetchQtDatelotForTote('tsXSA900155', deps);

    expect(second.status).toBe('ok');
    expect(second.log[0]).toBe('açılış → "Scan container"');
    await whenQtIdle();
    expect(actions.map(([action, input]) => `${action}:${input}`)).toEqual([
      'Input:tsXSA900154', 'ViewDatelotItems:ViewDatelotItems', 'Done:Done',
      'Input:tsXSA900155', 'ViewDatelotItems:ViewDatelotItems', 'Done:Done',
    ]);
  });

  it('goes back with Change container when QT is still on a previous tote', async () => {
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON, start: SELECT_ITEM });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('ok');
    expect(actions[0]).toEqual(['Done', 'Done']);
  });

  it('closes the finished workflow with /end and waits for the new one', async () => {
    const { fetchMock, actions, ends } = fakeQt({ afterInput: DATELOT_BUTTON, start: SELECT_ITEM, newWorkflowPolls: 3 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('ok');
    expect(result.products[0].expirationDate).toBe('Apr 10 2029');
    // exactly like the browser: /end with the OLD id and the tool name
    expect(ends[0]).toEqual({ id: { instructionId: 'EditItems', objectId: OBJECT_ID }, tool: 'edititems' });
    expect(result.log).toEqual([
      'açılış → "Select item"',
      '"Loading" (COMPLETE) bekleniyor',
      'akış kapatıldı (/end)',
      '"Loading" bitti (3 yükleme)',
      'Done → "Scan container"',
      'Input → "Container contents"',
      'ViewDatelotItems → "Select item"',
    ]);
    await whenQtIdle();
    expect(actions.map(([action]) => action)).toEqual(['Done', 'Input', 'ViewDatelotItems', 'Done']);
  });

  it('gives up when the page never leaves Loading', async () => {
    // /status says READY but the page stays Loading.
    const { fetchMock } = fakeQt({ afterInput: DATELOT_BUTTON, stuckLoading: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('error');
    expect(result.message).toContain('hep "Loading"');
    expect(result.message).toContain('objectId değişmedi');
  });

  it('explains the Select mode screen a finished workflow reopens on', async () => {
    const selectMode = page({ title: 'Select mode', html: '<form><fieldset><input type="radio" name="options" value="0"/></fieldset></form>' });
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON, start: SELECT_ITEM, afterDone: selectMode });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result.status).toBe('error');
    expect(result.message).toContain('Select mode');
    expect(result.message).toContain('akış kapatıldı (/end)');
    expect(result.message).toContain('Done → "Select mode"');
    expect(actions).toEqual([['Done', 'Done']]);
  });

  it('returns no products when the tote has no datelot button', async () => {
    const { fetchMock } = fakeQt({ afterInput: NO_DATELOT });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900154', deps);

    expect(result).toMatchObject({ status: 'ok', products: [] });
    expect(result.message).toContain('Container contents');
  });

  it('reads "No datelot items found" as a tote without dated items, not an error', async () => {
    const { fetchMock, actions } = fakeQt({ afterInput: DATELOT_BUTTON, afterDatelot: NO_DATELOT_ITEMS });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900155', deps);

    expect(result).toMatchObject({ status: 'ok', products: [], empty: 'no_items' });
    await whenQtIdle();
    expect(actions.map(([action]) => action)).toEqual(['Input', 'ViewDatelotItems', 'Done']);
  });

  it('still fails when the datelot screen shows neither items nor that message', async () => {
    const { fetchMock } = fakeQt({ afterInput: DATELOT_BUTTON, afterDatelot: page({ title: 'Something else' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQtDatelotForTote('tsXSA900155', deps);

    expect(result.status).toBe('unexpected_response');
    expect(result.message).toContain('ürün listesi okunamadı');
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

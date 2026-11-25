import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQtPage } from '../shared/parsers/qtDatelotParser.js';

const fixture = (name) => readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf-8');

// Saved live 2026-11-25 (trimmed), all with this workflow id.
const LIVE_ID = 'XSA9-8a05f447-15d5-4234-920a-d785122d3286';
const SELECT_STATE = fixture('qt-edit-select-state.html');
const CONFIRM = fixture('qt-edit-confirm.html');
const SCAN_ITEM = fixture('qt-edit-scan-item.html');
const SCAN_ITEM_ERROR = fixture('qt-edit-scan-item-error.html');
// Older live save, FCSku ZZV1OUR8NU at radio 0.
const SELECT_ITEM_ID = 'XSA9-6cdfbe99-a43f-4c57-8b3f-679d398ef209';
const SELECT_ITEM = fixture('qt-select-item-real.html');

// Not captured yet: built like the live pages.
const MODE_BUTTON =
  '<span data-action="click-action" data-click-action="{&quot;action&quot;:&quot;SelectMode&quot;}"><input type="submit"/></span>';
const built = (title, html = '') => `<html><body>
<script type="a-state" data-a-state="{&quot;key&quot;:&quot;id&quot;}">{"instructionId":"EditItems","objectId":"${LIVE_ID}","status":"READY"}</script>
${MODE_BUTTON}<div id="workflow"><div class="aft-tool-action-box"><h1>${title}</h1></div>${html}</div></body></html>`;
const SELECT_MODE = built(
  'Select mode',
  '<form><input type="radio" name="options" value="EACH"/><input type="radio" name="options" value="CONTAINER"/></form>'
);
const SCAN_CONTAINER = built('Scan container', '<form><input type="text"/></form>');
const LOADING = (id, status) => `<html><body>
<script type="a-state" data-a-state="{&quot;key&quot;:&quot;id&quot;}">{"instructionId":"EditItems","objectId":"${id}","status":"${status}"}</script>
<div id="workflow"><h1>Loading</h1></div></body></html>`;

const PAGES = {
  selectMode: SELECT_MODE,
  scanContainer: SCAN_CONTAINER,
  scanItem: SCAN_ITEM,
  scanItemError: SCAN_ITEM_ERROR,
  selectItem: SELECT_ITEM.replace(SELECT_ITEM_ID, LIVE_ID),
  selectState: SELECT_STATE,
  confirm: CONFIRM,
};

/**
 * Fake QT EditItems following the live HARs: "EACH" and "Done" end the
 * workflow (COMPLETE until /end, then a new id on "Scan container").
 */
function fakeQt({ start = 'scanContainer', rejected = [], needsSelect = [], confirmPage = null } = {}) {
  let objectId = 'XSA9-start';
  let screen = start;
  let complete = false;
  let ended = false;
  let workflowNo = 0;
  const actions = [];
  const reply = (text, status = 200) => ({ ok: status < 400, status, url: 'https://qt.eu.aftx.amazonoperations.app/x', text: async () => text });

  const render = () => {
    if (complete && !ended) return LOADING(objectId, 'COMPLETE');
    if (complete && ended) {
      objectId = `XSA9-new-${++workflowNo}`;
      complete = false;
      ended = false;
    }
    const html = screen === 'confirm' && confirmPage ? confirmPage : PAGES[screen];
    return html.replace(LIVE_ID, objectId);
  };

  const move = (action, input) => {
    if (action === 'SelectMode') return (screen = 'selectMode');
    if (action === 'Done') {
      complete = true;
      return (screen = 'scanContainer');
    }
    if (action === 'Confirm' && screen === 'confirm') return (screen = 'scanItem');
    if (action !== 'Input') throw new Error(`unexpected ${action} on ${screen}`);
    if (screen === 'selectMode' && input === 'EACH') {
      complete = true;
      return (screen = 'scanContainer');
    }
    if (screen === 'scanContainer') return (screen = 'scanItem');
    if (screen === 'scanItem' || screen === 'scanItemError') {
      if (rejected.includes(input)) return (screen = 'scanItemError');
      return (screen = needsSelect.includes(input) ? 'selectItem' : 'selectState');
    }
    if (screen === 'selectItem') return (screen = 'selectState');
    if (screen === 'selectState' && input === 'INVENTORY') return (screen = 'confirm');
    throw new Error(`unexpected Input ${input} on ${screen}`);
  };

  const fetchMock = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!init.body) return reply(render());
    const body = JSON.parse(init.body);
    if (path === '/status') return reply(complete ? '{"status":"COMPLETE"}' : '{"status":"READY"}');
    if (path === '/end') {
      if (body.id?.objectId === objectId && complete) ended = true;
      return reply('');
    }
    if (path === '/action') {
      if (body.id?.objectId !== objectId) return reply('wrong workflow', 400);
      actions.push([body.action, body.input]);
      move(body.action, body.input);
      return reply('');
    }
    return reply('not found', 404);
  });
  return { fetchMock, actions };
}

describe('parseQtPage on the live EditItems screens', () => {
  it('reads the inventory states and the Confirm button outside #workflow', () => {
    const state = parseQtPage(SELECT_STATE);
    expect(state.screen).toBe('Select new inventory state');
    expect(state.options.map((o) => o.value)).toEqual(['INVENTORY', 'PENDING_RESEARCH', 'UNSELLABLE', 'PENDING_REPAIR']);
    const confirm = parseQtPage(CONFIRM);
    expect(confirm.screen).toBe('Confirm change');
    expect(confirm.pageActions).toEqual(expect.arrayContaining(['Confirm', 'SelectMode', 'Done']));
    expect(confirm.text).toMatch(/Targeted Inventory State:\s*Inventory/);
    expect(confirm.text).toMatch(/Quantity To Change:\s*1/);
  });

  it('reads the item options with their FCSku and the scan error', () => {
    expect(parseQtPage(SELECT_ITEM).options).toEqual([expect.objectContaining({ value: '0', fcSku: 'ZZV1OUR8NU', quantity: '2' })]);
    expect(parseQtPage(SCAN_ITEM_ERROR).messages).toEqual(['Item B0855RGKMY is not in the container.']);
  });
});

describe('changeItemsToSellable', () => {
  let changeItemsToSellable;
  beforeEach(async () => {
    vi.resetModules();
    const service = await import('../background/services/qtService.js');
    ({ changeItemsToSellable } = service);
    service.setQtTimingForTests({ statusPoll: 5, statusTimeout: 300, loadingTimeout: 300, loadingFirstDelay: 5, loadingMaxDelay: 20 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const deps = { parsePage: async (html) => parseQtPage(html) };

  it('picks EACH mode, scans tote and LPN, confirms Inventory and leaves the tote', async () => {
    const { fetchMock, actions } = fakeQt();
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeItemsToSellable('tsCRETSELL554', [{ scan: 'LPNUIN15014357', fcSku: 'X00A', quantity: 1 }], deps);

    expect(result.status).toBe('ok');
    expect(result.items[0]).toMatchObject({ status: 'ok', changed: 1 });
    expect(actions).toEqual([
      ['SelectMode', 'SelectMode'],
      ['Input', 'EACH'],
      ['Input', 'tsCRETSELL554'],
      ['Input', 'LPNUIN15014357'],
      ['Input', 'INVENTORY'],
      ['Confirm', 'Confirm'],
      ['Done', 'Done'],
    ]);
  });

  it('does one pass per unit and picks the item by FCSku on "Select item"', async () => {
    const { fetchMock, actions } = fakeQt({ start: 'selectMode', needsSelect: ['ZZV1OUR8NU'] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeItemsToSellable('tsXSA900570', [{ scan: 'ZZV1OUR8NU', fcSku: 'ZZV1OUR8NU', quantity: 2 }], deps);

    expect(result.items[0]).toMatchObject({ status: 'ok', changed: 2 });
    const pass = [['Input', 'ZZV1OUR8NU'], ['Input', '0'], ['Input', 'INVENTORY'], ['Confirm', 'Confirm']];
    expect(actions).toEqual([['Input', 'EACH'], ['Input', 'tsXSA900570'], ...pass, ...pass, ['Done', 'Done']]);
  });

  it('reports an item QT refuses and goes on with the next one', async () => {
    const { fetchMock, actions } = fakeQt({ rejected: ['B0855RGKMY'] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeItemsToSellable(
      'tsXSA900570',
      [
        { scan: 'B0855RGKMY', fcSku: 'B0855RGKMY', quantity: 1 },
        { scan: 'LPN2', fcSku: 'X00B', quantity: 1 },
      ],
      deps
    );

    expect(result.status).toBe('partial_failure');
    expect(result.items[0]).toMatchObject({ status: 'item_rejected', changed: 0 });
    expect(result.items[0].message).toContain('is not in the container');
    expect(result.items[1]).toMatchObject({ status: 'ok', changed: 1 });
    expect(actions.filter(([a]) => a === 'Confirm')).toHaveLength(1);
  });

  it('stops without confirming when the FCSku is not on "Select item"', async () => {
    const { fetchMock, actions } = fakeQt({ needsSelect: ['B01A3CPJH8'] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeItemsToSellable(
      'tsXSA900570',
      [
        { scan: 'B01A3CPJH8', fcSku: 'B01A3CPJH8', quantity: 1 },
        { scan: 'LPN2', fcSku: 'X00B', quantity: 1 },
      ],
      deps
    );

    expect(result.status).toBe('error');
    expect(result.items[0].message).toContain('Select item');
    expect(result.items[1].status).toBe('skipped');
    expect(actions.some(([a]) => a === 'Confirm')).toBe(false);
    expect(actions.at(-1)).toEqual(['Done', 'Done']);
  });

  it('counts a pass that moves several units, once', async () => {
    const { fetchMock, actions } = fakeQt({ confirmPage: CONFIRM.replace(/(Quantity To Change:[^0-9]*)1/, '$13') });
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeItemsToSellable('tsXSA900570', [{ scan: 'LPN1', fcSku: 'X00A', quantity: 3 }], deps);

    expect(result.items[0]).toMatchObject({ status: 'ok', changed: 3 });
    expect(actions.filter(([a]) => a === 'Confirm')).toHaveLength(1);
  });

  it('changes 20 rows in one run: one mode pick, one tote scan, one exit', async () => {
    const { fetchMock, actions } = fakeQt();
    vi.stubGlobal('fetch', fetchMock);
    const items = Array.from({ length: 20 }, (_, i) => ({ scan: `LPN${i}`, fcSku: `X00${i}`, quantity: 1 }));

    const result = await changeItemsToSellable('tsXSA900570', items, deps);

    expect(result.status).toBe('ok');
    expect(result.items.every((item) => item.changed === 1)).toBe(true);
    expect(actions.filter(([a]) => a === 'Confirm')).toHaveLength(20);
    expect(actions.filter(([, input]) => input === 'EACH')).toHaveLength(1);
    expect(actions.filter(([, input]) => input === 'tsXSA900570')).toHaveLength(1);
    expect(actions.filter(([a]) => a === 'Done')).toHaveLength(1);
  });

  it('never confirms more units than the row has left', async () => {
    const { fetchMock, actions } = fakeQt({ confirmPage: CONFIRM.replace(/(Quantity To Change:[^0-9]*)1/, '$13') });
    vi.stubGlobal('fetch', fetchMock);

    const result = await changeItemsToSellable('tsXSA900570', [{ scan: 'LPN1', fcSku: 'X00A', quantity: 1 }], deps);

    expect(result.items[0].status).toBe('unexpected_screen');
    expect(actions.some(([a]) => a === 'Confirm')).toBe(false);
    expect(actions.at(-1)).toEqual(['Done', 'Done']);
  });
});

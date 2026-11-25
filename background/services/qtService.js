// QT EditItems, driven from the background with the user's cookies - the
// same requests the page sends when a person clicks through it (captured in
// Desktop/edit.txt, 2026-11-19):
//
//   POST /action  {"id":{"instructionId":"EditItems","objectId":"XSA9-…"},"action":"Input","input":"tsX…"}
//                 -> empty body
//   POST /status  {"id":{…}}  -> {"status":"PROCESSING"} … {"status":"READY"}
//   GET  /app/edititems?experience=Desktop -> the page of the new step
//   POST /end     {"id":{…},"tool":"edititems"} -> closes a COMPLETE workflow
//                 (after "Done"); the next GET starts a new one
//
// A button sends its data-click-action name as both action and input
// ("ViewDatelotItems", "Done").
//
// Only read steps are sent: the tote scan, "View Datelot Items" and
// "Change container" (Done). Nothing is ever selected on the "Select item"
// list, so no item is edited.
//
// The workflow lives on the server per user, so a QT tab the user has open
// shows whatever step this leaves it on.

const QT_ORIGIN = 'https://qt.eu.aftx.amazonoperations.app';
const PAGE_PATH = '/app/edititems?experience=Desktop';

// Both at the origin root: POST …/status confirmed live 2026-11-19; /action
// sits next to it.
const STATUS_PATH = '/status';
const ACTION_PATH = '/action';
// Closes a workflow that reached COMPLETE (seen in qtdatelot.har: after
// "Done" the page sends it, then a GET opens a new workflow).
const END_PATH = '/end';
const TOOL = 'edititems';

const REQUEST_TIMEOUT_MS = 20000;
// Waits, in ms. A new workflow (after "Done") is served as "Loading" for a
// while. Tests shorten these with setQtTimingForTests().
const timing = {
  statusPoll: 300,
  statusTimeout: 15000,
  loadingTimeout: 20000,
  loadingFirstDelay: 500,
  loadingMaxDelay: 2000,
};

export function setQtTimingForTests(overrides) {
  Object.assign(timing, overrides);
}

const ACTION_INPUT = 'Input';
const ACTION_VIEW_DATELOT = 'ViewDatelotItems';
const ACTION_CHANGE_CONTAINER = 'Done';
const SELECT_MODE_SCREEN = 'Select mode';

class QtError extends Error {
  constructor(message, status = 'error') {
    super(message);
    this.status = status;
  }
}

async function request(path, { json } = {}) {
  let response;
  try {
    response = await fetch(`${QT_ORIGIN}${path}`, {
      method: json ? 'POST' : 'GET',
      credentials: 'include',
      headers: json ? { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' } : {},
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new QtError(`QT isteği başarısız (${path}): ${error?.message ?? error}`, 'network_error');
  }
  if (response.status === 401 || response.status === 403 || !response.url.startsWith(QT_ORIGIN)) {
    throw new QtError('QT oturumu yok — QT sayfasına bir kez giriş yapın.', 'auth_required');
  }
  return { ok: response.ok, status: response.status, text: await response.text() };
}

function readStatus(text) {
  try {
    const status = JSON.parse(text)?.status;
    return typeof status === 'string' ? status : null;
  } catch {
    return null;
  }
}

async function postStatus(id) {
  const result = await request(STATUS_PATH, { json: { id } });
  return result.ok ? readStatus(result.text) : null;
}

/** @returns {Promise<'READY'|'COMPLETE'>} */
async function waitUntilReady(id) {
  const deadline = Date.now() + timing.statusTimeout;
  for (;;) {
    const status = (await postStatus(id))?.toUpperCase() ?? null;
    // COMPLETE: the action ended this workflow (seen after "Done" = Change
    // container); the next page load starts a new one with a new objectId.
    if (status === 'READY' || status === 'COMPLETE') return status;
    if (status !== 'PROCESSING') throw new QtError(`QT beklenmeyen durum döndü: ${status ?? 'okunamadı'}`);
    if (Date.now() > deadline) throw new QtError('QT işlemi bitmedi (status PROCESSING kaldı).');
    await new Promise((resolve) => setTimeout(resolve, timing.statusPoll));
  }
}

function idOf(page) {
  return { instructionId: page.instructionId ?? 'EditItems', objectId: page.objectId };
}

// A page whose workflow isn't ready yet: a new workflow (after "Done" ended
// the previous one, or the first visit) is served as a "Loading" page while
// the server sets it up; the real page's JS polls /status and reloads.
function isStillLoading(page) {
  return page.status === 'PROCESSING' || page.status === 'COMPLETE' || /^loading/i.test(page.screen ?? '');
}

/**
 * GETs the page, waiting through "Loading" pages until a real step shows.
 * The new workflow can take several seconds after "Done", so it waits up to
 * timing.loadingTimeout, polling less often as time goes on.
 */
async function loadPage(parsePage, log, { endedObjectId = null } = {}) {
  const deadline = Date.now() + timing.loadingTimeout;
  let delay = timing.loadingFirstDelay;
  let first = null;
  let loads = 0;
  const endSent = new Set();
  for (;;) {
    const result = await request(PAGE_PATH);
    loads++;
    if (!result.ok) throw new QtError(`QT sayfası açılamadı (HTTP ${result.status}).`, 'request_failed');
    const page = await parsePage(result.text);
    if (!page?.found) throw new QtError('QT sayfası okunamadı (objectId yok — oturum açık mı?).', 'unexpected_response');
    if (!isStillLoading(page)) {
      if (first) log.push(`"${first.screen ?? '?'}" bitti (${loads} yükleme)`);
      return page;
    }

    if (!first) {
      first = page;
      log.push(`"${page.screen ?? '?'}" (${page.status ?? '?'}) bekleniyor`);
    }
    if (Date.now() > deadline) {
      const idNote = page.objectId === first.objectId ? 'objectId değişmedi' : 'objectId değişti';
      throw new QtError(
        `QT sayfası hazır olmadı (${Math.round(timing.loadingTimeout / 1000)} sn, ${loads} yükleme, hep "${page.screen ?? '?'}", ` +
          `status ${page.status ?? '?'}, ${idNote}).`
      );
    }
    // A finished workflow stays on "Loading" until it is closed with /end;
    // the next GET then starts a new workflow with a new objectId.
    const finished = page.status === 'COMPLETE' || page.objectId === endedObjectId;
    if (finished && !endSent.has(page.objectId)) {
      endSent.add(page.objectId);
      const end = await request(END_PATH, { json: { id: idOf(page), tool: TOOL } });
      if (!end.ok) throw new QtError(`QT /end isteği reddedildi (HTTP ${end.status}).`, 'request_failed');
      log.push('akış kapatıldı (/end)');
      continue;
    }
    await waitUntilReady(idOf(page));
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, timing.loadingMaxDelay);
  }
}

async function act(page, action, input, parsePage, log) {
  const id = idOf(page);
  const result = await request(ACTION_PATH, { json: { id, action, input } });
  if (!result.ok) throw new QtError(`QT ${action} isteği reddedildi (HTTP ${result.status}).`, 'request_failed');
  const finalStatus = await waitUntilReady(id);
  const next = await loadPage(parsePage, log, { endedObjectId: finalStatus === 'COMPLETE' ? id.objectId : null });
  log.push(`${action} → "${next.screen ?? '?'}"`);
  return next;
}

function describe(page) {
  const extra = page.messages?.length ? ` — ${page.messages.join(' / ')}` : '';
  return `QT ekranı: "${page.screen ?? '?'}"${extra}`;
}

// QT answered "No datelot items found in the container.": nothing to check.
function noItems(page, log) {
  return { status: 'ok', products: [], empty: 'no_items', screen: page.screen, message: describe(page), log };
}

async function lookup(toteNumber, parsePage, log) {
  let page = await loadPage(parsePage, log);
  log.push(`açılış → "${page.screen ?? '?'}"`);

  // Left on an earlier tote's step (e.g. "Select item"): go back to the scan.
  if (!page.hasTextInput && page.actions.includes(ACTION_CHANGE_CONTAINER)) {
    page = await act(page, ACTION_CHANGE_CONTAINER, ACTION_CHANGE_CONTAINER, parsePage, log);
  }
  if (!page.hasTextInput && page.screen === SELECT_MODE_SCREEN) {
    throw new QtError(
      "QT mod seçim ekranında (Select mode). Mod seçimi henüz eklenmedi — şimdilik QT'de modu bir kez elle seçin."
    );
  }
  if (!page.hasTextInput) {
    throw new QtError(`QT tote okutma ekranında değil (${describe(page)}).`);
  }

  page = await act(page, ACTION_INPUT, toteNumber, parsePage, log);
  if (page.products.length > 0) return { result: { status: 'ok', products: page.products, log }, page };
  if (page.noDatelotItems) return { result: noItems(page, log), page };

  if (page.actions.includes(ACTION_VIEW_DATELOT)) {
    page = await act(page, ACTION_VIEW_DATELOT, ACTION_VIEW_DATELOT, parsePage, log);
    if (page.products.length === 0 && page.noDatelotItems) return { result: noItems(page, log), page };
    if (page.products.length === 0) {
      throw new QtError(`View Datelot Items açıldı ama ürün listesi okunamadı (${describe(page)}).`, 'unexpected_response');
    }
    return { result: { status: 'ok', products: page.products, log }, page };
  }

  // No "View Datelot Items" button: the tote has no dated items.
  return { result: { status: 'ok', products: [], empty: 'no_button', screen: page.screen, message: describe(page), log }, page };
}

/**
 * Right after a lookup, sends "Change container" so the new workflow it
 * starts is already past "Loading" when the next tote is scanned. Failures
 * here only cost time: the next lookup checks the page again anyway.
 */
async function prepareNextScan(page, parsePage) {
  if (page.hasTextInput || !page.actions.includes(ACTION_CHANGE_CONTAINER)) return;
  const log = [];
  try {
    await act(page, ACTION_CHANGE_CONTAINER, ACTION_CHANGE_CONTAINER, parsePage, log);
  } catch (error) {
    console.warn('[tote-lookup] QT prepare for next scan failed:', error?.message ?? error, log.join(' → '));
  }
}

// ---------------------------------------------------------------------------
// Change to Sellable (writes!). Captured live 2026-11-25 (HARs + saved pages):
//
//   SelectMode            -> "Select mode"        (header button "Change mode")
//   Input "EACH"          -> workflow COMPLETE, /end, new one -> "Scan container"
//   Input <tote>          -> "Scan item"
//   Input <LPN|FCSku>     -> "Select item" (radio 0,1… with FCSku) or straight on
//   Input "<index>"       -> "Select new inventory state"
//   Input "INVENTORY"     -> "Confirm change" ("Targeted Inventory State: Inventory",
//                            "Quantity To Change: 1")
//   Confirm               -> "Scan item" (next unit / next item)
//   Done                  -> workflow COMPLETE, /end, new one -> "Scan container"
//
// EACH mode changes one unit per pass ("Quantity To Change: 1"), so a row of
// quantity N takes N passes; a pass the screen says moves more is counted
// as that many, never more than the row still has.
// Every step checks the screen and the choice it needs before sending; a
// surprise stops the run before "Confirm" and leaves with "Change container".

const SCREEN = {
  selectMode: 'select mode',
  scanContainer: 'scan container',
  scanItem: 'scan item',
  selectItem: 'select item',
  selectState: 'select new inventory state',
  confirm: 'confirm change',
};
const MODE_EACH = 'EACH';
const STATE_INVENTORY = 'INVENTORY';
const ACTION_SELECT_MODE = 'SelectMode';
const ACTION_CONFIRM = 'Confirm';

function isScreen(page, name) {
  return (page.screen ?? '').trim().toLowerCase() === name;
}

function expectScreen(page, name) {
  if (!isScreen(page, name)) {
    throw new QtError(`Beklenen QT ekranı "${name}", gelen: ${describe(page)}`, 'unexpected_screen');
  }
}

function expectOption(page, value) {
  if (!(page.options ?? []).some((o) => o.value === value)) {
    throw new QtError(`"${page.screen}" ekranında "${value}" seçeneği yok (${describe(page)}).`, 'unexpected_screen');
  }
}

function sameSku(a, b) {
  return Boolean(a && b) && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * Scans `item` on "Scan item" and confirms it as Sellable.
 * @param {number} remaining - units of the row not changed yet
 * @returns {Promise<{ page: object, units: number }>}
 */
async function changeOneUnit(page, item, remaining, parsePage, log) {
  expectScreen(page, SCREEN.scanItem);
  page = await act(page, ACTION_INPUT, item.scan, parsePage, log);
  if (isScreen(page, SCREEN.scanItem) && page.messages.length > 0) {
    throw new QtError(`QT: ${page.messages.join(' / ')}`, 'item_rejected');
  }

  if (isScreen(page, SCREEN.selectItem)) {
    const matches = page.options.filter((o) => sameSku(o.fcSku, item.fcSku));
    if (matches.length !== 1) {
      const listed = page.options.map((o) => o.fcSku ?? '?').join(', ');
      throw new QtError(
        `"Select item" listesinde FCSku ${item.fcSku ?? '?'} ${matches.length === 0 ? 'yok' : 'birden fazla'} (liste: ${listed}).`,
        'unexpected_screen'
      );
    }
    page = await act(page, ACTION_INPUT, matches[0].value, parsePage, log);
  }

  expectScreen(page, SCREEN.selectState);
  expectOption(page, STATE_INVENTORY);
  page = await act(page, ACTION_INPUT, STATE_INVENTORY, parsePage, log);

  expectScreen(page, SCREEN.confirm);
  const text = page.text ?? '';
  if (!/targeted inventory state:\s*inventory/i.test(text)) {
    throw new QtError(`Onay ekranı Inventory (Sellable) hedeflemiyor: ${text.slice(0, 200)}`, 'unexpected_screen');
  }
  const qty = /quantity to change:\s*(\d+)/i.exec(text);
  const units = qty ? Number(qty[1]) : NaN;
  if (!(units >= 1 && units <= remaining)) {
    throw new QtError(
      `Onay ekranında değişecek adet ${qty?.[1] ?? '?'}, bu üründe kalan ${remaining} — onaylanmadı.`,
      'unexpected_screen'
    );
  }
  if (!page.pageActions.includes(ACTION_CONFIRM)) {
    throw new QtError('Onay ekranında Confirm butonu yok.', 'unexpected_screen');
  }
  return { page: await act(page, ACTION_CONFIRM, ACTION_CONFIRM, parsePage, log), units };
}

/** Puts the workflow on "Scan container" in EACH mode. */
async function openInEachMode(parsePage, log) {
  let page = await loadPage(parsePage, log);
  log.push(`açılış → "${page.screen ?? '?'}"`);
  if (!isScreen(page, SCREEN.selectMode)) {
    if (!page.pageActions.includes(ACTION_SELECT_MODE)) {
      throw new QtError(`"Change mode" butonu bulunamadı (${describe(page)}).`, 'unexpected_screen');
    }
    page = await act(page, ACTION_SELECT_MODE, ACTION_SELECT_MODE, parsePage, log);
  }
  expectScreen(page, SCREEN.selectMode);
  expectOption(page, MODE_EACH);
  page = await act(page, ACTION_INPUT, MODE_EACH, parsePage, log);
  expectScreen(page, SCREEN.scanContainer);
  return page;
}

// Leaves the tote with "Change container", never confirming anything open.
async function leaveTote(page, parsePage, log) {
  try {
    if (!page.pageActions?.includes(ACTION_CHANGE_CONTAINER)) page = await loadPage(parsePage, log);
    if (page.pageActions.includes(ACTION_CHANGE_CONTAINER)) {
      await act(page, ACTION_CHANGE_CONTAINER, ACTION_CHANGE_CONTAINER, parsePage, log);
    }
  } catch (error) {
    log.push(`tote'tan çıkılamadı: ${error?.message ?? error}`);
  }
}

async function changeToSellable(toteNumber, items, parsePage, log) {
  const results = items.map((item) => ({ ...item, changed: 0, status: 'pending', message: null }));
  let page = await openInEachMode(parsePage, log);
  page = await act(page, ACTION_INPUT, toteNumber, parsePage, log);
  if (!isScreen(page, SCREEN.scanItem)) {
    const extra = page.messages.length ? page.messages.join(' / ') : describe(page);
    await leaveTote(page, parsePage, log);
    throw new QtError(`Tote açılamadı: ${extra}`, 'unexpected_screen');
  }

  let stopped = false;
  for (const result of results) {
    if (stopped) {
      result.status = 'skipped';
      continue;
    }
    try {
      while (result.changed < result.quantity) {
        const pass = await changeOneUnit(page, result, result.quantity - result.changed, parsePage, log);
        page = pass.page;
        result.changed += pass.units;
        log.push(`${result.scan}: ${result.changed}/${result.quantity} Sellable`);
      }
      result.status = 'ok';
    } catch (error) {
      result.status = error instanceof QtError ? error.status : 'error';
      result.message = String(error?.message ?? error);
      // QT refusing the scan leaves it on "Scan item", so the next item can
      // go on. Any other surprise stops the run.
      if (result.status === 'item_rejected') page = await loadPage(parsePage, log);
      else stopped = true;
    }
  }

  await leaveTote(page, parsePage, log);

  const failed = results.filter((r) => r.status !== 'ok');
  return {
    status: failed.length === 0 ? 'ok' : results.some((r) => r.changed > 0) ? 'partial_failure' : 'error',
    items: results,
    log,
  };
}

// The workflow is one per user on the server: two lookups at once would
// step on each other, so they run one after another.
let queue = Promise.resolve();

/**
 * Searches a tote in QT EditItems and reads its datelot items
 * (Title / FCSku / Quantity / Owner / Expiration date).
 *
 * @param {string} toteNumber
 * @param {{ parsePage: (html: string) => Promise<object> }} deps - parseQtPage run where a DOM exists
 * @returns {Promise<{ status: string, products?: Array<object>, message?: string, screen?: string, log?: string[] }>}
 */
export function fetchQtDatelotForTote(toteNumber, { parsePage }) {
  const log = [];
  let lastPage = null;
  const run = queue.then(() =>
    lookup(toteNumber, parsePage, log).then(({ result, page }) => {
      lastPage = page;
      return result;
    }, (error) => {
      // The steps that did work tell where it stopped.
      const steps = log.length > 0 ? ` [adımlar: ${log.join(' → ')}]` : '';
      return {
        status: error instanceof QtError ? error.status : 'error',
        message: `${String(error?.message ?? error)}${steps}`,
        log,
      };
    })
  );
  // The next lookup waits for this one and for its "Change container".
  queue = run.then(() => (lastPage ? prepareNextScan(lastPage, parsePage) : undefined)).catch(() => {});
  return run;
}

/** Resolves once every queued lookup and its "Change container" are done. */
export function whenQtIdle() {
  return queue;
}

/**
 * Changes items of a tote to Sellable (Owner UNOWNED, Disposition SELLABLE)
 * in QT EditItems, EACH mode, one unit at a time. Runs in the same queue as
 * the datelot lookups, so the two never step on each other.
 *
 * @param {string} toteNumber
 * @param {Array<{ scan: string, fcSku: string|null, quantity: number }>} items
 *   scan = what is typed on "Scan item" (LPN, else FCSku / ASIN)
 * @param {{ parsePage: (html: string) => Promise<object> }} deps
 * @returns {Promise<{ status: string, items: object[], message?: string, log: string[] }>}
 */
export function changeItemsToSellable(toteNumber, items, { parsePage }) {
  const log = [];
  const run = queue.then(() =>
    changeToSellable(toteNumber, items, parsePage, log).catch((error) => {
      const steps = log.length > 0 ? ` [adımlar: ${log.join(' → ')}]` : '';
      return {
        status: error instanceof QtError ? error.status : 'error',
        message: `${String(error?.message ?? error)}${steps}`,
        items: items.map((item) => ({ ...item, changed: 0, status: 'skipped' })),
        log,
      };
    })
  );
  queue = run.catch(() => {});
  return run;
}

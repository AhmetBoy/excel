// QT EditItems, driven from the background with the user's cookies - the
// same requests the page sends when a person clicks through it (captured in
// Desktop/edit.txt, 2026-11-19):
//
//   POST /action  {"id":{"instructionId":"EditItems","objectId":"XSA9-…"},"action":"Input","input":"tsX…"}
//                 -> empty body
//   POST /status  {"id":{…}}  -> {"status":"PROCESSING"} … {"status":"READY"}
//   GET  /app/edititems?experience=Desktop -> the page of the new step
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

const REQUEST_TIMEOUT_MS = 20000;
const STATUS_POLL_MS = 300;
const STATUS_TIMEOUT_MS = 15000;

const ACTION_INPUT = 'Input';
const ACTION_VIEW_DATELOT = 'ViewDatelotItems';
const ACTION_CHANGE_CONTAINER = 'Done';

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

async function waitUntilReady(id) {
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  for (;;) {
    const status = await postStatus(id);
    if (status === 'READY') return;
    if (status !== 'PROCESSING') throw new QtError(`QT beklenmeyen durum döndü: ${status ?? 'okunamadı'}`);
    if (Date.now() > deadline) throw new QtError('QT işlemi bitmedi (status PROCESSING kaldı).');
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
  }
}

function idOf(page) {
  return { instructionId: page.instructionId ?? 'EditItems', objectId: page.objectId };
}

async function loadPage(parsePage) {
  const result = await request(PAGE_PATH);
  if (!result.ok) throw new QtError(`QT sayfası açılamadı (HTTP ${result.status}).`, 'request_failed');
  const page = await parsePage(result.text);
  if (!page?.found) throw new QtError('QT sayfası okunamadı (objectId yok — oturum açık mı?).', 'unexpected_response');
  return page;
}

async function act(page, action, input, parsePage, log) {
  const id = idOf(page);
  const result = await request(ACTION_PATH, { json: { id, action, input } });
  if (!result.ok) throw new QtError(`QT ${action} isteği reddedildi (HTTP ${result.status}).`, 'request_failed');
  await waitUntilReady(id);
  const next = await loadPage(parsePage);
  log.push(`${action} → "${next.screen ?? '?'}"`);
  return next;
}

function describe(page) {
  const extra = page.messages?.length ? ` — ${page.messages.join(' / ')}` : '';
  return `QT ekranı: "${page.screen ?? '?'}"${extra}`;
}

async function lookup(toteNumber, parsePage) {
  const log = [];
  let page = await loadPage(parsePage);
  log.push(`açılış → "${page.screen ?? '?'}"`);

  // Left on an earlier tote's step (e.g. "Select item"): go back to the scan.
  if (!page.hasTextInput && page.actions.includes(ACTION_CHANGE_CONTAINER)) {
    page = await act(page, ACTION_CHANGE_CONTAINER, ACTION_CHANGE_CONTAINER, parsePage, log);
  }
  if (!page.hasTextInput) {
    throw new QtError(`QT tote okutma ekranında değil (${describe(page)}).`);
  }

  page = await act(page, ACTION_INPUT, toteNumber, parsePage, log);
  if (page.products.length > 0) return { status: 'ok', products: page.products, log };

  if (page.actions.includes(ACTION_VIEW_DATELOT)) {
    page = await act(page, ACTION_VIEW_DATELOT, ACTION_VIEW_DATELOT, parsePage, log);
    if (page.products.length === 0) {
      throw new QtError(`View Datelot Items açıldı ama ürün listesi okunamadı (${describe(page)}).`, 'unexpected_response');
    }
    return { status: 'ok', products: page.products, log };
  }

  // No "View Datelot Items" button: the tote has no dated items.
  return { status: 'ok', products: [], screen: page.screen, message: describe(page), log };
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
  const run = queue.then(() =>
    lookup(toteNumber, parsePage).catch((error) => ({
      status: error instanceof QtError ? error.status : 'error',
      message: String(error?.message ?? error),
    }))
  );
  queue = run.catch(() => {});
  return run;
}

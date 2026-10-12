/**
 * Runs inside an already-open, logged-in QT tab (qt.eu.aftx.amazonoperations.app).
 *
 * STATUS: PARTIALLY VERIFIED. Real testing confirmed that submitting the
 * tote search form triggers a full page navigation (Network tab shows a
 * "Document" request, not Fetch/XHR) rather than an in-page AJAX update.
 * That means this script's JS context is destroyed the moment the new
 * page starts loading - it cannot simply "wait" for results the way a
 * single-page app would allow. Instead, the in-flight lookup's state is
 * persisted to chrome.storage.session before submitting, and every fresh
 * injection of this script (which happens again on the new page after
 * navigation) checks for and resumes that pending state. The final result
 * is reported to the background script via a one-off runtime message
 * correlated by requestId, not via the initial message's response -
 * the initial response may never arrive if navigation already started.
 *
 * Design choice: instead of crafting a raw POST to /action with a guessed
 * `id.objectId`, this finds the REAL <form> already rendered on the page
 * (identified by its confirmed field names) and submits it exactly as the
 * page itself would. That avoids guessing the dynamic objectId or any
 * hidden/CSRF-style fields entirely - whatever the page already carries
 * gets submitted as-is.
 *
 * If this stops working, the most likely cause is that one of the
 * selectors below (marked GUESSED) no longer matches the real page -
 * inspect the real DOM in DevTools and update the matching constant.
 */

// CONFIRMED (spec section 2, /action request body field names).
const TOTE_INPUT_NAME = 'input';
const OBJECT_ID_FIELD_NAME = 'id.objectId';

// GUESSED - update if the real control uses different text/markup.
const DATELOT_LINK_TEXT = 'view datelot items';

const STORAGE_KEY = 'qtLookupState';
const OVERALL_TIMEOUT_MS = 20000;

function log(...args) {
  console.debug('[tote-lookup]', ...args);
}

function findToteForm() {
  const candidateInputs = Array.from(
    document.querySelectorAll(`input[name="${TOTE_INPUT_NAME}"]`)
  );
  for (const input of candidateInputs) {
    const form = input.form;
    if (form && form.querySelector(`input[name="${OBJECT_ID_FIELD_NAME}"]`)) {
      return { form, input };
    }
  }
  return null;
}

function submitToteSearch(toteNumber) {
  const located = findToteForm();
  if (!located) return false;

  const { form, input } = located;
  input.value = toteNumber;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const submitter = form.querySelector('button[type="submit"], input[type="submit"]');
  if (submitter) {
    submitter.click();
  } else if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
  } else {
    form.submit();
  }
  return true;
}

function findDatelotLink() {
  const candidates = Array.from(
    document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')
  );
  return (
    candidates.find((el) =>
      (el.textContent || el.value || '').trim().toLowerCase().includes(DATELOT_LINK_TEXT)
    ) ?? null
  );
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// Mirrors shared/normalize.js#normalizeLabel - duplicated here because
// content scripts aren't wired up to import extension ES modules.
// Canonical logic (and its tests) lives in shared/parsers/qtDatelotParser.js.
function normalizeLabel(label) {
  return (label ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
}

function normalizeValue(value) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const LABEL_ALIASES = {
  title: 'title',
  fcsku: 'fcSku',
  quantity: 'quantity',
  owner: 'owner',
  'expiration date': 'expirationDate',
};

function parseDefinitionList(dl) {
  const product = { title: null, fcSku: null, quantity: null, owner: null, expirationDate: null };
  if (!dl) return product;

  let pendingField = null;
  for (const child of Array.from(dl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') {
      pendingField = LABEL_ALIASES[normalizeLabel(child.textContent)] ?? null;
    } else if (tag === 'dd') {
      if (pendingField) {
        const value = normalizeValue(child.textContent);
        product[pendingField] = value.length > 0 ? value : null;
      }
      pendingField = null;
    }
  }
  return product;
}

function parseDatelotFieldset(fieldset) {
  return Array.from(fieldset.querySelectorAll('div.a-box')).map((box) =>
    parseDefinitionList(box.querySelector('dl.a-definition-list'))
  );
}

// --- Cross-navigation state -------------------------------------------
// chrome.storage.session is in-memory only (never written to disk) and
// survives page navigations within the browser session, unlike this
// script's own JS context. Requires background.js to have called
// chrome.storage.session.setAccessLevel(...) once, since content scripts
// cannot read/write session storage by default.

async function getState() {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? null;
}

async function setState(state) {
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
}

async function clearState() {
  await chrome.storage.session.remove(STORAGE_KEY);
}

async function sendFinalResult(requestId, result) {
  log('sending final result', result.status);
  await clearState();
  try {
    await chrome.runtime.sendMessage({ type: 'QT_LOOKUP_RESULT', requestId, result });
  } catch (error) {
    console.error('[tote-lookup] failed to deliver QT result to background:', error?.message ?? error);
  }
}

function isExpired(state) {
  return Date.now() - state.startedAt > OVERALL_TIMEOUT_MS;
}

async function runAfterSearchSubmitted(state) {
  if (isExpired(state)) {
    return sendFinalResult(state.requestId, {
      status: 'error',
      message: 'QT akışı zaman aşımına uğradı (arama sonrası sayfa beklenirken).',
    });
  }

  const datelotLink = await waitFor(findDatelotLink, { timeoutMs: 6000 });
  if (!datelotLink) {
    // Not an error - per spec, this screen only appears when expiration-
    // dated items exist for this tote.
    return sendFinalResult(state.requestId, { status: 'ok', products: [] });
  }

  log('found "View Datelot Items", clicking');
  await setState({ ...state, stage: 'datelot_clicked' });
  datelotLink.click();
  await new Promise((resolve) => setTimeout(resolve, 300));

  // If the click above caused a hard navigation, this script instance's
  // context is already gone by now and nothing after this line runs -
  // the fresh injection on the next page will resume from 'datelot_clicked'.
  // If it was an in-page update instead, continue right here.
  return runAfterDatelotClicked({ ...state, stage: 'datelot_clicked' });
}

async function runAfterDatelotClicked(state) {
  if (isExpired(state)) {
    return sendFinalResult(state.requestId, {
      status: 'error',
      message: 'QT akışı zaman aşımına uğradı (datelot ekranı beklenirken).',
    });
  }

  const fieldset = await waitFor(
    () => document.querySelector('fieldset.a-box-group.a-form-control-group'),
    { timeoutMs: 6000 }
  );
  if (!fieldset) {
    return sendFinalResult(state.requestId, {
      status: 'error',
      message:
        '"View Datelot Items" tıklandı ancak beklenen ' +
        'fieldset.a-box-group.a-form-control-group yapısı bulunamadı.',
    });
  }

  return sendFinalResult(state.requestId, { status: 'ok', products: parseDatelotFieldset(fieldset) });
}

async function handleNewLookupRequest(message, sendResponse) {
  log('received QT_LOOKUP_TOTE');
  const submitted = submitToteSearch(message.toteNumber);
  if (!submitted) {
    sendResponse({
      status: 'error',
      message:
        `Tote arama alanı bulunamadı (name="${TOTE_INPUT_NAME}" olan ve ` +
        `name="${OBJECT_ID_FIELD_NAME}" içeren bir form arandı). QT sayfasının ` +
        'güncel yapısı bu betiğin varsayımlarıyla uyuşmuyor olabilir - lütfen ' +
        'DevTools > Elements ile gerçek alan adlarını kontrol edip bu dosyadaki ' +
        'sabitleri güncelleyin.',
    });
    return;
  }

  const state = {
    requestId: message.requestId,
    toteNumber: message.toteNumber,
    stage: 'search_submitted',
    startedAt: Date.now(),
  };
  await setState(state);
  // Acknowledge receipt immediately - this response is very likely to
  // succeed since any navigation triggered by the click above happens
  // asynchronously, after this task finishes. The *final* result is
  // reported separately via QT_LOOKUP_RESULT, since this response channel
  // may not survive if navigation does start.
  sendResponse({ status: 'accepted' });

  // Continue in case this was an in-page update rather than a hard
  // navigation. If navigation does happen, this call simply never
  // finishes running in this now-dead context - harmless.
  runAfterSearchSubmitted(state);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'QT_LOOKUP_TOTE') return undefined;
  handleNewLookupRequest(message, sendResponse);
  return true;
});

// Runs once per injection (i.e. again on every fresh page load, including
// after the hard navigation triggered by submitToteSearch). Resumes any
// lookup that was left in flight when the previous document was torn down.
(async () => {
  const state = await getState();
  if (!state) return;

  log('resuming lookup after navigation, stage =', state.stage);
  if (state.stage === 'search_submitted') {
    await runAfterSearchSubmitted(state);
  } else if (state.stage === 'datelot_clicked') {
    await runAfterDatelotClicked(state);
  }
})();

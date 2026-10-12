// VERIFIED from spec section 2 (Uygulama 3 - QT): base URL pattern.
const QT_ORIGIN_PATTERN = 'https://qt.eu.aftx.amazonoperations.app/*';

// PARTIALLY VERIFIED: real testing showed the tote search submission
// triggers a full page navigation (not AJAX). The content script's JS
// context does not survive that navigation, so its final result cannot
// be returned as this message's direct response - it arrives later, out
// of band, as a separate QT_LOOKUP_RESULT message correlated by requestId.
const RESULT_TIMEOUT_MS = 25000;

function waitForCorrelatedResult(requestId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve({
        status: 'error',
        message: 'QT akışı zaman aşımına uğradı (sayfa yönlendirmesi veya datelot ekranı beklenirken).',
      });
    }, RESULT_TIMEOUT_MS);

    function listener(message) {
      if (message?.type === 'QT_LOOKUP_RESULT' && message.requestId === requestId) {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message.result);
      }
    }

    chrome.runtime.onMessage.addListener(listener);
  });
}

/**
 * Asks the QT content script (running in an already-open, logged-in QT
 * tab) to search a tote and extract any datelot items it finds.
 *
 * UNVERIFIED end-to-end: this depends on the user having a QT tab open,
 * and on content-scripts/qtContentScript.js's DOM selectors matching the
 * real page (see that file's header comment for exactly which parts are
 * guesses/confirmed). This function only handles tab discovery and
 * messaging - it does not touch QT's DOM or network directly.
 *
 * @param {string} toteNumber
 * @returns {Promise<{ status: 'ok'|'no_qt_tab'|'content_script_unreachable'|'error', products?: Array<object>, message?: string }>}
 */
export async function fetchQtDatelotForTote(toteNumber) {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: QT_ORIGIN_PATTERN });
  } catch (error) {
    return { status: 'error', message: String(error?.message ?? error) };
  }

  if (!tabs || tabs.length === 0) {
    return { status: 'no_qt_tab' };
  }

  const tab = tabs[0];
  const requestId = crypto.randomUUID();

  let ack;
  try {
    ack = await chrome.tabs.sendMessage(tab.id, {
      type: 'QT_LOOKUP_TOTE',
      toteNumber,
      requestId,
    });
  } catch (error) {
    return { status: 'content_script_unreachable', message: String(error?.message ?? error) };
  }

  if (!ack || ack.status !== 'accepted') {
    return ack ?? { status: 'content_script_unreachable' };
  }

  // The content script accepted the request and submitted the search;
  // its eventual result (possibly from a different page load, if the
  // search triggers a full navigation) arrives via this correlated
  // runtime message instead of as this call's direct response.
  return waitForCorrelatedResult(requestId);
}

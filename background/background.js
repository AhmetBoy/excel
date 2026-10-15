import { parsePandashJson, matchPandashResultsToAsins } from '../shared/parsers/pandashParser.js';
import { buildResultRows } from '../shared/matchingService.js';
import { fetchInventoryHtml } from './services/inventoryService.js';
import { fetchPandashRaw } from './services/pandashService.js';
import { fetchQtDatelotForTote } from './services/qtService.js';
import { fetchAtlasReportRaw } from './services/atlasService.js';
import { parseAtlasReport } from '../shared/parsers/atlasReportParser.js';

// Without this, clicking the toolbar icon does nothing because there is
// no action.default_popup - the side panel must be opened explicitly.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[tote-lookup] setPanelBehavior failed:', error));

// chrome.storage.session defaults to TRUSTED_CONTEXTS only (background/
// offscreen), so content scripts can't read/write it unless this is
// called once from a trusted context. qtContentScript.js relies on this
// to persist lookup state across the page navigation that submitting the
// QT tote search triggers.
chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch((error) => console.error('[tote-lookup] storage setAccessLevel failed:', error));

// The service worker has no DOM, so DOMParser (used by inventoryParser.js)
// isn't available here directly. An offscreen document provides a hidden
// page with real DOM access to run that parsing instead.
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Parse Inventory app HTML using DOMParser, which is unavailable inside the service worker.',
    });
  } catch (error) {
    // A concurrent lookup may have created it between hasDocument() and
    // createDocument() - only re-throw if it genuinely isn't there now.
    if (!(await chrome.offscreen.hasDocument())) throw error;
  }
}

async function parseInventoryHtmlViaOffscreen(html) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type: 'PARSE_INVENTORY_HTML', html });
}

async function resolveInventory(toteNumber) {
  const response = await fetchInventoryHtml(toteNumber);
  if (response.status !== 'ok') {
    return { records: [], status: response.status };
  }

  const parsed = await parseInventoryHtmlViaOffscreen(response.html);
  if (!parsed.found) return { records: [], status: 'not_found' };
  if (parsed.records.length === 0) return { records: [], status: 'no_data' };
  return { records: parsed.records, status: 'ok' };
}

async function resolvePandash(asins) {
  if (asins.length === 0) {
    return { matches: [], status: 'skipped_no_asin' };
  }

  const response = await fetchPandashRaw(asins, { batchMode: true });
  if (response.status !== 'ok') {
    return { matches: [], status: response.status };
  }

  const combined = { rows: [], unfound: [] };
  let anyRequestFailed = false;
  for (const result of response.results) {
    if (result.status !== 'ok') {
      anyRequestFailed = true;
      continue;
    }
    const parsed = parsePandashJson(result.text);
    combined.rows.push(...parsed.rows);
    combined.unfound.push(...parsed.unfound);
  }

  return {
    matches: matchPandashResultsToAsins(combined, asins),
    status: anyRequestFailed ? 'partial_failure' : 'ok',
  };
}

async function resolveQt(toteNumber) {
  const response = await fetchQtDatelotForTote(toteNumber);
  if (response.status !== 'ok') {
    return { products: [], status: response.status, message: response.message };
  }
  const products = response.products ?? [];
  return { products, status: products.length > 0 ? 'ok' : 'no_datelot_screen' };
}

/**
 * Orchestrates one tote lookup across all three sources. Each source is
 * resolved independently so a failure in one (e.g. no QT tab open) never
 * discards valid results already obtained from the others.
 *
 * @param {string} toteNumber
 * @returns {Promise<{ toteNumber: string, rows: object[], sourceStatus: object }>}
 */
async function lookupTote(toteNumber) {
  const inventory = await resolveInventory(toteNumber);
  const distinctAsins = [...new Set(inventory.records.map((r) => r.asin).filter(Boolean))];

  const [pandash, qt] = await Promise.all([
    resolvePandash(distinctAsins),
    resolveQt(toteNumber),
  ]);

  const { rows } = buildResultRows({
    inventoryRecords: inventory.records,
    pandashMatches: pandash.matches,
    qtProducts: qt.products,
  });

  return {
    toteNumber,
    rows,
    sourceStatus: {
      inventory: inventory.status,
      pandash: pandash.status,
      qt: qt.status,
    },
  };
}

/**
 * Fetches per-associate stow counts (Atlas "Opportunities") for one time range.
 *
 * @param {{ warehouseId: string, queryHash: string, startTime: number, endTime: number }} params
 * @returns {Promise<{ status: string, rows: object[], message?: string }>}
 */
async function fetchStowReportRange(params) {
  const response = await fetchAtlasReportRaw(params);
  if (response.status !== 'ok') {
    return { status: response.status, rows: [], message: response.message };
  }

  const parsed = parseAtlasReport(response.text, { warehouseId: params.warehouseId });
  if (!parsed.valid) return { status: 'unexpected_response', rows: [] };
  if (parsed.errorMessage) {
    return { status: 'graphql_error', rows: parsed.rows, message: parsed.errorMessage };
  }
  return { status: 'ok', rows: parsed.rows };
}

// Atlas returns one aggregate per request (timeRanges are summed, not
// broken down), so an hourly report needs one request per hour. Capped
// so a long range doesn't fire dozens of requests at once.
const MAX_PARALLEL_ATLAS_REQUESTS = 4;

/**
 * @param {{ warehouseId: string, queryHash: string, timeRanges: Array<{startTime: number, endTime: number}> }} params
 * @returns {Promise<{ status: string, slots: Array<{ status: string, rows: object[] }>, message?: string }>}
 */
async function fetchStowReport({ warehouseId, queryHash, timeRanges }) {
  const slots = new Array(timeRanges.length);
  let next = 0;
  const worker = async () => {
    while (next < timeRanges.length) {
      const index = next++;
      slots[index] = await fetchStowReportRange({ warehouseId, queryHash, ...timeRanges[index] });
    }
  };
  await Promise.all(Array.from({ length: MAX_PARALLEL_ATLAS_REQUESTS }, worker));

  const failed = slots.filter((s) => s.status !== 'ok');
  if (failed.length === 0) {
    const anyRows = slots.some((s) => s.rows.length > 0);
    return { status: anyRows ? 'ok' : 'no_data', slots };
  }
  return {
    status: failed.length === slots.length ? failed[0].status : 'partial_failure',
    message: failed[0].message,
    slots,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FETCH_STOW_REPORT') return undefined;

  fetchStowReport(message.params)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ status: 'error', slots: [], message: String(error?.message ?? error) })
    );

  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'LOOKUP_TOTE') return undefined;

  lookupTote(message.toteNumber)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        toteNumber: message.toteNumber,
        rows: [],
        sourceStatus: { inventory: 'error', pandash: 'error', qt: 'error' },
        error: String(error?.message ?? error),
      })
    );

  return true; // keep the message channel open for the async response
});

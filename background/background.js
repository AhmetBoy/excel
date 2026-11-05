import { parsePandashJson, matchPandashResultsToAsins } from '../shared/parsers/pandashParser.js';
import { buildResultRows } from '../shared/matchingService.js';
import { fetchInventoryHtml } from './services/inventoryService.js';
import { fetchPandashRaw } from './services/pandashService.js';
import { fetchQtDatelotForTote } from './services/qtService.js';
import { fetchAtlasReportRaw } from './services/atlasService.js';
import { parseAtlasReport } from '../shared/parsers/atlasReportParser.js';
import { fetchFcResearchSection, fetchFcResearchSectionMore } from './services/fcResearchService.js';
import { fetchSidelineItem } from './services/sidelineService.js';
import { parseSidelineResponse } from '../shared/parsers/sidelineParser.js';
import { hasMorePages } from '../shared/parsers/containerHierarchyParser.js';
import { analyzeStowErrors, buildHistoryDateFields } from '../shared/stowErrors.js';
import { LOCATION_HISTORY_DAYS } from '../shared/locationStows.js';

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

async function parseViaOffscreen(type, html) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ type, html });
}

function parseInventoryHtmlViaOffscreen(html) {
  return parseViaOffscreen('PARSE_INVENTORY_HTML', html);
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight, keeping
 * results in input order.
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

const MAX_PARALLEL_SIDELINE_REQUESTS = 4;

/**
 * Sideline binDescription per ASIN. Sideline takes one item per request,
 * so this sends one request per distinct ASIN of the tote.
 *
 * @returns {Promise<{ matches: Array<{asin: string, binDescription: string|null, status: string}>, status: string }>}
 */
async function resolveSideline(toteNumber, asins) {
  if (asins.length === 0) return { matches: [], status: 'skipped_no_asin' };

  const matches = await mapWithConcurrency(asins, MAX_PARALLEL_SIDELINE_REQUESTS, async (asin) => {
    const response = await fetchSidelineItem(toteNumber, asin);
    if (response.status !== 'ok') return { asin, binDescription: null, status: response.status };
    const parsed = parseSidelineResponse(response.text, asin);
    if (!parsed.valid) return { asin, binDescription: null, status: 'unexpected_response' };
    return { asin, binDescription: parsed.binDescription, status: parsed.found ? 'ok' : 'not_found' };
  });

  const failed = matches.filter((m) => m.status !== 'ok' && m.status !== 'not_found');
  let status = 'ok';
  if (failed.length === matches.length) status = failed[0].status;
  else if (failed.length > 0) status = 'partial_failure';
  else if (matches.every((m) => !m.binDescription)) status = 'no_data';
  return { matches, status };
}

async function resolveQt(toteNumber) {
  const response = await fetchQtDatelotForTote(toteNumber);
  if (response.status !== 'ok') {
    return { products: [], status: response.status, message: response.message };
  }
  const products = response.products ?? [];
  return { products, status: products.length > 0 ? 'ok' : 'no_datelot_screen' };
}

const MAX_PARALLEL_PRODUCT_REQUESTS = 4;

/**
 * FC Research "product" section per ASIN: High Value flag + image.
 * @returns {Promise<{ matches: Array<{asin: string, highValue: boolean|null, imageUrl: string|null, status: string}>, status: string }>}
 */
async function resolveProducts(asins) {
  if (asins.length === 0) return { matches: [], status: 'skipped_no_asin' };

  const matches = await mapWithConcurrency(asins, MAX_PARALLEL_PRODUCT_REQUESTS, async (asin) => {
    const response = await fetchFcResearchSection('product', { s: asin });
    if (response.status !== 'ok') return { asin, highValue: null, imageUrl: null, status: response.status };
    const parsed = await parseViaOffscreen('PARSE_PRODUCT_HTML', response.html);
    if (!parsed.found) return { asin, highValue: null, imageUrl: null, status: 'not_found' };
    return { asin, highValue: parsed.highValue, imageUrl: parsed.imageUrl, status: 'ok' };
  });

  const failed = matches.filter((m) => m.status !== 'ok');
  let status = 'ok';
  if (failed.length === matches.length) status = failed[0].status;
  else if (failed.length > 0) status = 'partial_failure';
  else if (matches.every((m) => m.highValue === null)) status = 'no_data';
  return { matches, status };
}

/** Inventory History of a bin, for "who stowed this product here". */
async function resolveLocationHistory(location) {
  const result = await fetchPagedSection(
    'inventory-history',
    { s: location, ...buildHistoryDateFields(new Date(), LOCATION_HISTORY_DAYS) },
    'PARSE_INVENTORY_HISTORY_HTML',
    'records'
  );
  return { status: result.status, records: result.items };
}

// Which extra sources run for each kind of scan (see shared/lookupInput.js).
// Sideline and QT work on a tote, so a bin or product search skips them.
const SOURCE_PLAN = {
  container: { sideline: true, qt: true, history: false },
  location: { sideline: false, qt: false, history: true },
  product: { sideline: false, qt: false, history: false },
};

const skipped = (extra) => Promise.resolve({ status: 'skipped', ...extra });

/**
 * Orchestrates one lookup (tote, bin or product barcode) across the
 * sources in SOURCE_PLAN. Each source is resolved independently so a
 * failure in one (e.g. no QT tab open) never discards valid results
 * already obtained from the others.
 *
 * @param {string} toteNumber - the scanned value
 * @param {string} [kind] - 'container' | 'location' | 'product'
 * @returns {Promise<{ toteNumber: string, kind: string, rows: object[], sourceStatus: object, locationHistory?: object[] }>}
 */
async function lookupTote(toteNumber, kind = 'container') {
  const plan = SOURCE_PLAN[kind] ?? SOURCE_PLAN.container;
  const inventory = await resolveInventory(toteNumber);
  const distinctAsins = [...new Set(inventory.records.map((r) => r.asin).filter(Boolean))];

  const [pandash, product, sideline, qt, history] = await Promise.all([
    resolvePandash(distinctAsins),
    resolveProducts(distinctAsins),
    plan.sideline ? resolveSideline(toteNumber, distinctAsins) : skipped({ matches: [] }),
    plan.qt ? resolveQt(toteNumber) : skipped({ products: [] }),
    plan.history ? resolveLocationHistory(toteNumber) : skipped({ records: [] }),
  ]);

  const { rows } = buildResultRows({
    inventoryRecords: inventory.records,
    pandashMatches: pandash.matches,
    sidelineMatches: sideline.matches,
    productMatches: product.matches,
    qtProducts: qt.products,
  });

  const sourceStatus = {
    inventory: inventory.status,
    pandash: pandash.status,
    product: product.status,
  };
  if (plan.sideline) sourceStatus.sideline = sideline.status;
  if (plan.qt) sourceStatus.qt = qt.status;
  if (plan.history) sourceStatus.history = history.status;

  return { toteNumber, kind, rows, sourceStatus, locationHistory: history.records };
}

// Safety cap on "-more" pages of one FC Research section.
const MAX_SECTION_PAGES = 20;
const MAX_PARALLEL_CONTAINER_LOOKUPS = 4;

/**
 * Fetches an FC Research section and follows its pagination tokens.
 * `parseType` is the offscreen parser message; `listKey` the array to collect.
 *
 * @returns {Promise<{ status: string, first?: object, items: object[] }>}
 */
async function fetchPagedSection(section, fields, parseType, listKey) {
  const response = await fetchFcResearchSection(section, fields);
  if (response.status !== 'ok') return { status: response.status, items: [] };

  const first = await parseViaOffscreen(parseType, response.html);
  if (!first.found) return { status: 'not_found', items: [] };

  const items = [...first[listKey]];
  let token = first.paginationToken;
  let partial = false;
  for (let page = 0; hasMorePages(token) && page < MAX_SECTION_PAGES; page++) {
    const more = await fetchFcResearchSectionMore(section, token);
    if (more.status !== 'ok') {
      partial = true;
      break;
    }
    const parsed = await parseViaOffscreen(parseType, more.html);
    items.push(...parsed[listKey]);
    token = parsed.paginationToken;
  }

  const status = partial ? 'partial_failure' : items.length > 0 ? 'ok' : 'no_data';
  return { status, first, items };
}

/** Child Containers of `query` (for pc99<login>: the totes/csX on the associate). */
async function resolveContainerHierarchy(query) {
  const result = await fetchPagedSection(
    'container-hierarchy',
    { s: query },
    'PARSE_CONTAINER_HIERARCHY_HTML',
    'children'
  );
  return { status: result.status, path: result.first?.path ?? [], children: result.items };
}

/** Recent Inventory History of one container (see HISTORY_DAYS). */
async function resolveInventoryHistory(scannableId) {
  const result = await fetchPagedSection(
    'inventory-history',
    { s: scannableId, ...buildHistoryDateFields() },
    'PARSE_INVENTORY_HISTORY_HTML',
    'records'
  );
  return { status: result.status, records: result.items };
}

/**
 * Associate lookup: finds the totes/csX on pc99<login> (Child Containers)
 * and fetches each one's Inventory and recent Inventory History.
 *
 * @param {{ login: string, query: string }} params
 */
async function lookupUser({ login, query }) {
  const hierarchy = await resolveContainerHierarchy(query);
  const containers = await mapWithConcurrency(
    hierarchy.children,
    MAX_PARALLEL_CONTAINER_LOOKUPS,
    async (child) => {
      const [inventory, history] = await Promise.all([
        resolveInventory(child.scannableId),
        resolveInventoryHistory(child.scannableId),
      ]);
      return { ...child, inventory, history };
    }
  );

  // For every bin with a failed stow, read the bin's current Inventory so
  // the panel can show how many units the system expects there.
  const errorBins = [
    ...new Set(
      containers.flatMap((c) =>
        analyzeStowErrors(c.history.records, { container: c.scannableId, person: login }).groups.map(
          (g) => g.bin
        )
      )
    ),
  ];
  const binResults = await mapWithConcurrency(errorBins, MAX_PARALLEL_CONTAINER_LOOKUPS, (bin) =>
    resolveInventory(bin)
  );
  const binInventory = Object.fromEntries(errorBins.map((bin, i) => [bin, binResults[i]]));

  return { login, query, status: hierarchy.status, path: hierarchy.path, containers, binInventory };
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
  const slots = await mapWithConcurrency(timeRanges, MAX_PARALLEL_ATLAS_REQUESTS, (range) =>
    fetchStowReportRange({ warehouseId, queryHash, ...range })
  );

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
  if (message?.type !== 'LOOKUP_USER') return undefined;

  lookupUser(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        login: message.login,
        query: message.query,
        status: 'error',
        path: [],
        containers: [],
        message: String(error?.message ?? error),
      })
    );

  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'LOOKUP_TOTE') return undefined;

  lookupTote(message.toteNumber, message.kind)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        toteNumber: message.toteNumber,
        rows: [],
        sourceStatus: { inventory: 'error' },
        error: String(error?.message ?? error),
      })
    );

  return true; // keep the message channel open for the async response
});

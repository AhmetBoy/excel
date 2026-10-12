import { classifyResponseStatus, withErrorHandling } from './errorHandler.js';

// VERIFIED from spec section 2 (Uygulama 2 - Pandash): URL and the field
// set/content-type seen in one sample request. Field names beyond
// `asins` are included because they were present in that sample, but the
// spec explicitly warns none of them should be assumed mandatory - if a
// field turns out to be unnecessary or wrong, remove/adjust it here after
// checking a real session's Network tab.
const PANDASH_URL = 'https://pandash.eu.aftx.amazonoperations.app/GridServlet';

function buildRequestBody(asinsValue) {
  return new URLSearchParams({
    language: 'default',
    source: 'retail-rbs',
    marketPlaces: 'TR',
    asins: asinsValue,
    sidx: 'product.asin',
    rows: '99999',
    page: '1',
    sord: 'desc',
    isExportOnly: 'FALSE',
    fileName: `tote-lookup-${crypto.randomUUID()}`,
    fc: '',
    pandashservice: '',
  }).toString();
}

async function postToPandash(asinsValue) {
  const response = await fetch(PANDASH_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: buildRequestBody(asinsValue),
  });

  const status = classifyResponseStatus(response);
  if (status !== 'ok') {
    return { status, httpStatus: response.status };
  }

  const text = await response.text();
  return { status: 'ok', text };
}

/**
 * Fetches Pandash dropZone data for a list of ASINs.
 *
 * VERIFIED: real-session testing confirmed `asins` accepts a comma-joined
 * batch of multiple ASINs and returns rows for all of them, not just the
 * first - so `batchMode` defaults to true, sending one request per tote
 * instead of one per ASIN. `batchMode: false` is kept available as a
 * fallback in case a future tote/session behaves differently.
 *
 * @param {string[]} asins
 * @param {{ batchMode?: boolean }} [options]
 * @returns {Promise<{ status: string, results?: Array<{asin: string, text?: string, status: string}> }>}
 */
export function fetchPandashRaw(asins, { batchMode = true } = {}) {
  return withErrorHandling('pandash', async () => {
    if (asins.length === 0) {
      return { status: 'ok', results: [] };
    }

    if (batchMode) {
      const result = await postToPandash(asins.join(','));
      return { status: 'ok', results: [{ asin: asins.join(','), ...result }] };
    }

    const results = await Promise.all(
      asins.map(async (asin) => ({ asin, ...(await postToPandash(asin)) }))
    );
    return { status: 'ok', results };
  });
}

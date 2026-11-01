import { classifyResponseStatus, withErrorHandling } from './errorHandler.js';

// Verified from a live Sideline (AFT Poirot) session: the item scan screen
// POSTs this JSON body; the response carries items[].binDescription.
const SCAN_ITEM_URL = 'https://aft-poirot-website.eu.aftx.amazonoperations.app/api/scanitem';

/**
 * Asks Sideline about one item in a container (the same request its item
 * scan screen sends).
 *
 * @param {string} containerScannableId - tote, e.g. "tsXSA903245"
 * @param {string} itemBarcode - ASIN / FNSku
 * @returns {Promise<{ status: string, text?: string, httpStatus?: number }>}
 */
export function fetchSidelineItem(containerScannableId, itemBarcode) {
  return withErrorHandling('sideline', async () => {
    const response = await fetch(SCAN_ITEM_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        containerScannableId,
        itemBarcode,
        isMasterpack: null,
        itemAndonContext: null,
        requestId: `amzn1.fc.v1.common.request-id.v1.AFTPoirotWebsite.${crypto.randomUUID()}`,
        tool: 'V3',
      }),
    });

    const status = classifyResponseStatus(response);
    if (status !== 'ok') return { status, httpStatus: response.status };
    return { status: 'ok', text: await response.text() };
  });
}

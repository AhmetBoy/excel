import { classifyResponseStatus, withErrorHandling } from './errorHandler.js';

// VERIFIED from spec section 2 (Uygulama 1 - Inventory): method, URL, and
// the single form field `s`. NOT yet verified against a live session.
const INVENTORY_URL =
  'https://qifcr.eu.aftx.amazonoperations.app/XSA9/results/inventory';

/**
 * Fetches the raw Inventory HTML for a tote/container number.
 *
 * ASSUMPTION (unverified): relies on the browser's existing session
 * cookies for qifcr.eu.aftx.amazonoperations.app being sent automatically
 * via `credentials: 'include'`, and on `host_permissions` in manifest.json
 * exempting this request from page-level CORS. Must be confirmed against
 * a real authenticated session before relying on this in production use.
 *
 * @param {string} toteNumber
 * @returns {Promise<{ status: 'ok'|'auth_required'|'request_failed'|'network_error', html?: string, httpStatus?: number, message?: string }>}
 */
export function fetchInventoryHtml(toteNumber) {
  return withErrorHandling('inventory', async () => {
    const response = await fetch(INVENTORY_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ s: toteNumber }).toString(),
    });

    const status = classifyResponseStatus(response);
    if (status !== 'ok') {
      return { status, httpStatus: response.status };
    }

    const html = await response.text();
    return { status: 'ok', html };
  });
}

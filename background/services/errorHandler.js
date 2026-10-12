/**
 * Classifies a fetch Response into one of a small set of statuses so every
 * source reports failures the same way. 401/403 are treated as auth
 * required; many internal SSO setups instead redirect to a login page
 * with a 200 status, which this cannot detect reliably from headers alone
 * - callers should also sanity-check the body (e.g. "was this HTML
 * actually the expected table/JSON, or something else entirely").
 *
 * @param {Response} response
 * @returns {'ok'|'auth_required'|'request_failed'}
 */
export function classifyResponseStatus(response) {
  if (response.status === 401 || response.status === 403) {
    return 'auth_required';
  }
  if (!response.ok) {
    return 'request_failed';
  }
  return 'ok';
}

/**
 * Runs a source-fetching function and normalizes any thrown error (network
 * failure, timeout, CORS rejection, etc.) into the same { status, ... }
 * shape the rest of the app expects, instead of letting one source's
 * exception break the whole lookup. Never logs the tote number, ASIN, or
 * any response body - only the error message/type.
 *
 * @param {string} sourceName - for logging context only, e.g. 'inventory'
 * @param {() => Promise<object>} fn - must resolve to an object with a `status` field
 * @returns {Promise<object>}
 */
export async function withErrorHandling(sourceName, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[tote-lookup] ${sourceName} request failed:`, error?.message ?? error);
    return { status: 'network_error', message: String(error?.message ?? error) };
  }
}

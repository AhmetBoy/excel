import { classifyResponseStatus, withErrorHandling } from './errorHandler.js';

const PREP_VIEW_BASE = 'https://prepmanager.eu.aftx.amazonoperations.app/view';

/**
 * Loads the Prep Instructions Manager page of one product.
 *
 * @param {string} asin - B ASIN, e.g. "B09J55RKT1"
 * @returns {Promise<{ status: string, html?: string, httpStatus?: number }>}
 */
export function fetchPrepView(asin) {
  return withErrorHandling('prep', async () => {
    const response = await fetch(`${PREP_VIEW_BASE}/${encodeURIComponent(asin)}?region=EU`, {
      credentials: 'include',
    });

    const status = classifyResponseStatus(response);
    if (status !== 'ok') return { status, httpStatus: response.status };
    return { status: 'ok', html: await response.text() };
  });
}

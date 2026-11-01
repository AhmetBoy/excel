import { classifyResponseStatus, withErrorHandling } from './errorHandler.js';

// Verified from the live FC Research page: each results section is loaded
// with POST <base>/<section> (body s=<query>, plus optional date fields),
// and further pages with POST <base>/<section>-more (body token=...).
const RESULTS_BASE = 'https://qifcr.eu.aftx.amazonoperations.app/XSA9/results';

function postForm(section, url, fields) {
  return withErrorHandling(section, async () => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams(fields).toString(),
    });

    const status = classifyResponseStatus(response);
    if (status !== 'ok') return { status, httpStatus: response.status };
    return { status: 'ok', html: await response.text() };
  });
}

/**
 * @param {'container-hierarchy'|'inventory-history'} section
 * @param {Record<string, string>} fields - e.g. { s: 'pc99login' }
 */
export function fetchFcResearchSection(section, fields) {
  return postForm(section, `${RESULTS_BASE}/${section}`, fields);
}

/** @param {string} token - pagination token from the previous page */
export function fetchFcResearchSectionMore(section, token) {
  return postForm(section, `${RESULTS_BASE}/${section}-more`, { token });
}

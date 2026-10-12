import { normalizeValue } from '../normalize.js';

/**
 * Parses the raw Pandash GridServlet response into a tolerant shape.
 * Accepts either a JSON string or an already-parsed object. Missing
 * `rows`/`unfound` keys are treated as empty arrays rather than assumed
 * to always be present, since the spec only confirms the shape seen in
 * one sample response.
 *
 * @param {string|object} raw
 * @returns {{ rows: Array<{asin: string, dropZone: string|null}>, unfound: string[] }}
 */
export function parsePandashJson(raw) {
  let data;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { rows: [], unfound: [] };
    }
  } else {
    data = raw ?? {};
  }

  const rawRows = Array.isArray(data.rows) ? data.rows : [];
  const rows = rawRows
    .map((row) => ({
      asin: normalizeValue(row?.asin ?? ''),
      dropZone: row?.dropZone != null ? normalizeValue(row.dropZone) : null,
    }))
    .filter((row) => row.asin.length > 0);

  const unfound = (Array.isArray(data.unfound) ? data.unfound : [])
    .map((asin) => normalizeValue(asin ?? ''))
    .filter((asin) => asin.length > 0);

  return { rows, unfound };
}

/**
 * Matches each requested ASIN against a parsed Pandash response.
 *
 * Status meanings:
 * - 'found': exactly one row matched this ASIN.
 * - 'multiple_matches': more than one row matched; dropZone is ambiguous,
 *   all candidate values are returned for the caller to surface explicitly
 *   rather than silently picking one.
 * - 'unfound': the response's own `unfound` list named this ASIN.
 * - 'not_in_response': the ASIN was requested but is absent from both
 *   `rows` and `unfound` (the app simply didn't return anything for it).
 *
 * @param {{ rows: Array<{asin: string, dropZone: string|null}>, unfound: string[] }} parsed
 * @param {string[]} requestedAsins
 * @returns {Array<{ asin: string, dropZone: string|null, status: string, matches: Array<{asin: string, dropZone: string|null}> }>}
 */
export function matchPandashResultsToAsins(parsed, requestedAsins) {
  const unfoundSet = new Set(parsed.unfound.map((a) => a.toUpperCase()));

  return requestedAsins.map((requestedAsin) => {
    const asin = normalizeValue(requestedAsin);
    const matches = parsed.rows.filter(
      (row) => row.asin.toUpperCase() === asin.toUpperCase()
    );

    if (matches.length === 1) {
      return { asin, dropZone: matches[0].dropZone, status: 'found', matches };
    }
    if (matches.length > 1) {
      return { asin, dropZone: null, status: 'multiple_matches', matches };
    }
    if (unfoundSet.has(asin.toUpperCase())) {
      return { asin, dropZone: null, status: 'unfound', matches: [] };
    }
    return { asin, dropZone: null, status: 'not_in_response', matches: [] };
  });
}

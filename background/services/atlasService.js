import { classifyResponseStatus, withErrorHandling } from './errorHandler.js';

// VERIFIED from a real session's Network tab: the Atlas reporting page
// sends a POST with an Apollo persisted query (no query text, only its
// sha256 hash) plus variables { warehouseId, department, timeRanges }.
const ATLAS_GRAPHQL_URL = 'https://atlas.na.aftx.amazonoperations.app/graphql';

const DEPARTMENT = 'inbound';

/**
 * Fetches the raw Atlas reporting response for one warehouse and time range.
 *
 * `queryHash` is the persisted query's sha256 - it identifies the
 * getReportingByWarehouseId query text, is the same for every user, and is
 * not a credential. It only changes when Atlas ships a new version of that
 * query, so it's user-configurable in the Rapor tab rather than hardcoded.
 *
 * @param {{ warehouseId: string, startTime: number, endTime: number, queryHash: string }} params - times in Unix seconds
 * @returns {Promise<{ status: string, text?: string, httpStatus?: number }>}
 */
export function fetchAtlasReportRaw({ warehouseId, startTime, endTime, queryHash }) {
  return withErrorHandling('atlas', async () => {
    if (!queryHash) {
      return { status: 'config_missing' };
    }

    const response = await fetch(ATLAS_GRAPHQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          warehouseId,
          department: DEPARTMENT,
          timeRanges: [{ startTime, endTime }],
        },
        extensions: {
          persistedQuery: { version: 1, sha256Hash: queryHash },
        },
      }),
    });

    const status = classifyResponseStatus(response);
    if (status !== 'ok') {
      return { status, httpStatus: response.status };
    }

    return { status: 'ok', text: await response.text() };
  });
}

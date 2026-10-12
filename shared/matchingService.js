function normalizeForCompare(str) {
  return (str ?? '').trim().toLowerCase();
}

function findPandashMatch(pandashMatches, asin) {
  if (!asin) return null;
  return (
    pandashMatches.find((m) => m.asin.toUpperCase() === asin.toUpperCase()) ??
    null
  );
}

function findQtCandidatesByFcSku(qtProducts, fcSku) {
  if (!fcSku) return [];
  return qtProducts.filter(
    (p) => p.fcSku && p.fcSku.toUpperCase() === fcSku.toUpperCase()
  );
}

/**
 * Title+quantity are "supporting" fields, not primary identifiers (ASIN,
 * FNSku, FCSku must never be used interchangeably - see spec section 3).
 * This only narrows an already FCSku-matched candidate set; it never
 * creates a match on its own. If narrowing doesn't actually reduce the
 * set, the original (still ambiguous) set is returned unresolved.
 */
function disambiguateByTitleAndQuantity(candidates, inventoryRecord) {
  if (candidates.length <= 1) return candidates;

  const narrowed = candidates.filter(
    (p) =>
      p.title &&
      inventoryRecord.title &&
      normalizeForCompare(p.title) === normalizeForCompare(inventoryRecord.title) &&
      p.quantity === inventoryRecord.quantity
  );

  return narrowed.length > 0 && narrowed.length < candidates.length
    ? narrowed
    : candidates;
}

/**
 * Merges Inventory, Pandash, and QT datelot data into unified result rows.
 *
 * Matching rules (spec section 3):
 * - Inventory <-> Pandash: by ASIN only.
 * - Inventory <-> QT: by FCSku only (title/quantity may disambiguate
 *   multiple FCSku matches, but never substitute for the identifier).
 * - If a QT product cannot be tied to exactly one inventory record, it is
 *   never silently merged - it is surfaced as its own unmatched row.
 *
 * @param {object} input
 * @param {Array<object>} input.inventoryRecords - from parseInventoryHtml().records
 * @param {Array<object>} input.pandashMatches - from matchPandashResultsToAsins()
 * @param {Array<object>} input.qtProducts - from parseQtDatelotHtml().products
 * @returns {{ rows: Array<object>, matchedQtCount: number, totalQtCount: number }}
 */
export function buildResultRows({
  inventoryRecords = [],
  pandashMatches = [],
  qtProducts = [],
}) {
  const usedQtProducts = new Set();

  const inventoryRows = inventoryRecords.map((inv) => {
    const pandash = findPandashMatch(pandashMatches, inv.asin);

    let qtMatchStatus = 'no_fcsku';
    let qtProduct = null;

    if (inv.fcSku) {
      let candidates = findQtCandidatesByFcSku(qtProducts, inv.fcSku);
      if (candidates.length > 1) {
        candidates = disambiguateByTitleAndQuantity(candidates, inv);
      }

      if (candidates.length === 1) {
        qtProduct = candidates[0];
        qtMatchStatus = 'matched';
        usedQtProducts.add(qtProduct);
      } else if (candidates.length > 1) {
        qtMatchStatus = 'ambiguous';
      } else {
        qtMatchStatus = 'no_qt_data';
      }
    }

    return {
      container: inv.container,
      asin: inv.asin,
      fnSku: inv.fnSku,
      lpn: inv.lpn,
      fcSku: inv.fcSku,
      title: inv.title,
      quantity: inv.quantity,
      disposition: inv.disposition,
      consumer: inv.consumer,
      dropZone: pandash?.dropZone ?? null,
      pandashStatus: pandash?.status ?? 'not_requested',
      owner: qtProduct?.owner ?? null,
      expirationDate: qtProduct?.expirationDate ?? null,
      qtMatchStatus,
    };
  });

  const unmatchedQtRows = qtProducts
    .filter((p) => !usedQtProducts.has(p))
    .map((p) => ({
      container: null,
      asin: null,
      fnSku: null,
      lpn: null,
      fcSku: p.fcSku,
      title: p.title,
      quantity: p.quantity,
      disposition: null,
      consumer: null,
      dropZone: null,
      pandashStatus: 'not_requested',
      owner: p.owner,
      expirationDate: p.expirationDate,
      qtMatchStatus: 'qt_only_unmatched',
    }));

  return {
    rows: [...inventoryRows, ...unmatchedQtRows],
    matchedQtCount: usedQtProducts.size,
    totalQtCount: qtProducts.length,
  };
}

function upper(value) {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Reads binDescription (e.g. "Cekmece Yavas Grocery") from a Sideline
 * /api/scanitem response. Picks the item matching `barcode` by scannableId,
 * ASIN or FNSku, falling back to the only item when there is one.
 *
 * @param {string} text - raw response body
 * @param {string} barcode - the itemBarcode that was sent
 * @returns {{ valid: boolean, found: boolean, binDescription: string|null }}
 */
export function parseSidelineResponse(text, barcode) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { valid: false, found: false, binDescription: null };
  }
  if (!json || typeof json !== 'object') return { valid: false, found: false, binDescription: null };

  const items = Array.isArray(json.items) ? json.items : [];
  const wanted = upper(barcode);
  const item =
    items.find((candidate) =>
      [candidate?.scannableId, candidate?.skuDetail?.asin, candidate?.skuDetail?.fnSku]
        .map(upper)
        .includes(wanted)
    ) ?? (items.length === 1 ? items[0] : null);

  const binDescription = typeof item?.binDescription === 'string' ? item.binDescription.trim() : '';
  return { valid: true, found: Boolean(item), binDescription: binDescription || null };
}

// MV3 service workers have no DOM, so DOMParser isn't available there.
// This hidden offscreen document exists purely to give the background
// script somewhere with real DOM access to run the HTML parsers.
import { parseInventoryHtml } from '../shared/parsers/inventoryParser.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PARSE_INVENTORY_HTML') return undefined;

  try {
    sendResponse(parseInventoryHtml(message.html));
  } catch (error) {
    sendResponse({ found: false, records: [], unmappedHeaders: [], error: String(error?.message ?? error) });
  }
  return false;
});

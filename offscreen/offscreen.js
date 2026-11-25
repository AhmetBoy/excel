// MV3 service workers have no DOM, so DOMParser isn't available there.
// This hidden offscreen document exists purely to give the background
// script somewhere with real DOM access to run the HTML parsers.
import { parseInventoryHtml } from '../shared/parsers/inventoryParser.js';
import { parseContainerHierarchyHtml } from '../shared/parsers/containerHierarchyParser.js';
import { parseInventoryHistoryHtml } from '../shared/parsers/inventoryHistoryParser.js';
import { parseProductHtml } from '../shared/parsers/productParser.js';
import { parsePrepHtml } from '../shared/parsers/prepParser.js';
import { parseQtPage } from '../shared/parsers/qtDatelotParser.js';

const PARSERS = {
  PARSE_INVENTORY_HTML: {
    parse: parseInventoryHtml,
    empty: { found: false, records: [], unmappedHeaders: [] },
  },
  PARSE_CONTAINER_HIERARCHY_HTML: {
    parse: parseContainerHierarchyHtml,
    empty: { found: false, path: [], children: [], paginationToken: null },
  },
  PARSE_INVENTORY_HISTORY_HTML: {
    parse: parseInventoryHistoryHtml,
    empty: { found: false, records: [], paginationToken: null },
  },
  PARSE_PRODUCT_HTML: {
    parse: parseProductHtml,
    empty: { found: false, highValue: null, imageUrl: null, title: null, expirationDate: null },
  },
  PARSE_PREP_HTML: {
    parse: parsePrepHtml,
    empty: { found: false, instructions: [] },
  },
  PARSE_QT_PAGE: {
    parse: parseQtPage,
    empty: { found: false, objectId: null, screen: null, hasTextInput: false, noDatelotItems: false, actions: [], pageActions: [], options: [], text: '', products: [], messages: [] },
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parser = PARSERS[message?.type];
  if (!parser) return undefined;

  try {
    sendResponse(parser.parse(message.html));
  } catch (error) {
    sendResponse({ ...parser.empty, error: String(error?.message ?? error) });
  }
  return false;
});

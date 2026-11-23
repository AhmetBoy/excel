// Inventory History "Tool" column of a stow (successful or failed): the
// associate's stow app. Seen in every saved history: stows are always
// M + FCStowAppWebsite into a bin; other moves into bins or totes come from
// other tools (MoveItemsApp, FCReceiveWebUIWebsi, …) and are not stows.
export const STOW_TOOL = 'FCStowAppWebsite';

/**
 * True when the row was written by the stow app. A row without a Tool
 * value (column missing) is not ruled out, so older captures still work.
 * @param {{ tool?: string|null }} record
 */
export function isStowTool(record) {
  const tool = (record?.tool ?? '').trim();
  return tool === '' || tool.toLowerCase() === STOW_TOOL.toLowerCase();
}

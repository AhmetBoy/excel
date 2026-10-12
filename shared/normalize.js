/**
 * Normalizes a label for comparison: trims whitespace, strips a trailing
 * colon, collapses internal whitespace, and lowercases.
 * Used to match things like "Owner:" vs "owner" vs " Owner : ".
 * @param {string} label
 * @returns {string}
 */
export function normalizeLabel(label) {
  if (label == null) return '';
  return label
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
}

/**
 * Normalizes a value for display/comparison: trims and collapses whitespace.
 * Does not alter case or content, so original formatting (e.g. dates) survives.
 * @param {string} value
 * @returns {string}
 */
export function normalizeValue(value) {
  if (value == null) return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Returns true if a normalized value is empty, so callers can treat it as
 * "missing" rather than inventing a placeholder for it.
 * @param {string} value
 * @returns {boolean}
 */
export function isBlank(value) {
  return normalizeValue(value).length === 0;
}

export const MISSING_VALUE = '—';

/**
 * Renders a value for display, falling back to the consistent MISSING_VALUE
 * marker when blank, but never fabricating a guessed value.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function displayOrMissing(value) {
  return isBlank(value ?? '') ? MISSING_VALUE : normalizeValue(value);
}

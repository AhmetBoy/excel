// FC Research names an associate's personal container "pc99<login>".
export const PERSONAL_CONTAINER_PREFIX = 'pc99';

/**
 * Decides whether the search box holds a container or an associate login.
 *
 * Logins are letters only (e.g. "stowerb"), while every container id
 * (tsX…, csX…, paX…, numeric barcodes) contains at least one digit, so
 * "letters only" is read as a login. A full "pc99<login>" is accepted too.
 *
 * @param {string} raw
 * @returns {{ kind: 'user', login: string, query: string } | { kind: 'container', query: string } | null}
 */
export function classifyLookupInput(raw) {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const match = /^(?:pc99)?([a-z]+)$/i.exec(value);
  if (match) {
    const login = match[1].toLowerCase();
    return { kind: 'user', login, query: `${PERSONAL_CONTAINER_PREFIX}${login}` };
  }
  return { kind: 'container', query: value };
}

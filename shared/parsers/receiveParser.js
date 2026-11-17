// Pure helpers for the Receive Web UI (receive.eu.aftx.amazonoperations.app).
// The app is server-rendered: each step is a form POST answered with a 302,
// so the page we land on (response.url after redirects) tells us where the
// session stands. Verified from a live capture 2026-11-17:
//   POST /workstation  scannableId=ws-rcv-02-04   -> /workstation/recover -> /process-path
//   POST /process-path processPath=RECEIVE_EACH   -> /takt/each
//   POST /takt/each    taktType=<uuid>            -> /receive/each
//   POST /validate/container id=<tote>            -> 200, empty body
//   POST /container/open id, destinationType=PRIME, requiredContainerType= -> 200 JSON
// Errors come back as a non-200 status whose body is a JSON-encoded message.

/** @typedef {'process-path'|'takt'|'receive'|'recover'|'other'} ReceivePage */

/**
 * @param {string} url - final URL of a response
 * @returns {ReceivePage}
 */
export function classifyReceivePage(url) {
  let path;
  try {
    path = new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return 'other';
  }
  if (path === '/process-path') return 'process-path';
  if (path === '/takt/each') return 'takt';
  if (path === '/receive/each') return 'receive';
  if (path === '/workstation/recover') return 'recover';
  return 'other';
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attribute(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[2] ?? match[3] ?? '') : null;
}

/**
 * Finds the taktType value of the button whose label is `taktName`
 * (e.g. "RECEIVE_STDWORK1") on the /takt/each page.
 *
 * @param {string} html
 * @param {string} taktName
 * @returns {string|null}
 */
export function findTaktTypeId(html, taktName) {
  const wanted = taktName.trim().toUpperCase();
  const buttons = (html ?? '').matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi);
  for (const [, attrs, inner] of buttons) {
    if (attribute(attrs, 'name') !== 'taktType') continue;
    if (textOf(inner).toUpperCase() !== wanted) continue;
    return attribute(attrs, 'value');
  }
  return null;
}

/**
 * Labels of all takt buttons on the page, for an error message when the
 * wanted one is missing.
 * @param {string} html
 * @returns {string[]}
 */
export function listTaktNames(html) {
  return [...(html ?? '').matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
    .filter(([, attrs]) => attribute(attrs, 'name') === 'taktType')
    .map(([, , inner]) => textOf(inner));
}

/**
 * Workstation shown in the page header (`<span id="scannableId">`).
 * @param {string} html
 * @returns {string|null}
 */
export function readHeaderWorkstation(html) {
  const match = (html ?? '').match(/<span\b[^>]*\bid="scannableId"[^>]*>([\s\S]*?)<\/span>/i);
  const value = match ? textOf(match[1]) : '';
  return value || null;
}

/**
 * Best-effort error text from an HTML page the app sent back instead of the
 * expected one (e.g. a busy workstation). The exact markup is not known yet,
 * so it looks for elements whose id/class mentions error/alert/message.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractPageError(html) {
  const source = (html ?? '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const pattern = /<(div|p|span|li|h\d)\b([^>]*\b(?:id|class)="[^"]*(?:error|alert|message)[^"]*"[^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const [, , , inner] of source.matchAll(pattern)) {
    const text = textOf(inner);
    if (text) return text.slice(0, 300);
  }
  return null;
}

/**
 * Error message from a failed AJAX command. The server sends a JSON-encoded
 * string (what the app shows the user), sometimes an object.
 *
 * @param {string} body
 * @returns {string|null}
 */
export function extractCommandError(body) {
  const text = (body ?? '').trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (typeof data === 'string') return data.trim() || null;
    if (data && typeof data === 'object') {
      const message = data.message ?? data.errorMessage ?? data.error ?? data.localizedMessage;
      if (typeof message === 'string' && message.trim()) return message.trim();
      return JSON.stringify(data).slice(0, 300);
    }
  } catch {
    // Not JSON - probably an HTML error page.
  }
  return extractPageError(text) || textOf(text).slice(0, 300) || null;
}

/**
 * @param {string} body - /container/open response
 * @returns {{ scannableId: string|null, containerType: string|null, destinationType: string|null, itemCount: number|null } | null}
 */
export function parseOpenContainerResponse(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const itemCount = Number.parseInt(data.itemCount, 10);
  return {
    scannableId: data.scannableId ?? null,
    containerType: data.containerType ?? null,
    destinationType: data.destinationType ?? null,
    itemCount: Number.isFinite(itemCount) ? itemCount : null,
  };
}

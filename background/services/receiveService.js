import {
  classifyReceivePage,
  extractCommandError,
  extractPageError,
  findTaktTypeId,
  listTaktNames,
  parseOpenContainerResponse,
  readHeaderWorkstation,
} from '../../shared/parsers/receiveParser.js';

// Opens a tote / csX as the PRIMARY container at a Receive station, the same
// requests the Receive Web UI sends when a person does it by hand. It stops
// right after the container is open: nothing is received.
const RECEIVE_ORIGIN = 'https://receive.eu.aftx.amazonoperations.app';

// Tried in order until one is accepted. A busy station's exact error is not
// known yet (user will send it), so any station that doesn't lead to the
// process / takt / receive pages counts as "not usable, try the next one".
export const RECEIVE_WORKSTATIONS = ['ws-rcv-02-03', 'ws-rcv-02-04', 'ws-rcv-02-05'];
const PROCESS_PATH = 'RECEIVE_EACH';
const TAKT_NAME = 'RECEIVE_STDWORK1';
const DESTINATION_TYPE = 'PRIME';
const REQUEST_TIMEOUT_MS = 20000;

class ReceiveError extends Error {
  constructor(message, { stage, retryNextStation = false } = {}) {
    super(message);
    this.stage = stage;
    this.retryNextStation = retryNextStation;
  }
}

async function request(path, { method = 'GET', form = null, ajax = false } = {}) {
  const headers = {};
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  if (ajax) {
    headers.Accept = 'application/json, text/javascript, */*; q=0.01';
    headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  const response = await fetch(`${RECEIVE_ORIGIN}${path}`, {
    method,
    credentials: 'include',
    redirect: 'follow',
    headers,
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new ReceiveError('Receive oturumu yok — Receive sayfasına bir kez giriş yapın.', { stage: path });
  }
  return { status: response.status, ok: response.ok, url: response.url, page: classifyReceivePage(response.url), text };
}

function looksLikeLogin(result) {
  return result.page === 'other' && !result.url.startsWith(RECEIVE_ORIGIN);
}

/** Workstation → process path → takt; resolves on the /receive/each page. */
async function enterStation(workstation, log) {
  let result = await request('/workstation', { method: 'POST', form: { scannableId: workstation } });
  if (looksLikeLogin(result)) {
    throw new ReceiveError('Receive oturumu yok — Receive sayfasına bir kez giriş yapın.', { stage: 'workstation' });
  }
  if (!result.ok || !['process-path', 'takt', 'receive'].includes(result.page)) {
    const reason =
      extractPageError(result.text) ??
      (result.page === 'recover' ? 'masada kalan ürün var (workstation recovery)' : `beklenmeyen sayfa ${new URL(result.url).pathname}`);
    throw new ReceiveError(`${workstation} kabul edilmedi: ${reason}`, { stage: 'workstation', retryNextStation: true });
  }
  const shownStation = readHeaderWorkstation(result.text);
  if (shownStation && shownStation.toLowerCase() !== workstation.toLowerCase()) {
    throw new ReceiveError(`${workstation} kabul edilmedi: sayfa ${shownStation} gösteriyor`, {
      stage: 'workstation',
      retryNextStation: true,
    });
  }
  log.push(`${workstation} kabul edildi`);

  if (result.page === 'process-path') {
    result = await request('/process-path', { method: 'POST', form: { processPath: PROCESS_PATH } });
    if (result.page !== 'takt' && result.page !== 'receive') {
      throw new ReceiveError(`Receive Each seçilemedi: ${extractPageError(result.text) ?? new URL(result.url).pathname}`, {
        stage: 'process-path',
      });
    }
    log.push('Receive Each seçildi');
  }

  if (result.page === 'takt') {
    const taktId = findTaktTypeId(result.text, TAKT_NAME);
    if (!taktId) {
      const names = listTaktNames(result.text);
      throw new ReceiveError(`${TAKT_NAME} seçeneği bulunamadı. Gelenler: ${names.join(', ') || '—'}`, { stage: 'takt' });
    }
    result = await request('/takt/each', { method: 'POST', form: { taktType: taktId } });
    if (result.page !== 'receive') {
      throw new ReceiveError(`${TAKT_NAME} seçilemedi: ${extractPageError(result.text) ?? new URL(result.url).pathname}`, {
        stage: 'takt',
      });
    }
    log.push(`${TAKT_NAME} seçildi`);
  }
}

async function openPrimaryContainer(toteNumber, log) {
  const validation = await request('/validate/container', { method: 'POST', form: { id: toteNumber }, ajax: true });
  if (!validation.ok) {
    throw new ReceiveError(`${toteNumber} kabul edilmedi: ${extractCommandError(validation.text) ?? `HTTP ${validation.status}`}`, {
      stage: 'validate',
    });
  }

  const open = await request('/container/open', {
    method: 'POST',
    form: { id: toteNumber, destinationType: DESTINATION_TYPE, requiredContainerType: '' },
    ajax: true,
  });
  if (!open.ok) {
    throw new ReceiveError(`${toteNumber} açılamadı: ${extractCommandError(open.text) ?? `HTTP ${open.status}`}`, {
      stage: 'open',
    });
  }
  const container = parseOpenContainerResponse(open.text);
  if (!container) {
    throw new ReceiveError(`${toteNumber} açıldı mı anlaşılamadı (beklenmeyen cevap).`, { stage: 'open' });
  }
  log.push(`${toteNumber} PRIMARY container olarak açıldı`);
  return container;
}

/**
 * @param {string} toteNumber - tote (tsX…) or csX
 * @param {{ workstations?: string[] }} [options]
 * @returns {Promise<{ status: 'ok'|'error', workstation?: string, container?: object, message?: string, log: string[] }>}
 */
export async function openToteInReceive(toteNumber, { workstations = RECEIVE_WORKSTATIONS } = {}) {
  const log = [];
  for (const workstation of workstations) {
    try {
      await enterStation(workstation, log);
      const container = await openPrimaryContainer(toteNumber, log);
      return { status: 'ok', workstation, container, log };
    } catch (error) {
      const message = String(error?.message ?? error);
      log.push(message);
      if (error instanceof ReceiveError && error.retryNextStation) continue;
      return { status: 'error', message, log };
    }
  }
  return { status: 'error', message: `Boş masa bulunamadı (${workstations.join(', ')}).`, log };
}

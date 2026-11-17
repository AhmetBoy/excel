import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyReceivePage,
  extractCommandError,
  findTaktTypeId,
  parseOpenContainerResponse,
  readHeaderWorkstation,
} from '../shared/parsers/receiveParser.js';
import { openToteInReceive } from '../background/services/receiveService.js';

const ORIGIN = 'https://receive.eu.aftx.amazonoperations.app';
const header = (ws) => `<div id="workstationDetails"><div>Workstation: <span class="value" id="scannableId">${ws}</span></div></div>`;
// Shape copied from the live /takt/each page (2026-11-17).
const TAKT_PAGE = `${header('ws-rcv-02-04')}<form action="/takt/each" method="POST"><ul id="takt-types"><li><button value="504d9bbb-135d-4dc4-8774-1389fc7570e1" name="taktType" type="submit">RECEIVE_STDWORK1</button></li><li><button value="other-id" name="taktType" type="submit">RECEIVE_OTHER</button></li></ul></form>`;
const OPEN_JSON = JSON.stringify({ scannableId: 'tsXSA903324', containerType: 'TRANSSHIP_TOTE', destinationType: 'PRIME', itemCount: 4 });

describe('receiveParser', () => {
  it('classifies pages by path', () => {
    expect(classifyReceivePage(`${ORIGIN}/process-path`)).toBe('process-path');
    expect(classifyReceivePage(`${ORIGIN}/takt/each`)).toBe('takt');
    expect(classifyReceivePage(`${ORIGIN}/receive/each`)).toBe('receive');
    expect(classifyReceivePage(`${ORIGIN}/workstation/recover`)).toBe('recover');
    expect(classifyReceivePage(`${ORIGIN}/`)).toBe('other');
  });

  it('finds the takt id by its label', () => {
    expect(findTaktTypeId(TAKT_PAGE, 'RECEIVE_STDWORK1')).toBe('504d9bbb-135d-4dc4-8774-1389fc7570e1');
    expect(findTaktTypeId(TAKT_PAGE, 'missing')).toBeNull();
  });

  it('reads the header workstation', () => {
    expect(readHeaderWorkstation(header('ws-rcv-02-05'))).toBe('ws-rcv-02-05');
  });

  it('reads command errors', () => {
    expect(extractCommandError('"Container is not valid"')).toBe('Container is not valid');
    expect(extractCommandError('{"message":"busy"}')).toBe('busy');
    expect(extractCommandError('')).toBeNull();
  });

  it('parses the open response', () => {
    expect(parseOpenContainerResponse(OPEN_JSON)).toEqual({
      scannableId: 'tsXSA903324',
      containerType: 'TRANSSHIP_TOTE',
      destinationType: 'PRIME',
      itemCount: 4,
    });
  });
});

function reply(body, { status = 200, path = '/' } = {}) {
  return { status, ok: status >= 200 && status < 300, url: `${ORIGIN}${path}`, text: async () => body };
}

describe('openToteInReceive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('walks workstation → Receive Each → takt → open, skipping a station that is not accepted', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const path = new URL(url).pathname;
        const body = init.body ?? '';
        calls.push(`${path} ${body}`);
        if (path === '/workstation') {
          return body.includes('ws-rcv-02-03')
            ? reply('<div class="error-message">Workstation in use</div>', { path: '/' })
            : reply(header('ws-rcv-02-04'), { path: '/process-path' });
        }
        if (path === '/process-path') return reply(TAKT_PAGE, { path: '/takt/each' });
        if (path === '/takt/each') return reply(header('ws-rcv-02-04'), { path: '/receive/each' });
        if (path === '/validate/container') return reply('', { path });
        if (path === '/container/open') return reply(OPEN_JSON, { path });
        throw new Error(`unexpected ${path}`);
      })
    );

    const result = await openToteInReceive('tsXSA903324');
    expect(result.status).toBe('ok');
    expect(result.workstation).toBe('ws-rcv-02-04');
    expect(result.container.itemCount).toBe(4);
    expect(calls).toEqual([
      '/workstation scannableId=ws-rcv-02-03',
      '/workstation scannableId=ws-rcv-02-04',
      '/process-path processPath=RECEIVE_EACH',
      '/takt/each taktType=504d9bbb-135d-4dc4-8774-1389fc7570e1',
      '/validate/container id=tsXSA903324',
      '/container/open id=tsXSA903324&destinationType=PRIME&requiredContainerType=',
    ]);
    expect(result.log[0]).toContain('Workstation in use');
  });

  it('stops without trying other stations when the tote itself is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const path = new URL(url).pathname;
        if (path === '/workstation') return reply(header('ws-rcv-02-03'), { path: '/receive/each' });
        if (path === '/validate/container') return reply('"Invalid container"', { status: 400, path });
        throw new Error(`unexpected ${path}`);
      })
    );
    const result = await openToteInReceive('tsXBAD');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Invalid container');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports when no station is free', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('', { path: '/' })));
    const result = await openToteInReceive('tsX1');
    expect(result.status).toBe('error');
    expect(result.message).toContain('Boş masa bulunamadı');
  });
});

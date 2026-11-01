import { code128Path } from '../shared/code128.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// On-screen size of one barcode module; 2px keeps it readable for a scanner.
const MODULE_PX = 2;
const BAR_HEIGHT = 50;

/**
 * Builds a scannable Code 128 barcode (SVG) with the text printed below it.
 * Returns an error label instead when the text can't be encoded.
 * @param {string} text
 * @returns {HTMLElement}
 */
export function createBarcodeElement(text) {
  const figure = document.createElement('figure');
  figure.className = 'barcode';

  let path;
  try {
    path = code128Path(text, BAR_HEIGHT);
  } catch (error) {
    figure.classList.add('barcode-error');
    figure.textContent = `${text}: ${error.message}`;
    return figure;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${path.width} ${path.height}`);
  svg.setAttribute('width', String(path.width * MODULE_PX));
  svg.setAttribute('height', String(path.height * MODULE_PX));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Barkod ${text}`);

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', '#fff');
  const bars = document.createElementNS(SVG_NS, 'path');
  bars.setAttribute('d', path.d);
  bars.setAttribute('fill', '#000');
  svg.append(background, bars);

  const caption = document.createElement('figcaption');
  caption.textContent = text;

  figure.append(svg, caption);
  return figure;
}

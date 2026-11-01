import { createBarcodeElement } from './barcodeDom.js';

const form = document.getElementById('barcode-form');
const input = document.getElementById('barcode-input');
const output = document.getElementById('barcode-output');

const STORAGE_KEY = 'barcodeTabInput';

function parseLines(value) {
  const seen = new Set();
  return value
    .split(/[\r\n,;]+/)
    .map((line) => line.trim())
    .filter((line) => line && !seen.has(line) && seen.add(line));
}

function render() {
  output.replaceChildren(...parseLines(input.value).map(createBarcodeElement));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  chrome.storage.local.set({ [STORAGE_KEY]: input.value });
  render();
});

chrome.storage.local.get(STORAGE_KEY).then((data) => {
  input.value = data[STORAGE_KEY] ?? '';
  if (input.value) render();
});

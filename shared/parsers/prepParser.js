import { normalizeValue } from '../normalize.js';

// Checked against a saved live page (tests/fixtures/prep-view.html): the
// current instructions are <li> items inside #instructions. The history box
// repeats old instructions, so it must never be read as the current state.
const NO_INSTRUCTIONS = /no instructions set/i;

/**
 * Parses a Prep Instructions Manager /view/<ASIN> page.
 *
 * @param {string} html
 * @returns {{ found: boolean, instructions: string[] }}
 *   found=true with no instructions means the product needs no prep;
 *   found=false means the page couldn't be read (unknown, not "no prep").
 */
export function parsePrepHtml(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  doc.querySelectorAll('.history-box, #history').forEach((el) => el.remove());

  const box = doc.querySelector('#instructions, .instruction-box');
  const instructions = Array.from(box?.querySelectorAll('li') ?? [])
    .map((li) => normalizeValue(li.textContent ?? ''))
    .filter((value) => value && !NO_INSTRUCTIONS.test(value));

  if (instructions.length > 0) return { found: true, instructions };
  return { found: NO_INSTRUCTIONS.test(doc.body?.textContent ?? ''), instructions: [] };
}

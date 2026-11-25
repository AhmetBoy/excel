import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The panel / background scripts aren't imported by other tests (they need
// chrome.* and the page), so a syntax error there would only show up in
// Chrome - where a broken sidepanel.js silently turns the search form into
// a page reload. `node --check` catches it here.
const DIRS = ['background', 'background/services', 'offscreen', 'shared', 'shared/parsers', 'sidepanel'];
const files = DIRS.flatMap((dir) =>
  readdirSync(join(process.cwd(), dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `${dir}/${name}`)
);

describe('extension scripts parse', () => {
  it.each(files)('%s', (file) => {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: process.cwd(), encoding: 'utf-8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

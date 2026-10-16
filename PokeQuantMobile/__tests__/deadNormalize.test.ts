// Pins for tools/dead-normalize.mjs — the canonical `relpath - name` key
// the lint:dead baseline is compared on. The module is .mjs, which jest's
// transform (`\.[jt]sx?$`) never touches, so it's exercised through a real
// node subprocess — exactly what the lint scripts run.

/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require; no node type declarations in this setup */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;

type Entry = { key: string; display: string };

const toolUrl = pathToFileURL(join(__dirname, '..', 'tools', 'dead-normalize.mjs')).href;

// One subprocess normalizes the whole batch — spawn cost paid once.
const normalizeAll = (cases: [line: string, root: string][]): Entry[] =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { normalizeDeadEntry } from ${JSON.stringify(toolUrl)};` +
          `process.stdout.write(JSON.stringify(${JSON.stringify(cases)}` +
          `.map(([l, r]) => normalizeDeadEntry(l, r))));`,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ),
  ) as Entry[];

describe('dead-normalize', () => {
  it('maps every emitted path shape to the same canonical key', () => {
    const entries = normalizeAll([
      ['src\\foo.ts:12 - x', 'C:\\repo'],
      ['C:\\repo\\src\\foo.ts:12 - x', 'C:\\repo'],
      ['/repo/src/foo.ts:12 - x', '/repo'],
      // Windows in-tree emitted form (cwd stripped, backslash kept)
      ['\\src\\foo.ts:12 - x', 'C:\\repo'],
      // POSIX in-tree emitted form (cwd + leading '/' both stripped)
      ['src/foo.ts:12 - x', '/repo'],
    ]);
    for (const e of entries) expect(e.key).toBe('src/foo.ts - x');
  });

  it('preserves the `(used in module)` suffix', () => {
    const [e] = normalizeAll([['\\src\\foo.ts:12 - x (used in module)', 'C:\\repo']]);
    expect(e.key).toBe('src/foo.ts - x (used in module)');
  });

  it('drops the line number, so line shifts are drift-immune', () => {
    const [a, b] = normalizeAll([
      ['\\src\\foo.ts:1 - x', 'C:\\repo'],
      ['\\src\\foo.ts:99 - x', 'C:\\repo'],
    ]);
    expect(a.key).toBe(b.key);
  });

  it('keeps `file:line` only in the display form', () => {
    const [e] = normalizeAll([['\\src\\foo.ts:12 - x', 'C:\\repo']]);
    expect(e.display).toBe('src/foo.ts:12 - x');
  });

  it('relativizes out-of-package files through `..`', () => {
    const entries = normalizeAll([
      // Windows out-of-tree absolute (workerHarness pulls ../worker_show_vendor)
      ['C:\\repo\\worker_show_vendor\\vendors.js:11 - getX', 'C:\\repo\\PokeQuantMobile'],
      // POSIX out-of-tree absolute
      ['/repo/worker_show_vendor/vendors.js:11 - getX', '/repo/PokeQuantMobile'],
      // POSIX out-of-tree emitted form — '/'-stripped absolute, recovered
      // via the shared first segment with root
      ['repo/worker_show_vendor/vendors.js:11 - getX', '/repo/PokeQuantMobile'],
    ]);
    for (const e of entries) {
      expect(e.key).toBe('../worker_show_vendor/vendors.js - getX');
    }
  });

  it('is idempotent — canonical baseline keys normalize to themselves', () => {
    const entries = normalizeAll([
      ['src/foo.ts - x', 'C:\\repo'],
      ['../worker_show_vendor/vendors.js - getX (used in module)', '/repo'],
    ]);
    expect(entries[0].key).toBe('src/foo.ts - x');
    expect(entries[1].key).toBe('../worker_show_vendor/vendors.js - getX (used in module)');
  });
});

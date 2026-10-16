/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require; tsconfig ships no node types */
const fs = require('node:fs');
const path = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;

// Facade-split boundary pins (item 30): catalogDb.ts is a pure re-export
// facade over the four domain modules; the card-search surface lives in
// catalogSearch.ts and depends inward only (catalogSession/catalogPrices)
// — never back on the facade. These read the sources so a future edit
// that reintroduces a cycle or drops SQL back into the facade fails
// here, not in code review. Behavioral coverage stays in the existing
// catalog suites (useCatalogSearch / catalogSearchPagination /
// canonPrice), all unedited.

const SRC_DB = path.join(__dirname, '..', 'src', 'db');
const readSrc = (name: string): string => fs.readFileSync(path.join(SRC_DB, name), 'utf8');

const facade = readSrc('catalogDb.ts');
const search = readSrc('catalogSearch.ts');

describe('catalogDb pure facade', () => {
  test('re-exports all four domain modules', () => {
    for (const mod of [
      './catalogSession',
      './catalogPrices',
      './catalogSignals',
      './catalogSearch',
    ]) {
      expect(facade).toContain(`export * from '${mod}';`);
    }
  });

  test('holds no card-search SQL strings', () => {
    expect(facade).not.toContain('FROM cards');
    expect(facade).not.toContain('FROM price_history');
    expect(facade).not.toContain('canon_price');
  });

  test('keeps the cross-domain setCatalogDatabase wrapper', () => {
    expect(facade).toContain('export function setCatalogDatabase');
  });
});

describe('catalogSearch dependency direction', () => {
  test('never imports the facade — one direction only', () => {
    expect(search).not.toMatch(/['"]\.\/catalogDb(\.js)?['"]/);
  });

  test('search entry points live here', () => {
    expect(search).toContain('export const searchCatalogCards');
    expect(search).toContain('export const searchCatalogCardsByNames');
    expect(search).toContain('export const getCatalogCardCount');
  });
});

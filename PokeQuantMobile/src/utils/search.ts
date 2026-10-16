// Shared catalog-search normalization — strips apostrophes, periods
// and dashes so "Farfetch'd" / "Poké Ball" style names match on plain
// text. Single owner; previously duplicated in 5 files.
// NOTE: normalizeSearchTerm below is a different function (no
// whitespace collapse, no curly-quote strip) — do not converge.
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Inventory-side normalization — weaker on purpose: strips straight
// apostrophe/period/dash only, no whitespace collapse, no curly quote.
// NOT the same as normalizeSearch — inventory rows are owner-entered
// and looser matching would over-trigger.
export function normalizeSearchTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/['.\-]/g, '')
    .trim();
}

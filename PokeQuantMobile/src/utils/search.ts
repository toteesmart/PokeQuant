// Shared catalog-search normalization — strips apostrophes, periods
// and dashes so "Farfetch'd" / "Poké Ball" style names match on plain
// text. Single owner; previously duplicated in 5 files.
// NOTE: normalizeSearchTerm in InventoryScreen/ShowVendorScreen is a
// different function (no whitespace collapse, no curly-quote strip) —
// do not converge them blindly.
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

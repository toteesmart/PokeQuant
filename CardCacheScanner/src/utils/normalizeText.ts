export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

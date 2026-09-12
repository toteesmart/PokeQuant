import type { TestCatalogCard } from '../../types/catalog';
import { normalizeText } from '../../utils/normalizeText';

export type MatchMethod = 'number' | 'name' | 'fuzzy' | 'visual' | 'fused';

export type CatalogMatch = {
  card: TestCatalogCard;
  method: MatchMethod;
  confidence: number;
};

const COMMON_NOISE = [
  'stage',
  'stage1',
  'stage2',
  'staget',
  'stagel',
  'staggli',
  'suagggli',
  'basic',
  ' evolves from ',
  'terastal',
  'tera',
  'hp',
  'pokemon',
  'pokémon',
  'pokemon ex',
  'pokémon ex',
  'pokemon ex rule',
  'pokémon ex rule',
  'ex rule',
  'when your pokemon',
  'is knocked out',
  'your opponent takes',
  'prize cards',
  'during your next turn',
  'this attack',
  'this pokémon',
  'prevent all damage',
  'by attacks',
  'both yours',
  'and your opponent',
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j] + 1,      // deletion
        row[j - 1] + 1,  // insertion
        prev + cost      // substitution
      );
      prev = temp;
    }
  }

  return row[n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function cleanCardName(raw: string): string {
  let text = raw.toLowerCase();

  for (const noise of COMMON_NOISE) {
    text = text.replace(new RegExp(noise, 'gi'), ' ');
  }

  // Remove standalone numbers like 280, 60, 2 but keep collector numbers like 023/131.
  text = text.replace(/\b\d{1,4}\b(?!\/)/g, ' ');

  // Normalize ex.
  text = text.replace(/\bex\b/g, 'ex').replace(/\b(e[xX]|EX)\b/g, 'ex');

  // Collapse accents and weird characters.
  text = text
    .replace(/[éèê]/g, 'e')
    .replace(/[áàâ]/g, 'a')
    .replace(/[íìî]/g, 'i')
    .replace(/[óòô]/g, 'o')
    .replace(/[úùû]/g, 'u')
    .replace(/[ñ]/g, 'n');

  text = text.replace(/[^a-z0-9\/\s]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

export function extractCardNameFromOcr(text: string): string | null {
  const cleaned = cleanCardName(text);
  if (!cleaned) return null;
  return cleaned;
}

export function catalogName(card: TestCatalogCard): string {
  // Drop the " - 023/131" suffix from catalog names.
  return cleanCardName(card.name).replace(/\s*\d+\/\d+\s*$/, '').trim();
}

function tokenLcs(a: string[], b: string[]): number {
  // Longest common subsequence of tokens (exact equality). O(|a|*|b|).
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  let prev: number[] = new Array(n + 1).fill(0);
  let curr: number[] = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0, 0, n + 1);
  }

  return prev[n];
}

function tokenFuzzyMatches(ocrTokens: string[], targetTokens: string[]): number {
  // Count target tokens that have a fuzzy match in the OCR tokens.
  let matched = 0;
  for (const tt of targetTokens) {
    for (const ot of ocrTokens) {
      // Short common words like "ex" require an exact match.
      const threshold = tt.length <= 3 ? 1.0 : 0.75;
      if (similarity(ot, tt) >= threshold) {
        matched++;
        break;
      }
    }
  }
  return matched;
}

function prefixOverlap(a: string, b: string): boolean {
  // 3-letter prefix overlap catches OCR typos like vaporenen/vaporeon.
  const min = Math.min(3, a.length, b.length);
  return a.slice(0, min) === b.slice(0, min);
}

export function bestNameScore(cleaned: string, target: string): number {
  const ocrTokens = cleaned.split(' ').filter(Boolean);
  const targetTokens = target.split(' ').filter(Boolean);
  if (targetTokens.length === 0 || ocrTokens.length === 0) return 0;

  // Fast token-LCS: if the target is a subsequence of the OCR in order, 1.0.
  const lcs = tokenLcs(ocrTokens, targetTokens);
  const score = lcs / targetTokens.length;
  if (score >= 0.5) return score;

  // Fuzzy fallback for typos (e.g. vaporenen vs vaporeon).
  const fuzzy = tokenFuzzyMatches(ocrTokens, targetTokens);
  return fuzzy / targetTokens.length;
}

function nameFilter(cleaned: string, catalog: TestCatalogCard[]): TestCatalogCard[] {
  // Quick prefix-3 filter to avoid scoring 31k cards on every name match.
  const ocrTokens = cleaned.split(' ').filter((t) => t.length >= 3);
  if (ocrTokens.length === 0) return catalog;

  const result: TestCatalogCard[] = [];
  for (const card of catalog) {
    const cTokens = catalogName(card).split(' ').filter(Boolean);
    if (cTokens.some((ct) => ocrTokens.some((ot) => prefixOverlap(ot, ct)))) {
      result.push(card);
    }
  }
  return result.length > 0 ? result : catalog;
}

export function findBestMatch(
  topText: string,
  numberText: string | null | undefined,
  catalog: TestCatalogCard[]
): CatalogMatch | null {
  if (!catalog.length) return null;

  const name = extractCardNameFromOcr(topText);
  const number = numberText ? normalizeText(numberText) : null;

  // 1. Exact number match, then pick the one whose name is closest.
  if (number) {
    const byNumber = catalog.filter((c) => normalizeText(c.number) === number);
    if (byNumber.length === 1) {
      return { card: byNumber[0], method: 'number', confidence: 0.95 };
    }
    if (byNumber.length > 1 && name) {
      let best = byNumber[0];
      let bestScore = -1;
      for (const c of byNumber) {
        const score = bestNameScore(name, catalogName(c));
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return { card: best, method: 'number', confidence: Math.max(0.8, bestScore) };
    }
  }

  // 2. Name-based match.
  if (!name) return null;

  const candidates = nameFilter(name, catalog);
  let best: CatalogMatch | null = null;
  for (const c of candidates) {
    const cName = catalogName(c);
    const score = bestNameScore(name, cName);
    const isBetter =
      !best ||
      score > best.confidence ||
      (score === best.confidence && cName.length > catalogName(best.card).length);
    if (isBetter) {
      best = { card: c, method: 'name', confidence: score };
    }
  }

  if (best && best.confidence >= 0.5) {
    return best;
  }

  return null;
}

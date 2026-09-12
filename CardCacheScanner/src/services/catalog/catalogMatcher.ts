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
  // The number/number pair is preserved so catalogName can strip the suffix.
  text = text.replace(/(?<!\/)\b\d{1,4}\b(?!\/)/g, ' ');

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

const catalogNameCache = new WeakMap<TestCatalogCard, string>();

export function catalogName(card: TestCatalogCard): string {
  // Drop the " - 023/131" suffix from catalog names.
  let cached = catalogNameCache.get(card);
  if (!cached) {
    cached = cleanCardName(card.name).replace(/\s*\d+\/\d+\s*$/, '').trim();
    catalogNameCache.set(card, cached);
  }
  return cached;
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

  // Target-normalized score: how many target tokens are found in the OCR.
  // Extra OCR noise does not lower the score, because the name line is usually
  // embedded in attack text / flavor text.
  const lcs = tokenLcs(ocrTokens, targetTokens);
  const score = lcs / targetTokens.length;
  if (score >= 0.5) return score;

  // Fuzzy fallback for typos (e.g. vaporenen vs vaporeon).
  const fuzzy = tokenFuzzyMatches(ocrTokens, targetTokens);
  return fuzzy / targetTokens.length;
}

// Cache catalog-derived name data. Catalog is loaded once and treated as immutable.
let cachedCatalog: TestCatalogCard[] | null = null;
let catalogNames: string[] = [];
let catalogTokenArrays: string[][] = [];
let catalogNumbers: string[] = [];

export function precomputeCatalogCache(catalog: TestCatalogCard[]) {
  ensureCatalogCache(catalog);
}

function ensureCatalogCache(catalog: TestCatalogCard[]) {
  if (cachedCatalog === catalog) return;
  cachedCatalog = catalog;
  catalogNames = catalog.map(catalogName);
  catalogTokenArrays = catalogNames.map((n) => n.split(' ').filter(Boolean));
  catalogNumbers = catalog.map((c) => normalizeText(c.number));
}

export function nameFilter(cleaned: string, catalog: TestCatalogCard[]): TestCatalogCard[] {
  // Quick prefix-3 filter to avoid scoring 31k cards on every name match.
  ensureCatalogCache(catalog);
  const ocrTokens = cleaned.split(' ').filter((t) => t.length >= 3);
  if (ocrTokens.length === 0) return catalog;

  const result: TestCatalogCard[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const cTokens = catalogTokenArrays[i];
    if (cTokens.some((ct) => ocrTokens.some((ot) => prefixOverlap(ot, ct)))) {
      result.push(catalog[i]);
    }
  }
  return result.length > 0 ? result : catalog;
}

function numberCandidates(catalog: TestCatalogCard[], number: string): TestCatalogCard[] {
  ensureCatalogCache(catalog);
  return catalog.filter((_, i) => catalogNumbers[i] === number);
}

function closestNumberCard(
  ocrNumber: string,
  cards: TestCatalogCard[]
): { card: TestCatalogCard; confidence: number } | null {
  let best: { card: TestCatalogCard; confidence: number } | null = null;
  for (const c of cards) {
    const cn = normalizeText(c.number);
    const score = similarity(ocrNumber, cn);
    if (!best || score > best.confidence) {
      best = { card: c, confidence: score };
    }
  }
  return best;
}

export function findBestMatch(
  ocrText: string,
  numberText: string | null | undefined,
  catalog: TestCatalogCard[]
): CatalogMatch | null {
  if (!catalog.length) return null;

  ensureCatalogCache(catalog);
  const name = extractCardNameFromOcr(ocrText);
  const number = numberText ? normalizeText(numberText) : null;

  // 1. Exact number match, then pick the one whose name is closest.
  if (number) {
    const byNumber = numberCandidates(catalog, number);
    if (byNumber.length === 1) {
      return { card: byNumber[0], method: 'number', confidence: 0.95 };
    }
    if (byNumber.length > 1 && name) {
      let best = byNumber[0];
      let bestScore = -1;
      for (const c of byNumber) {
        const cName = catalogName(c);
        const score = bestNameScore(name, cName);
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
  const scored: CatalogMatch[] = [];
  let best: CatalogMatch | null = null;
  for (const c of candidates) {
    const cName = catalogName(c);
    const score = bestNameScore(name, cName);
    if (score >= 0.5) {
      scored.push({ card: c, method: 'name', confidence: score });
    }
    const isBetter =
      !best ||
      score > best.confidence ||
      (score === best.confidence && cName.length > catalogName(best.card).length);
    if (isBetter) {
      best = { card: c, method: 'name', confidence: score };
    }
  }

  // 3. Number correction: if the OCR number was close to a name candidate's number,
  // prefer that. This fixes misread digits like 023/137 -> 023/131.
  if (number && best && scored.length > 0) {
    const numberFix = closestNumberCard(number, scored.map((m) => m.card));
    if (numberFix && numberFix.confidence >= 0.5) {
      const nameScore = bestNameScore(name, catalogName(numberFix.card));
      return {
        card: numberFix.card,
        method: 'number',
        confidence: Math.max(0.6, Math.min(0.9, numberFix.confidence * 0.8 + nameScore * 0.2)),
      };
    }
  }

  if (best && best.confidence >= 0.5) {
    return best;
  }

  return null;
}

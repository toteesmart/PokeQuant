import type { ScanCatalogCard } from '../../types/catalog';
import { normalizeText, normalizeNumber } from '../../utils/normalizeText';

export type MatchMethod = 'number' | 'name' | 'fuzzy' | 'visual' | 'fused';

export type CatalogMatch = {
  card: ScanCatalogCard;
  method: MatchMethod;
  confidence: number;
  // Other catalog cards sharing the same collector number (different sets or
  // printings) that the OCR name could not disambiguate. Only populated on
  // number-fallback matches so the review sheet can offer them.
  alternates?: ScanCatalogCard[];
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

  // Join possessives without splitting ("cynthia's" -> "cynthias") so names
  // like "Cynthia's Spiritomb" match normalizeText-style tokenization.
  text = text.replace(/[''ʼ`]/g, '');
  text = text.replace(/[^a-z0-9\/\s]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

export function extractCardNameFromOcr(text: string): string | null {
  const cleaned = cleanCardName(text);
  if (!cleaned) return null;
  return cleaned;
}

const catalogNameCache = new WeakMap<{ name: string }, string>();

export function catalogName(card: { name: string }): string {
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
let cachedCatalog: ScanCatalogCard[] | null = null;
let catalogNames: string[] = [];
let catalogTokenArrays: string[][] = [];
let catalogNumbers: string[] = [];

export function precomputeCatalogCache(catalog: ScanCatalogCard[]) {
  ensureCatalogCache(catalog);
}

function ensureCatalogCache(catalog: ScanCatalogCard[]) {
  if (cachedCatalog === catalog) return;
  cachedCatalog = catalog;
  catalogNames = catalog.map(catalogName);
  catalogTokenArrays = catalogNames.map((n) => n.split(' ').filter(Boolean));
  catalogNumbers = catalog.map((c) => normalizeNumber(c.number));
}

// Whether the OCR name plausibly refers to this catalog card. A high
// bestNameScore agrees; so does sharing the card's first name token, which
// covers catalog names with extra descriptor tokens like
// "eevee cosmos holo" when the OCR only read "eevee".
export function nameAgrees(ocrName: string | null, cardName: string): boolean {
  if (!ocrName) return true;
  if (bestNameScore(ocrName, cardName) >= 0.5) return true;
  const first = cardName.split(' ')[0];
  return !!first && ocrName.split(' ').includes(first);
}

export function nameFilter(cleaned: string, catalog: ScanCatalogCard[]): ScanCatalogCard[] {
  // Quick prefix-3 filter to avoid scoring 31k cards on every name match.
  ensureCatalogCache(catalog);
  const ocrTokens = cleaned.split(' ').filter((t) => t.length >= 3);
  if (ocrTokens.length === 0) return catalog;

  const result: ScanCatalogCard[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const cTokens = catalogTokenArrays[i];
    if (cTokens.some((ct) => ocrTokens.some((ot) => prefixOverlap(ot, ct)))) {
      result.push(catalog[i]);
    }
  }
  return result.length > 0 ? result : catalog;
}

function numberCandidates(catalog: ScanCatalogCard[], number: string): ScanCatalogCard[] {
  ensureCatalogCache(catalog);
  const normalized = normalizeNumber(number);
  return catalog.filter((_, i) => catalogNumbers[i] === normalized);
}

// Cards whose collector number is one digit off from the OCR read, same set
// total — covers "013/217" misread as "113/217". Substitutions run on the
// raw (zero-padded) left side since normalizeNumber strips leading zeros;
// promo codes and bare numbers are untouched.
export function findNearNumberCandidates(
  number: string,
  catalog: ScanCatalogCard[]
): ScanCatalogCard[] {
  const raw = number.trim();
  const slash = raw.indexOf('/');
  if (slash < 0) return [];
  const left = raw.slice(0, slash);
  const right = raw.slice(slash + 1);
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) return [];

  const out: ScanCatalogCard[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < left.length; i++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === left[i]) continue;
      const variant = `${left.slice(0, i)}${d}${left.slice(i + 1)}/${right}`;
      for (const c of numberCandidates(catalog, variant)) {
        if (!seen.has(c.productId)) {
          seen.add(c.productId);
          out.push(c);
        }
      }
    }
  }
  return out;
}

// Generic suffix/descriptor tokens don't count as real name evidence — an
// "ex" or "mega" hit alone is too weak to override a collector number.
const GENERIC_NAME_TOKENS = new Set([
  'ex', 'gx', 'v', 'vmax', 'vstar', 'mega', 'm', 'dark', 'light', 's',
  'teal', 'mask', 'staff', 'box', 'prism', 'star', 'tag', 'team', 'shiny',
  'golden', 'full', 'art', 'promo', 'holo', 'jumbo',
]);

// Whether the OCR name shares at least one exact, non-generic name token.
// Fuzzy-only agreement ("dianga" ~ "dialga") does not count.
function sharesExactNameToken(ocrName: string, cardName: string): boolean {
  const ocr = new Set(ocrName.split(' '));
  return cardName
    .split(' ')
    .some((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t) && ocr.has(t));
}

function closestNumberCard(
  ocrNumber: string,
  cards: ScanCatalogCard[]
): { card: ScanCatalogCard; confidence: number } | null {
  let best: { card: ScanCatalogCard; confidence: number } | null = null;
  for (const c of cards) {
    const cn = normalizeNumber(c.number);
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
  catalog: ScanCatalogCard[]
): CatalogMatch | null {
  if (!catalog.length) return null;

  ensureCatalogCache(catalog);
  const name = extractCardNameFromOcr(ocrText);
  const number = numberText ? normalizeNumber(numberText) : null;

  // 1. Exact number match, then pick the candidate whose name agrees with the
  // OCR name. If no same-number candidate agrees, the number was probably
  // misread — fall through to name matching instead of returning a
  // confidently wrong card.
  let numberFallback: CatalogMatch | null = null;
  if (number) {
    const byNumber = numberCandidates(catalog, number);
    const agreeing = name
      ? byNumber.filter((c) => nameAgrees(name, catalogName(c)))
      : byNumber;
    if (agreeing.length === 1) {
      return { card: agreeing[0], method: 'number', confidence: 0.95 };
    }
    if (agreeing.length > 1 && name) {
      let best = agreeing[0];
      let bestScore = -1;
      for (const c of agreeing) {
        const cName = catalogName(c);
        const score = bestNameScore(name, cName);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return { card: best, method: 'number', confidence: Math.max(0.8, bestScore) };
    }
    if (byNumber.length > 0) {
      numberFallback = {
        card: byNumber[0],
        method: 'number',
        confidence: 0.5,
        alternates: byNumber.slice(1),
      };
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

  // 3. Number correction: if the OCR number was close to a name candidate's
  // number, prefer that. This fixes misread digits like 023/137 -> 023/131.
  // Requires a strong name match — a weak one (e.g. garbage OCR text that only
  // shares the generic "ex" token) must not snap to a wrong neighbour.
  if (number && best && best.confidence >= 0.7 && scored.length > 0) {
    const numberFix = closestNumberCard(number, scored.map((m) => m.card));
    if (
      numberFix &&
      numberFix.confidence >= 0.5 &&
      sharesExactNameToken(name, catalogName(numberFix.card))
    ) {
      const nameScore = bestNameScore(name, catalogName(numberFix.card));
      return {
        card: numberFix.card,
        method: 'number',
        confidence: Math.max(0.6, Math.min(0.9, numberFix.confidence * 0.8 + nameScore * 0.2)),
      };
    }
  }

  // A generic name match that is a subset of the same-number card's name
  // ("spiritomb" ⊂ "cynthias spiritomb") is still consistent with the number —
  // prefer the exact-number card over the bare-name card.
  if (numberFallback && best && best.confidence >= 0.5) {
    const bestTokens = new Set(catalogName(best.card).split(' ').filter(Boolean));
    const fallbackTokens = new Set(catalogName(numberFallback.card).split(' ').filter(Boolean));
    if (bestTokens.size < fallbackTokens.size && [...bestTokens].every((t) => fallbackTokens.has(t))) {
      return numberFallback;
    }
  }

  // An exact collector-number hit outranks a name match built only on fuzzy
  // tokens — fuzzy hits on garbage OCR text are too weak to override a real
  // number (e.g. "dianga" ~ "dialga" must not beat the real 267/217 card).
  if (numberFallback && best && !sharesExactNameToken(name, catalogName(best.card))) {
    return numberFallback;
  }

  if (best && best.confidence >= 0.7) {
    return best;
  }

  // A real same-number card beats a weak name match — the OCR number is
  // usually more reliable than a noisy name.
  return numberFallback ?? (best && best.confidence >= 0.5 ? best : null);
}

// Same collector number + essentially the same name. Returns every matching
// catalog entry including `card` itself; callers mark the selected row.
// Used to offer variant switches (e.g. regular vs Prize Pack printings).
export function findVariantOptions(
  card: Pick<ScanCatalogCard, 'productId' | 'name' | 'number'>,
  catalog: ScanCatalogCard[]
): ScanCatalogCard[] {
  if (!catalog.length) return [];
  ensureCatalogCache(catalog);
  const number = normalizeNumber(card.number);
  const tokens = catalogName(card).split(' ').filter(Boolean);
  if (!number || tokens.length === 0) return [];

  const options: ScanCatalogCard[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const c = catalog[i];
    if (catalogNumbers[i] !== number) continue;
    const cTokens = catalogTokenArrays[i];
    if (cTokens.length === 0) continue;
    // One name must be a prefix of the other, so "Pikachu" matches
    // "Pikachu (Energy Symbol Pattern)" while "Latias" doesn't match
    // "Mega Latias ex".
    const shorter = tokens.length <= cTokens.length ? tokens : cTokens;
    const longer = tokens.length <= cTokens.length ? cTokens : tokens;
    if (shorter.every((t, j) => longer[j] === t)) {
      options.push(c);
    }
  }
  return options;
}

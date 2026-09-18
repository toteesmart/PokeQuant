export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Collector numbers appear in the catalog both with and without spaces
// ("SVP 200" vs "SVP200"), so compare them space-insensitively. Slash
// numbers are canonicalized so "6/12", "06/12" and "006/012" compare equal.
export function normalizeNumber(text: string): string {
  const n = normalizeText(text).replace(/\s/g, '');
  const m = n.match(/^(\d+)\/(\d+)$/);
  if (m) return `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}`;
  // Japanese promo denominators are letter codes ("001/M-P", "012/SV-P"),
  // but TCGCSV stores them inconsistently — some products keep the code,
  // others only the bare numerator ("242"). Canonicalize lettered
  // denominators to the zero-padded numerator alone so both catalog forms
  // and the OCR-extracted number compare equal. Same-numerator promos from
  // different series collide as candidates; name/visual disambiguates.
  const jp = n.match(/^(\d+)\/([a-z0-9-]+)$/);
  if (jp) return String(parseInt(jp[1], 10)).padStart(3, '0');
  return n;
}

export function extractCardNumber(text: string): string | null {
  // Collector number can be "023/131", "23/131", "023 / 131", "023 131" or
  // concatenated "023131".
  // We require a non-digit separator (slash or whitespace) so years like "2025"
  // don't get split into "20/25".
  const separatorPattern = /(\d{1,3})\s*(?:\/|\s)\s*(\d{2,3})/g;
  const concatPattern = /(\d{3})(\d{3})/g;

  const matches: Array<RegExpExecArray> = [
    ...Array.from(text.matchAll(separatorPattern)),
    ...Array.from(text.matchAll(concatPattern)),
  ];

  if (matches.length) {
    // The collector number is usually the leftmost NNN/NNN pattern in the
    // bottom text. Right-side text often contains set totals or copyright
    // years.
    for (let i = 0; i < matches.length; i++) {
      const left = matches[i][1];
      const right = matches[i][2];
      if (!left || !right) continue;

      const leftNum = parseInt(left, 10);
      const rightNum = parseInt(right, 10);
      const leftPadded = left.padStart(3, '0');
      const rightPadded = right.padStart(3, '0');

      // Secret-rare collector numbers can be higher than the printed set
      // total (e.g. 219/217), so do not reject left > right. A left side of 0
      // is never a real collector number ("0/026" comes from ©2026 noise).
      // Slash-separated matches accept small set totals (promo sets like 6/12
      // or 25/25); space-separated matches keep the higher floor since
      // "HP 60 20" style text can false-positive.
      if (leftNum < 1) continue;
      const hasSlash = matches[i][0].includes('/');
      if (hasSlash ? rightNum < 5 : rightNum < 30) continue;

      return `${leftPadded}/${rightPadded}`;
    }
  }

  // Japanese promo numbers print a letter-code denominator instead of a set
  // total ("001/M-P", "012/SV-P", "100/S-P", "007/XY-P"). Return the same
  // NNN/LETTERS form the catalog stores so normalizeNumber aligns both sides.
  const jpPromoPattern = /(\d{1,3})\s*\/\s*([a-z]{1,4}-?[a-z]{0,4})/gi;
  const jpPromoMatches = Array.from(text.matchAll(jpPromoPattern));
  if (jpPromoMatches.length) {
    const m = jpPromoMatches[0];
    const leftNum = parseInt(m[1], 10);
    if (leftNum >= 1) {
      return `${m[1].padStart(3, '0')}/${m[2].toUpperCase()}`;
    }
  }

  // Promo-style numbers without a set total: "SVP EN 200", "SVP200",
  // "SWSH123", "SM45". The language tag (EN/JP/...) may sit between the set
  // prefix and the digits, and OCR can insert a short junk token between
  // them ("SVP EN UE 200", "SVP B 200"). The junk slot is letters-only so it
  // can never eat leading digits of the number itself.
  const promoPattern =
    /\b(svp|swsh|sm|sv|xy|bw|hgss|dp|gg|tg|rc|ar|sh|rt|sl|pw|pr)\s*(?:en|jp|fr|de|it|es|pt|ko|ch)?\s*[a-z]{0,3}\s*0*(\d{1,3})\b/gi;
  const promoMatches = Array.from(text.matchAll(promoPattern));
  if (promoMatches.length) {
    const m = promoMatches[0];
    return `${m[1].toUpperCase()}${m[2].padStart(3, '0')}`;
  }

  // Modern set codes print the collector number bare with no set total
  // ("MEP EN 075" — the Mega Evolution promos). The catalog stores these as
  // just the number, so return the digits without the set-code prefix.
  const setCodePattern =
    /\b(mep|meg|asc|jtg|pre|paf|pfl|dri|obs|par|pal|sfa|scr|sst|svi|tef|twm|blk|wht)\s*(?:en|jp|fr|de|it|es|pt|ko|ch)?\s*[a-z]{0,3}\s*0*(\d{1,3})\b/gi;
  const setCodeMatches = Array.from(text.matchAll(setCodePattern));
  if (setCodeMatches.length) {
    const num = parseInt(setCodeMatches[0][2], 10);
    if (num >= 1) return setCodeMatches[0][2].padStart(3, '0');
  }

  return null;
}

// Hiragana/katakana/CJK in OCR output means the printed card name is
// Japanese — Latin fragments elsewhere on the card are frame noise rather
// than name evidence, and the name itself is unusable for text matching.
export function containsKana(text: string | null | undefined): boolean {
  return !!text && /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

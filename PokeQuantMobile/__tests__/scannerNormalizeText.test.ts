import { extractCardNumber, normalizeNumber, normalizeText } from '../src/scanner/utils/normalizeText';

describe('normalizeText', () => {
  it('lowercases and trims', () => {
    expect(normalizeText('  Pikachu  ')).toBe('pikachu');
  });

  it('removes quotes and dashes', () => {
    expect(normalizeText("Pika'chu-EX")).toBe('pikachuex');
  });

  it('collapses whitespace', () => {
    expect(normalizeText('Pikachu   VMAX')).toBe('pikachu vmax');
  });
});

describe('normalizeNumber — Japanese promo denominators', () => {
  it('canonicalizes letter-code denominators on both sides', () => {
    // Catalog and OCR forms of the same JP promo must compare equal.
    // The dash inside the letter code is stripped by normalizeText; what
    // matters is that catalog and OCR forms land on the same canonical key.
    expect(normalizeNumber('001/M-P')).toBe('001/mp');
    expect(normalizeNumber('012/SV-P')).toBe('012/svp');
    expect(normalizeNumber('100/S-P')).toBe('100/sp');
    expect(normalizeNumber('007/XY-P')).toBe('007/xyp');
  });

  it('keeps numeric NNN/NNN canonicalization unchanged', () => {
    expect(normalizeNumber('023/131')).toBe('23/131');
    expect(normalizeNumber('6/12')).toBe('6/12');
  });
});

describe('extractCardNumber — Japanese cards', () => {
  it('extracts letter-code promo denominators', () => {
    expect(extractCardNumber('Illus. X 001/M-P')).toBe('001/M-P');
    expect(extractCardNumber('foo 012/SV-P bar')).toBe('012/SV-P');
    expect(extractCardNumber('foo 100/S-P')).toBe('100/S-P');
    expect(extractCardNumber('foo 007/XY-P')).toBe('007/XY-P');
  });

  it('OCR-extracted promo form normalizes to the catalog form', () => {
    const ocr = extractCardNumber('001/M-P');
    expect(ocr).not.toBeNull();
    expect(normalizeNumber(ocr!)).toBe(normalizeNumber('001/M-P'));
  });

  it('still extracts JP main-set NNN/NNN numbers', () => {
    expect(extractCardNumber('025/198')).toBe('025/198');
  });

  it('does not invent letter denominators for plain EN text', () => {
    expect(extractCardNumber('Pikachu HP 60')).toBeNull();
  });
});

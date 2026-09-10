import { normalizeText } from '../src/utils/normalizeText';

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

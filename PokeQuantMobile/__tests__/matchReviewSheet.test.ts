import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { OtherMatchCard } from '../src/scanner/molecules/OtherMatchCard';
import { FinishChip } from '../src/scanner/molecules/FinishChip';
import { classifyDeal } from '../src/scanner/services/deal/dealClassify';
import { colors } from '../src/constants/colors';
import { mkSignal } from './helpers/builders';
import type { ReactTestInstance } from 'react-test-renderer';
import type { ScanCatalogCard, ScanCatalogVariant } from '../src/scanner/types/catalog';

const fs = require('node:fs');
const path = require('node:path');
declare const __dirname: string;

// Leaf pins for the MatchReviewSheet extraction: the row/chip render the
// same props the sheet used to inline — score formatting, selected ring,
// signal dot — and stay memo leaves.

const catalogCard = (over: Partial<ScanCatalogCard> = {}): ScanCatalogCard => ({
  productId: 1,
  name: 'Pikachu - 025/165',
  number: '025/165',
  set: 'SV151',
  rarity: 'Illustration Rare',
  imageUrl: 'file:///img.jpg',
  variants: [{ subType: 'Normal', marketPrice: 10, date: '2026-01-01' }],
  ...over,
});

const variant = (over: Partial<ScanCatalogVariant> = {}): ScanCatalogVariant => ({
  subType: 'Holofoil',
  marketPrice: 12.5,
  date: '2026-01-01',
  ...over,
});

const render = (el: Parameters<typeof create>[0]) => {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(el);
  });
  return renderer;
};

const textOf = (node: ReactTestInstance): string => {
  const kids = node.props.children;
  return (Array.isArray(kids) ? kids : [kids])
    .map((c: unknown) => (c == null || typeof c === 'object' ? '' : String(c)))
    .join('');
};

const flat = (n: ReactTestInstance) => StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>);

// Pressable loses import identity under jest-expo — the row's press
// target is the composite node carrying both onPress and a style prop
// (the leaf root also has onPress in props, but never a style).
const pressOf = (root: ReactTestInstance): ReactTestInstance =>
  root.findAll((n) => typeof n.props.onPress === 'function' && n.props.style != null)[0];

describe('OtherMatchCard', () => {
  test('renders image, display name · number, and score % — press fires onPress', () => {
    const onPress = jest.fn();
    const root = render(
      createElement(OtherMatchCard, {
        card: catalogCard(),
        score: 0.874,
        onPress,
      }),
    ).root;

    expect(root.findAllByType(Image)).toHaveLength(1);
    const texts = root.findAllByType(Text).map(textOf);
    expect(texts).toContain('Pikachu · 025/165');
    expect(texts).toContain('87% sure');
    expect(texts).toContain('SV151'); // SetBadge

    act(() => (pressOf(root).props.onPress as () => void)());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('null score renders the slot empty; unresolvable image renders the placeholder', () => {
    // productId 0 + empty imageUrl → getCatalogImageUri returns undefined.
    const root = render(
      createElement(OtherMatchCard, {
        card: catalogCard({ productId: 0, imageUrl: '' }),
        score: null,
        onPress: jest.fn(),
      }),
    ).root;

    expect(root.findAllByType(Image)).toHaveLength(0);
    const placeholder = root.findAll(
      (n) =>
        n.type === View && flat(n)?.backgroundColor === colors.surface && flat(n)?.width === 34,
    );
    expect(placeholder).toHaveLength(1);
    expect(root.findAllByType(Text).map(textOf)).toContain('');
  });

  test('selected adds the primary border ring', () => {
    const press = pressOf(
      render(
        createElement(OtherMatchCard, {
          card: catalogCard(),
          score: 0.5,
          selected: true,
          onPress: jest.fn(),
        }),
      ).root,
    );

    expect(flat(press)?.borderColor).toBe(colors.primary);
  });

  test('is a memo leaf', () => {
    expect((OtherMatchCard as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('FinishChip', () => {
  test('renders subtype + price; press returns the subtype', () => {
    const onPress = jest.fn();
    const root = render(
      createElement(FinishChip, { variant: variant(), selected: false, onPress }),
    ).root;

    const texts = root.findAllByType(Text).map(textOf);
    expect(texts).toContain('Holofoil');
    expect(texts).toContain('$12.50');

    act(() => (pressOf(root).props.onPress as () => void)());
    expect(onPress).toHaveBeenCalledWith('Holofoil');
  });

  test('rated variant paints the deal-class dot; unrated does not', () => {
    const signal = mkSignal({ action: 'BUY', subType: 'Holofoil' });
    const rated = render(
      createElement(FinishChip, {
        variant: variant({ signal }),
        selected: false,
        onPress: jest.fn(),
      }),
    ).root;
    const dot = rated.findAll(
      (n) => n.type === View && flat(n)?.backgroundColor === classifyDeal(signal).color,
    );
    expect(dot).toHaveLength(1);

    for (const sig of [undefined, mkSignal({ action: 'UNRATED' })]) {
      const unrated = render(
        createElement(FinishChip, {
          variant: variant({ signal: sig }),
          selected: false,
          onPress: jest.fn(),
        }),
      ).root;
      const dots = unrated.findAll(
        (n) => n.type === View && flat(n)?.width === 7 && flat(n)?.borderRadius === 4,
      );
      expect(dots).toHaveLength(0);
    }
  });

  test('selected adds the primary border ring', () => {
    const press = pressOf(
      render(
        createElement(FinishChip, {
          variant: variant(),
          selected: true,
          onPress: jest.fn(),
        }),
      ).root,
    );

    expect(flat(press)?.borderColor).toBe(colors.primary);
  });

  test('is a memo leaf', () => {
    expect((FinishChip as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});

test('MatchReviewSheet delegates — leaves and styles sibling own the render blocks', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'scanner', 'molecules', 'MatchReviewSheet.tsx'),
    'utf8',
  );
  expect(src).toContain('<OtherMatchCard');
  expect(src).toContain('<FinishChip');
  expect(src).toContain("'./matchReviewSheetStyles'");
  expect(src).not.toMatch(/StyleSheet\.create/);
  expect(src).not.toContain('classifyDeal');
});

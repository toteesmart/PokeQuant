import { act, createElement } from 'react';
import { Alert, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { create } from 'react-test-renderer';
import { mkCatalogCard } from './helpers/builders';
import { renderHook } from './helpers/renderHook';
import type { SearchLogPayload } from '../src/components/SearchCard';
import { Dropdown } from '../src/components/Dropdown';
import { SearchFiltersCard } from '../src/components/SearchFiltersCard';
import { useSearchBuyActions } from '../src/hooks/useSearchBuyActions';
import { LANGUAGES, PRODUCT_TYPES, RARITIES, SORT_OPTIONS } from '../src/hooks/useCatalogSearch';
import type { ScoutCandidate } from '../src/scanner/services/deal/buyScout';
import type { DealRead } from '../src/scanner/services/deal/types';
import { useAuthStore } from '../src/store/authStore';
import { useInventoryStore, type InventoryInput } from '../src/store/inventoryStore';

/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require; tsconfig ships no node types */
const fs = require('node:fs');
const path = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;

// useSearchBuyActions — the three callbacks extracted verbatim from
// SearchBuyScreen. openAnalysis is injected (useAnalysisSheet is
// useState-scoped — a second instance inside the hook would open a sheet
// the screen never renders), so the tests capture the CardRef the hook
// hands it. addInventoryCard/refreshInventoryState are swapped for
// jest.fns on the real store; useAuthStore drives the userId guard.
//
// SearchFiltersCard — the Disclosure body extracted as a memo leaf; pins
// cover the per-row onSelect→setter wiring and the load-bearing 3/2/1
// zIndex stack (an open Dropdown sheet renders inside its row).

jest.mock('../src/components/ui', () => ({ GlassSheet: 'GlassSheet' }));

const realAdd = useInventoryStore.getState().addInventoryCard;
const realRefresh = useInventoryStore.getState().refreshInventoryState;
const realUserId = useAuthStore.getState().userId;

const mockAdd = jest.fn(async (_input: InventoryInput) => {});
const mockRefresh = jest.fn(async () => {});
const openAnalysis = jest.fn();
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

const payload: SearchLogPayload = {
  productId: 610378,
  cardName: 'Pikachu',
  cardNumber: '025',
  setName: 'SV151',
  variant: 'Holofoil',
  condition: 'NM',
  liveMarket: 10,
  cashOffer: 7,
  stickerPrice: 12,
  imageUrl: 'https://img.example/pika.jpg',
};

const stubRead: DealRead = {
  cls: 'DIP_BUY',
  label: 'Dip',
  headline: '',
  color: '',
  risk: 'good',
  offerLoFactor: 0.95,
  offerHiFactor: 1.05,
  script: '',
};

const scoutCard: ScoutCandidate = {
  productId: 610378,
  subType: 'Reverse Holofoil',
  name: "Farfetch'd",
  number: '132',
  set: 'Base Set',
  rarity: 'Rare',
  price: 8.25,
  read: stubRead,
  score: 41,
  stat: '30d -18%',
  why: 'sitting under the floor',
  owned: false,
};

const setup = () => renderHook((open) => useSearchBuyActions(open), openAnalysis);

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ userId: 'u1' });
  useInventoryStore.setState({
    addInventoryCard: mockAdd,
    refreshInventoryState: mockRefresh,
  });
});

afterAll(() => {
  useAuthStore.setState({ userId: realUserId });
  useInventoryStore.setState({
    addInventoryCard: realAdd,
    refreshInventoryState: realRefresh,
  });
});

// ---------- handleLogToInventory ----------

test('log maps the payload verbatim — rarity AND productType both take the variant', async () => {
  const { result } = setup();

  await act(async () => {
    await result.current.handleLogToInventory(payload);
  });

  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd).toHaveBeenCalledWith({
    name: 'Pikachu',
    number: '025',
    set: 'SV151',
    rarity: 'Holofoil',
    productType: 'Holofoil',
    condition: 'NM',
    liveMarket: 10,
    amountPaid: 7,
    stickerPrice: 12,
    imageUrl: 'https://img.example/pika.jpg',
    productId: 610378,
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  // Write resolves before the refresh runs.
  expect(mockAdd.mock.invocationCallOrder[0]).toBeLessThan(mockRefresh.mock.invocationCallOrder[0]);
  expect(alertSpy).toHaveBeenCalledWith('Added', 'Pikachu is in your inventory.');
});

test('a failed write skips the refresh and alerts instead of confirming', async () => {
  mockAdd.mockRejectedValueOnce('quota hit');
  const { result } = setup();

  await act(async () => {
    await result.current.handleLogToInventory(payload);
  });

  expect(mockRefresh).not.toHaveBeenCalled();
  expect(alertSpy).toHaveBeenCalledTimes(1);
  expect(alertSpy).toHaveBeenCalledWith("Couldn't add card", 'quota hit');
  expect(errSpy).toHaveBeenCalledWith('Log to inventory failed:', 'quota hit');
});

test('signed-out guard alerts and makes zero store calls', async () => {
  useAuthStore.setState({ userId: null });
  const { result } = setup();

  await act(async () => {
    await result.current.handleLogToInventory(payload);
  });

  expect(alertSpy).toHaveBeenCalledTimes(1);
  expect(alertSpy).toHaveBeenCalledWith(
    'Not signed in',
    'Sign in to save cards to your inventory.',
  );
  expect(mockAdd).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

// ---------- handleScoutSelect ----------

test('scout select maps the candidate onto a CardRef and opens analysis on its subtype', () => {
  const { result } = setup();

  act(() => result.current.handleScoutSelect(scoutCard));

  expect(openAnalysis).toHaveBeenCalledTimes(1);
  expect(openAnalysis).toHaveBeenCalledWith(
    {
      productId: 610378,
      name: "Farfetch'd",
      number: '132',
      set: 'Base Set',
      rarity: 'Rare',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/610378_400w.jpg',
      subType: 'Reverse Holofoil',
      marketPrice: 8.25,
    },
    'Reverse Holofoil',
  );
});

// ---------- handleAnalyze ----------

test('analyze opens the tapped variant at its own market price', () => {
  const card = mkCatalogCard({
    productId: 42,
    name: 'Pikachu',
    number: '025',
    set: 'SV151',
    rarity: 'Illustration Rare',
    imageUrl: 'https://img.example/42.jpg',
    liveMarket: 10,
    variants: [
      { subType: 'Normal', marketPrice: 10 },
      { subType: 'Holofoil', marketPrice: 18 },
    ],
  });
  const { result } = setup();

  act(() => result.current.handleAnalyze(card, 'Holofoil'));

  expect(openAnalysis).toHaveBeenCalledWith(
    {
      productId: 42,
      name: 'Pikachu',
      number: '025',
      set: 'SV151',
      rarity: 'Illustration Rare',
      imageUrl: 'https://img.example/42.jpg',
      subType: 'Holofoil',
      marketPrice: 18,
    },
    'Holofoil',
  );
});

test('analyze falls back to liveMarket when the variant has no row', () => {
  const card = mkCatalogCard({ liveMarket: 10, variants: [] });
  const { result } = setup();

  act(() => result.current.handleAnalyze(card, '1st Edition'));

  expect(openAnalysis).toHaveBeenCalledWith(
    expect.objectContaining({ subType: '1st Edition', marketPrice: 10 }),
    '1st Edition',
  );
});

// ---------- SearchFiltersCard ----------

const mkProps = () => ({
  rarity: 'Rare',
  setRarity: jest.fn(),
  productType: 'Cards Only',
  setProductType: jest.fn(),
  language: 'English',
  setLanguage: jest.fn(),
  sortBy: 'Newest',
  setSortBy: jest.fn(),
  maxPrice: '50',
  setMaxPrice: jest.fn(),
});

test('SearchFiltersCard wires each control to its own setter, rows stacked 3/2/1', () => {
  const props = mkProps();
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(SearchFiltersCard, props));
  });
  const root = renderer.root;

  const dropdowns = root.findAllByType(Dropdown);
  expect(dropdowns).toHaveLength(4);
  const [rarityDD, typeDD, langDD, sortDD] = dropdowns;
  expect(rarityDD.props.options).toBe(RARITIES);
  expect(rarityDD.props.value).toBe('Rare');
  expect(rarityDD.props.onSelect).toBe(props.setRarity);
  expect(typeDD.props.options).toBe(PRODUCT_TYPES);
  expect(typeDD.props.value).toBe('Cards Only');
  expect(typeDD.props.onSelect).toBe(props.setProductType);
  expect(langDD.props.options).toBe(LANGUAGES);
  expect(langDD.props.value).toBe('English');
  expect(langDD.props.onSelect).toBe(props.setLanguage);
  expect(sortDD.props.options).toBe(SORT_OPTIONS);
  expect(sortDD.props.value).toBe('Newest');
  expect(sortDD.props.onSelect).toBe(props.setSortBy);

  const priceInput = root.findByType(TextInput);
  expect(priceInput.props.value).toBe('50');
  expect(priceInput.props.keyboardType).toBe('numeric');
  expect(priceInput.props.onChangeText).toBe(props.setMaxPrice);

  const rows = root.findAll(
    (n) =>
      n.type === View &&
      Array.isArray(n.props.style) &&
      n.props.style.some((s: unknown) => s != null && typeof s === 'object' && 'zIndex' in s),
  );
  const flat = (r: (typeof rows)[number]) =>
    StyleSheet.flatten(r.props.style as StyleProp<ViewStyle>);
  expect(rows.map((r) => flat(r)?.zIndex)).toEqual([3, 2, 1]);
  expect(flat(rows[2])?.marginBottom).toBe(0);
});

test('SearchFiltersCard is a memo leaf', () => {
  expect((SearchFiltersCard as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
});

test('SearchBuyScreen delegates — no alert or filter JSX left inline', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'screens', 'SearchBuyScreen.tsx'),
    'utf8',
  );
  expect(src).toContain('useSearchBuyActions(');
  expect(src).toContain('<SearchFiltersCard');
  expect(src).not.toMatch(/Alert\.alert/);
  expect(src).not.toContain('styles.filterRow');
});

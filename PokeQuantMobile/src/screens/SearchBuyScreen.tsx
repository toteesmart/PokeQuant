import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { Dropdown } from '../components/Dropdown';
import { CartDrawer } from '../components/CartDrawer';
import { useCart } from '../context/CartContext';
import { useInventory } from '../context/InventoryContext';
import { useVendorSettings } from '../context/VendorSettingsContext';

type SearchCard = {
  id: string;
  name: string;
  number: string;
  set: string;
  rarity: string;
  productType: string;
  liveMarket: number;
};

const RARITIES = ['All', 'Common', 'Uncommon', 'Rare', 'Holo Rare', 'Ultra Rare', 'Secret Rare'];
const SORT_OPTIONS = ['Newest', 'Price: Low to High', 'Price: High to Low', 'Name A-Z'];
const PRODUCT_TYPES = ['All', 'Pokemon', 'Trainer', 'Energy'];

const DUMMY_CARDS: SearchCard[] = [
  { id: '1', name: 'Pikachu ex', number: 'PA 094', set: 'Paldea Evolved', rarity: 'Double Rare', productType: 'Pokemon', liveMarket: 9.1 },
  { id: '2', name: 'Charizard ex', number: 'OB 054', set: 'Obsidian Flames', rarity: 'Double Rare', productType: 'Pokemon', liveMarket: 25.5 },
  { id: '3', name: 'Blastoise ex', number: 'CN 176', set: 'Champions Mindset', rarity: 'Double Rare', productType: 'Pokemon', liveMarket: 12.34 },
  { id: '4', name: 'Mewtwo ex', number: 'GG 082', set: 'Gripping Genesis', rarity: 'Double Rare', productType: 'Pokemon', liveMarket: 18.2 },
  { id: '5', name: 'Boss\'s Orders', number: 'SS 154', set: 'Silver Tempest', rarity: 'Holo Rare', productType: 'Trainer', liveMarket: 3.5 },
  { id: '6', name: 'Rare Candy', number: 'SV 191', set: 'Scarlet & Violet', rarity: 'Uncommon', productType: 'Trainer', liveMarket: 2.1 },
  { id: '7', name: 'Lugia V', number: '186/195', set: 'Silver Tempest', rarity: 'Ultra Rare', productType: 'Pokemon', liveMarket: 55.0 },
  { id: '8', name: 'Giratina VSTAR', number: 'LM 080', set: 'Lost Memory', rarity: 'Secret Rare', productType: 'Pokemon', liveMarket: 48.0 },
  { id: '9', name: 'Basic Fire Energy', number: 'EN 001', set: 'Energy', rarity: 'Common', productType: 'Energy', liveMarket: 0.25 },
  { id: '10', name: 'Rayquaza V', number: 'AA 145', set: 'Alt Arts', rarity: 'Ultra Rare', productType: 'Pokemon', liveMarket: 42.0 },
  { id: '11', name: 'Professor\'s Research', number: 'SV 189', set: 'Scarlet & Violet', rarity: 'Holo Rare', productType: 'Trainer', liveMarket: 2.8 },
  { id: '12', name: 'Mew ex', number: 'ME 032', set: 'Mew Expansion', rarity: 'Double Rare', productType: 'Pokemon', liveMarket: 15.0 },
];

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function SearchResultCard({
  card,
  width,
  onLogToInventory,
  onLogToCart,
}: {
  card: SearchCard;
  width: number;
  onLogToInventory: (card: SearchCard) => void;
  onLogToCart: (card: SearchCard) => void;
}) {
  const { getCashOffer } = useVendorSettings();
  const offer = getCashOffer(card.liveMarket);

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.thumb}>
        <Text style={styles.thumbText}>IMG</Text>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {card.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {card.number} · {card.set} · {card.rarity} · {card.productType}
      </Text>
      <View style={styles.priceRow}>
        <View style={styles.priceCol}>
          <Text style={styles.priceLabel}>
            Market{' '}
            <Text style={styles.priceValue}>{formatCurrency(card.liveMarket)}</Text>
          </Text>
        </View>
        <View style={[styles.priceCol, { alignItems: 'flex-end' }]}>
          <Text style={styles.priceLabel}>
            Offer{' '}
            <Text style={styles.offerValue}>{formatCurrency(offer)}</Text>
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.inventoryButton]}
          activeOpacity={0.7}
          onPress={() => onLogToInventory(card)}>
          <Text style={styles.actionButtonText}>Log to Inventory</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.cartButton]}
          activeOpacity={0.7}
          onPress={() => onLogToCart(card)}>
          <Text style={styles.actionButtonText}>Log to Cart</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SearchPage({
  page,
  pageWidth,
  pageHeight,
  onLogToInventory,
  onLogToCart,
}: {
  page: SearchCard[];
  pageWidth: number;
  pageHeight: number;
  onLogToInventory: (card: SearchCard) => void;
  onLogToCart: (card: SearchCard) => void;
}) {
  const cardWidth = (pageWidth - 40) / 2;
  const top = page.slice(0, 2);
  const bottom = page.slice(2, 4);

  return (
    <View style={[styles.page, { width: pageWidth, height: pageHeight }]}>
      <View style={styles.row}>
        {top.map((card) => (
          <SearchResultCard
            key={card.id}
            card={card}
            width={cardWidth}
            onLogToInventory={onLogToInventory}
            onLogToCart={onLogToCart}
          />
        ))}
      </View>
      <View style={styles.row}>
        {bottom.map((card) => (
          <SearchResultCard
            key={card.id}
            card={card}
            width={cardWidth}
            onLogToInventory={onLogToInventory}
            onLogToCart={onLogToCart}
          />
        ))}
      </View>
    </View>
  );
}

export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
  const [pageHeight, setPageHeight] = useState(0);
  const { addToCart } = useCart();
  const { addInventoryCard } = useInventory();

  const [query, setQuery] = useState('');

  const filterQuery = query;
  const [expanded, setExpanded] = useState(false);
  const [rarity, setRarity] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [productType, setProductType] = useState('All');
  const [maxPrice, setMaxPrice] = useState('');

  const handleLogToInventory = useCallback(
    (card: SearchCard) => addInventoryCard({ ...card }),
    [addInventoryCard]
  );
  const handleLogToCart = useCallback(
    (card: SearchCard) => addToCart({ ...card }),
    [addToCart]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = filterQuery.trim().toLowerCase();
    const max = parseFloat(maxPrice);

    let result = DUMMY_CARDS.filter((card) => {
      const matchesQuery =
        !normalizedQuery ||
        [card.name, card.number, card.set].some((field) =>
          field.toLowerCase().includes(normalizedQuery)
        );
      const matchesRarity = rarity === 'All' || card.rarity === rarity;
      const matchesType = productType === 'All' || card.productType === productType;
      const matchesMax = !maxPrice || isNaN(max) || card.liveMarket <= max;
      return matchesQuery && matchesRarity && matchesType && matchesMax;
    });

    switch (sortBy) {
      case 'Price: Low to High':
        result = [...result].sort((a, b) => a.liveMarket - b.liveMarket);
        break;
      case 'Price: High to Low':
        result = [...result].sort((a, b) => b.liveMarket - a.liveMarket);
        break;
      case 'Name A-Z':
        result = [...result].sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        break;
    }

    return result;
  }, [filterQuery, rarity, sortBy, productType, maxPrice]);

  const pages: SearchCard[][] = [];
  for (let i = 0; i < filtered.length; i += 4) {
    pages.push(filtered.slice(i, i + 4));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.searchInput}
          placeholder="e.g. Pikachu 276, Mega Latias 100"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
        />

        <TouchableOpacity
          style={styles.filterToggle}
          activeOpacity={0.7}
          onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.filterToggleText}>
            Advanced Filters & Sorting
          </Text>
          <Text style={styles.filterToggleChevron}>
            {expanded ? '▲' : '▼'}
          </Text>
        </TouchableOpacity>

        {expanded && (
          <View style={styles.filters}>
            <View style={styles.filterRow}>
              <View style={styles.filterCell}>
                <Dropdown
                  label="Rarity"
                  options={RARITIES}
                  value={rarity}
                  onChange={setRarity}
                />
              </View>
              <View style={styles.filterCell}>
                <Dropdown
                  label="Sort By"
                  options={SORT_OPTIONS}
                  value={sortBy}
                  onChange={setSortBy}
                />
              </View>
            </View>
            <View style={styles.filterRow}>
              <View style={styles.filterCell}>
                <Dropdown
                  label="Product Type"
                  options={PRODUCT_TYPES}
                  value={productType}
                  onChange={setProductType}
                />
              </View>
              <View style={styles.filterCell}>
                <Text style={styles.filterLabel}>Max Market Price</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="e.g. 50"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  value={maxPrice}
                  onChangeText={setMaxPrice}
                />
              </View>
            </View>
          </View>
        )}

        <Text style={styles.resultsCount}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <View
        style={styles.carouselWrapper}
        onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        {pages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No cards match your filters.
            </Text>
          </View>
        ) : (
          <FlatList
            data={pages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.carousel}
            extraData={pageHeight}
            getItemLayout={(_, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            keyExtractor={(_, index) => String(index)}
            renderItem={({ item }) => (
              <SearchPage
                page={item}
                pageWidth={width}
                pageHeight={pageHeight}
                onLogToInventory={handleLogToInventory}
                onLogToCart={handleLogToCart}
              />
            )}
          />
        )}
      </View>

      <CartDrawer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  filterToggleText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  filterToggleChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  filters: {
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  filterCell: {
    flex: 1,
    marginHorizontal: 4,
  },
  filterLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  numberInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
  },
  resultsCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  carouselWrapper: {
    flex: 1,
    minHeight: 352,
  },
  carousel: {
    flex: 1,
  },
  page: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    alignSelf: 'stretch',
    minHeight: 160,
  },
  thumb: {
    flex: 1,
    minHeight: 50,
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  thumbText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  cardName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  priceCol: {
    flex: 1,
  },
  priceLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
  },
  priceValue: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: 'bold',
  },
  offerValue: {
    color: colors.success,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: 'bold',
  },
  actions: {
    marginTop: 0,
  },
  actionButton: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  inventoryButton: {
    backgroundColor: colors.success,
    marginBottom: 4,
  },
  cartButton: {
    backgroundColor: colors.primary,
  },
  actionButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: 'bold',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});

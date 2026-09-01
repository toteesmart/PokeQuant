import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
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
  imageUrl?: string;
  condition?: string;
  velocity1d: number;
  velocity3d: number;
  velocity7d: number;
  velocity30d: number;
  range90dHigh: number;
  range90dLow: number;
};

const RARITIES = ['All', 'Common', 'Uncommon', 'Rare', 'Holo Rare', 'Ultra Rare', 'Secret Rare'];
const SORT_OPTIONS = ['Newest', 'Price: Low to High', 'Price: High to Low', 'Name A-Z'];
const PRODUCT_TYPES = ['All', 'Pokemon', 'Trainer', 'Energy'];
const CONDITIONS = ['NM', 'LP', 'MP', 'HP'];

const DUMMY_CARDS: SearchCard[] = [
  {
    id: '1',
    name: "Pikachu ex",
    number: '094/182',
    set: 'Prismatic Evolutions',
    rarity: 'Double Rare',
    productType: 'Pokemon',
    liveMarket: 12.5,
    velocity1d: 2.35,
    velocity3d: -1.2,
    velocity7d: 5.4,
    velocity30d: -3.15,
    range90dHigh: 15.0,
    range90dLow: 9.8,
  },
  {
    id: '2',
    name: "Charizard ex",
    number: '054/197',
    set: 'Mega Evolution—Pitch Black',
    rarity: 'Double Rare',
    productType: 'Pokemon',
    liveMarket: 38.0,
    velocity1d: -0.8,
    velocity3d: 3.5,
    velocity7d: 8.2,
    velocity30d: 12.4,
    range90dHigh: 45.0,
    range90dLow: 30.5,
  },
  {
    id: '3',
    name: "Blastoise ex",
    number: '176/198',
    set: 'Mega Evolution—Pitch Black',
    rarity: 'Double Rare',
    productType: 'Pokemon',
    liveMarket: 14.25,
    velocity1d: 0.5,
    velocity3d: 0.5,
    velocity7d: -2.1,
    velocity30d: 1.8,
    range90dHigh: 18.0,
    range90dLow: 11.25,
  },
  {
    id: '4',
    name: "Venusaur ex",
    number: '003/191',
    set: 'Prismatic Evolutions',
    rarity: 'Double Rare',
    productType: 'Pokemon',
    liveMarket: 9.8,
    velocity1d: -1.5,
    velocity3d: -2.2,
    velocity7d: 0.9,
    velocity30d: -5.4,
    range90dHigh: 13.0,
    range90dLow: 8.5,
  },
  {
    id: '5',
    name: "Mewtwo ex",
    number: '082/162',
    set: 'Mega Evolution—Pitch Black',
    rarity: 'Double Rare',
    productType: 'Pokemon',
    liveMarket: 22.4,
    velocity1d: 1.1,
    velocity3d: 2.8,
    velocity7d: -0.5,
    velocity30d: 4.2,
    range90dHigh: 28.0,
    range90dLow: 19.0,
  },
  {
    id: '6',
    name: "Mew ex",
    number: '032/165',
    set: 'Prismatic Evolutions',
    rarity: 'Double Rare',
    productType: 'Pokemon',
    liveMarket: 15.6,
    velocity1d: 0.0,
    velocity3d: 1.4,
    velocity7d: 3.3,
    velocity30d: -1.8,
    range90dHigh: 19.5,
    range90dLow: 13.2,
  },
  {
    id: '7',
    name: "Umbreon VMAX",
    number: '215/203',
    set: 'Mega Evolution—Pitch Black',
    rarity: 'Special Illustration Rare',
    productType: 'Pokemon',
    liveMarket: 28.5,
    velocity1d: -2.5,
    velocity3d: -4.1,
    velocity7d: -6.8,
    velocity30d: 9.5,
    range90dHigh: 38.0,
    range90dLow: 24.0,
  },
  {
    id: '8',
    name: "Lugia V",
    number: '186/195',
    set: 'Prismatic Evolutions',
    rarity: 'Ultra Rare',
    productType: 'Pokemon',
    liveMarket: 52.0,
    velocity1d: 3.2,
    velocity3d: 1.5,
    velocity7d: 4.4,
    velocity30d: 15.2,
    range90dHigh: 65.0,
    range90dLow: 42.0,
  },
  {
    id: '9',
    name: "Rayquaza V",
    number: '145/203',
    set: 'Prismatic Evolutions',
    rarity: 'Ultra Rare',
    productType: 'Pokemon',
    liveMarket: 35.0,
    velocity1d: -0.3,
    velocity3d: 2.1,
    velocity7d: 1.2,
    velocity30d: 7.8,
    range90dHigh: 44.0,
    range90dLow: 29.5,
  },
  {
    id: '10',
    name: "Giratina VSTAR",
    number: '080/196',
    set: 'Mega Evolution—Pitch Black',
    rarity: 'Secret Rare',
    productType: 'Pokemon',
    liveMarket: 41.3,
    velocity1d: 1.8,
    velocity3d: -0.9,
    velocity7d: 2.5,
    velocity30d: 5.6,
    range90dHigh: 52.0,
    range90dLow: 36.0,
  },
  {
    id: '11',
    name: "Professor's Research",
    number: '189/198',
    set: 'Prismatic Evolutions',
    rarity: 'Holo Rare',
    productType: 'Trainer',
    liveMarket: 3.2,
    velocity1d: 0.1,
    velocity3d: -0.5,
    velocity7d: 0.2,
    velocity30d: -1.2,
    range90dHigh: 4.5,
    range90dLow: 2.8,
  },
  {
    id: '12',
    name: 'Rare Candy',
    number: '191/198',
    set: 'Prismatic Evolutions',
    rarity: 'Uncommon',
    productType: 'Trainer',
    liveMarket: 2.5,
    velocity1d: -0.2,
    velocity3d: 0.0,
    velocity7d: -0.8,
    velocity30d: 0.5,
    range90dHigh: 3.5,
    range90dLow: 1.9,
  },
  {
    id: '13',
    name: 'Basic Fire Energy',
    number: '001/198',
    set: 'Mega Evolution—Pitch Black',
    rarity: 'Common',
    productType: 'Energy',
    liveMarket: 0.3,
    velocity1d: 0.0,
    velocity3d: 0.0,
    velocity7d: 0.0,
    velocity30d: 0.0,
    range90dHigh: 0.5,
    range90dLow: 0.2,
  },
];

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatVelocity(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function VelocityPill({ label, value }: { label: string; value: number }) {
  const color =
    value === 0
      ? colors.metricLabel
      : value > 0
      ? colors.velocityPositive
      : colors.velocityNegative;
  return (
    <View style={styles.velocityPill}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[styles.velocityValue, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit={true}>
        {formatVelocity(value)}
      </Text>
    </View>
  );
}

function CardImage({ imageUrl }: { imageUrl?: string }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.image}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <Image
      source={require('../../logo.png')}
      style={styles.image}
      resizeMode="contain"
    />
  );
}

function SearchResultCard({
  card,
  width,
  marginHorizontal,
  onLogToInventory,
  onLogToCart,
}: {
  card: SearchCard;
  width: number;
  marginHorizontal: number;
  onLogToInventory: (card: SearchCard, condition: string) => void;
  onLogToCart: (card: SearchCard) => void;
}) {
  const { getCashOffer } = useVendorSettings();
  const offer = getCashOffer(card.liveMarket);
  const [condition, setCondition] = useState(card.condition || 'NM');

  return (
    <View style={[styles.card, { width, marginHorizontal }]}>
      <View style={styles.topBlock}>
        <View style={styles.imageContainer}>
          <CardImage imageUrl={card.imageUrl} />
        </View>

        <Text style={styles.cardName} numberOfLines={1}>
          {card.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {card.number} · {card.set} · {card.rarity}
        </Text>
      </View>

      <View style={styles.metrics}>
        <View style={styles.priceStack}>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>NM Market</Text>
            <Text style={styles.metricValue}>
              {formatCurrency(card.liveMarket)}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Offer</Text>
            <Text style={styles.offerValue}>{formatCurrency(offer)}</Text>
          </View>
        </View>

        <View style={styles.velocityRow}>
          <VelocityPill label="1d" value={card.velocity1d} />
          <VelocityPill label="3d" value={card.velocity3d} />
          <VelocityPill label="7d" value={card.velocity7d} />
          <VelocityPill label="30d" value={card.velocity30d} />
        </View>

        <View style={styles.rangeRow}>
          <Text style={styles.metricLabel}>90-Day Range</Text>
          <Text style={styles.rangeValue} numberOfLines={1}>
            {formatCurrency(card.range90dLow)} — {formatCurrency(card.range90dHigh)}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <View style={styles.conditionDropdown}>
          <Dropdown
            label="Condition"
            options={CONDITIONS}
            value={condition}
            onChange={setCondition}
          />
        </View>

        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.actionButton, styles.inventoryButton]}
            activeOpacity={0.7}
            onPress={() => onLogToInventory(card, condition)}>
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
    </View>
  );
}

export function SearchBuyScreen() {
  const { width } = useWindowDimensions();
  const { addToCart } = useCart();
  const { addInventoryCard } = useInventory();

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [rarity, setRarity] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [productType, setProductType] = useState('All');
  const [maxPrice, setMaxPrice] = useState('');

  const handleLogToInventory = useCallback(
    (card: SearchCard, condition: string) =>
      addInventoryCard({ ...card, condition }),
    [addInventoryCard]
  );
  const handleLogToCart = useCallback(
    (card: SearchCard) => addToCart({ ...card }),
    [addToCart]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
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
  }, [query, rarity, sortBy, productType, maxPrice]);

  const cardWidth = width * 0.47;
  const cardMargin = width * 0.01;
  const cardSlot = cardWidth + 2 * cardMargin;

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
          <Text style={styles.filterToggleText}>Advanced Filters & Sorting</Text>
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

      <View style={styles.carouselWrapper}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No cards match your filters.</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            horizontal
            pagingEnabled={false}
            snapToInterval={cardSlot}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            getItemLayout={(_, index) => ({
              length: cardSlot,
              offset: cardSlot * index,
              index,
            })}
            initialNumToRender={6}
            style={styles.carousel}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <SearchResultCard
                card={item}
                width={cardWidth}
                marginHorizontal={cardMargin}
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
  listContent: {
    paddingVertical: 8,
    alignItems: 'stretch',
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
  card: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    minHeight: 360,
  },
  topBlock: {
    marginBottom: 6,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 2.5 / 3.5,
    backgroundColor: colors.surfaceLight,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
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
  },
  metrics: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 4,
    paddingBottom: 10,
  },
  priceStack: {
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  metricLabel: {
    color: colors.metricLabel,
    fontSize: 11,
    lineHeight: 14,
  },
  metricValue: {
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
  velocityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  velocityPill: {
    flex: 1,
    alignItems: 'center',
  },
  velocityValue: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 'bold',
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rangeValue: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 'bold',
  },
  actions: {
    width: '100%',
    minHeight: 150,
  },
  conditionDropdown: {
    marginBottom: 4,
  },
  buttonGroup: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  actionButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 13,
    fontWeight: 'bold',
  },
});

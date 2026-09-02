import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
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
import { openCatalogDatabase, searchCatalogCards, type CatalogFilters } from '../db/catalogDb';
import type { SQLiteDatabase } from 'expo-sqlite';

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
  productId: number;
};

const RARITIES = ['All', 'Common', 'Uncommon', 'Rare', 'Holo Rare', 'Ultra Rare', 'Secret Rare'];
const SORT_OPTIONS = ['Newest', 'Price: Low to High', 'Price: High to Low', 'Name A-Z'];
const CONDITIONS = ['NM', 'LP', 'MP', 'HP'];

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatVelocity(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\'\-.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  const [catalogDb, setCatalogDb] = useState<SQLiteDatabase | null>(null);
  const [isCatalogReady, setIsCatalogReady] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchCard[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [rarity, setRarity] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [maxPrice, setMaxPrice] = useState('');

  const searchIdRef = useRef(0);

  // Open (and download, if missing) the read-only catalog database once.
  useEffect(() => {
    let mounted = true;
    openCatalogDatabase()
      .then((db) => {
        if (!mounted) return;
        setCatalogDb(db);
        setIsCatalogReady(true);
      })
      .catch((err) => {
        if (mounted) {
          setSearchError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Live search against the downloaded SQLite catalog.
  useEffect(() => {
    if (!catalogDb || !isCatalogReady) return;

    const normalized = normalizeSearch(query);
    if (!normalized) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const thisId = ++searchIdRef.current;
    setIsSearching(true);
    setSearchError(null);

    const timeout = setTimeout(() => {
      const max = Number.parseFloat(maxPrice);
      const filters: CatalogFilters = {
        query,
        rarity,
        sortBy: sortBy as CatalogFilters['sortBy'],
        maxPrice:
          maxPrice.trim() !== '' && !Number.isNaN(max) ? max : undefined,
      };

      searchCatalogCards(catalogDb, filters, 50)
        .then((cards) => {
          if (thisId !== searchIdRef.current) return;
          setSearchResults(cards);
        })
        .catch((err) => {
          if (thisId !== searchIdRef.current) return;
          setSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (thisId !== searchIdRef.current) return;
          setIsSearching(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [catalogDb, isCatalogReady, query, rarity, sortBy, maxPrice]);

  const handleLogToInventory = useCallback(
    (card: SearchCard, condition: string) =>
      addInventoryCard({ ...card, condition }),
    [addInventoryCard]
  );

  const handleLogToCart = useCallback(
    (card: SearchCard) => addToCart({ ...card }),
    [addToCart]
  );

  const cardWidth = width * 0.47;
  const cardMargin = width * 0.01;
  const cardSlot = cardWidth + 2 * cardMargin;

  const hasQuery = normalizeSearch(query).length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <View style={styles.inner}>
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
                  <Text style={styles.filterLabel}>Max Market Price</Text>
                  <TextInput
                    style={styles.numberInput}
                    placeholder="e.g. 50"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    value={maxPrice}
                    onChangeText={setMaxPrice}
                  />
                </View>
                <View style={styles.filterCell} />
              </View>
            </View>
          )}

          <Text style={styles.resultsCount}>
            {isSearching
              ? 'Searching...'
              : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`}
          </Text>
        </View>

        <View style={styles.carouselWrapper}>
          {!isCatalogReady ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Downloading market catalog...
              </Text>
            </View>
          ) : searchError ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.error }]}>
                {searchError}
              </Text>
            </View>
          ) : !hasQuery ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Enter a card name, number, or set to search.
              </Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No cards match your filters.</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
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
              maxToRenderPerBatch={6}
              windowSize={5}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
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
      </View>

      <CartDrawer />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
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

import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { FlashList, ViewToken } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/theme';
import type { CompletedSale } from '../../store/inventoryStore';
import type { Bucket, Tier } from '../../services/salesAnalytics';
import { VelocityChart } from './VelocityChart';
import { MarginWaterfallChart } from './MarginWaterfallChart';
import { TierBreakdownChart } from './TierBreakdownChart';

type ChartSlide = {
  key: string;
  title: string;
  subtitle: string;
  render: () => ReactNode;
};

const CHART_CAROUSEL_HEIGHT = 220;

const ChartSlideItem = memo(function ChartSlideItem({
  slide,
  slideWidth,
}: {
  slide: ChartSlide;
  slideWidth: number;
}) {
  return (
    <View
      style={[
        carouselStyles.slideOuter,
        { width: slideWidth, height: '100%' },
      ]}>
      <Text style={carouselStyles.slideTitle}>{slide.title}</Text>
      <Text style={carouselStyles.slideSubtitle}>{slide.subtitle}</Text>
      {slide.render()}
    </View>
  );
});

export function ChartCarousel({
  slideWidth,
  buckets,
  sales,
  tiers,
}: {
  slideWidth: number;
  buckets: Bucket[];
  sales: CompletedSale[];
  tiers: Tier[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const contentWidth = Math.max(0, slideWidth - 32);

  const [viewabilityConfig] = useState(() => ({
    viewAreaCoveragePercentThreshold: 50,
  }));

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChartSlide>[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    []
  );

  const slides: ChartSlide[] = useMemo(
    () => [
      {
        key: 'velocity',
        title: 'Sales pace',
        subtitle: 'Total sales vs what you paid, over time',
        render: () => <VelocityChart buckets={buckets} width={contentWidth} />,
      },
      {
        key: 'margin',
        title: 'Cost vs profit',
        subtitle: 'Where each sale dollar goes',
        render: () => (
          <MarginWaterfallChart sales={sales} width={contentWidth} />
        ),
      },
      {
        key: 'tiers',
        title: 'Sales by price band',
        subtitle: 'Where your sales money comes from',
        render: () => <TierBreakdownChart tiers={tiers} width={contentWidth} />,
      },
    ],
    [buckets, contentWidth, sales, tiers]
  );

  const renderItem = useCallback(
    ({ item }: { item: ChartSlide }) => (
      <ChartSlideItem slide={item} slideWidth={slideWidth} />
    ),
    [slideWidth]
  );

  return (
    <View style={carouselStyles.container}>
      <Text style={carouselStyles.heading}>Sales charts</Text>
      <View
        style={[
          carouselStyles.carousel,
          { width: slideWidth, height: CHART_CAROUSEL_HEIGHT },
        ]}>
        <FlashList
          data={slides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          style={{ flex: 1 }}
        />
      </View>
      <View style={carouselStyles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              carouselStyles.dot,
              i === activeIndex && carouselStyles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}


export const carouselStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: spacing.xl,
    marginBottom: spacing['4xl'],
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  carousel: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radius.card,
  },
  slideOuter: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  slideTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  slideSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
});


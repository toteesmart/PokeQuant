// One paged 2×2 grid of event results — the horizontal FlashList pages are
// quads of EventInventoryItem. Memo'd + fixed pixel size per page.

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { EventSearchCard } from '../EventSearchCard';
import type { EventInventoryItem } from '../../db/eventCatalogDb';

const PAGE_PADDING = 12;
const CARD_GAP = 12;

export function chunkQuads<T>(arr: T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < arr.length; i += 4) {
    groups.push(arr.slice(i, i + 4));
  }
  return groups;
}

type EventSearchPageProps = {
  items: EventInventoryItem[];
  pageWidth: number;
  pageHeight: number;
};

export const EventSearchPage = memo(function EventSearchPage({
  items,
  pageWidth,
  pageHeight,
}: EventSearchPageProps) {
  const cardWidth = Math.max(1, (pageWidth - PAGE_PADDING * 2 - CARD_GAP) / 2);
  const cardHeight = Math.max(1, (pageHeight - PAGE_PADDING * 2 - CARD_GAP) / 2);

  return (
    <View
      style={[
        styles.page,
        { width: pageWidth, height: pageHeight, padding: PAGE_PADDING, gap: CARD_GAP },
      ]}
    >
      <View style={[styles.pageRow, { gap: CARD_GAP }]}>
        {items[0] ? (
          <EventSearchCard item={items[0]} width={cardWidth} height={cardHeight} />
        ) : null}
        {items[1] ? (
          <EventSearchCard item={items[1]} width={cardWidth} height={cardHeight} />
        ) : null}
      </View>
      <View style={[styles.pageRow, { gap: CARD_GAP }]}>
        {items[2] ? (
          <EventSearchCard item={items[2]} width={cardWidth} height={cardHeight} />
        ) : null}
        {items[3] ? (
          <EventSearchCard item={items[3]} width={cardWidth} height={cardHeight} />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
});

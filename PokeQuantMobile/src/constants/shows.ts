export type UpcomingShow = {
  id: string;
  vendorId: string;
  name: string;
  startDate: string;
  location: string;
  isActive: boolean;
};

/**
 * Phase 1: hardcoded list of upcoming shows. Each show maps to a public R2
 * asset at shows/{showId}/event_catalog.json.zip.
 */
export const UPCOMING_SHOWS: UpcomingShow[] = [
  {
    id: '26ae05c1-30a6-4607-b4be-45ed6320fe4a',
    vendorId: 'totees-mart',
    name: 'Matty Stevens Staten Island Show',
    startDate: 'Saturday, September 19, 2026 · 9:00am – 4:00pm',
    location:
      'Our Lady Star of The Sea, 5411 Amboy Road, Staten Island, NY 10312',
    isActive: true,
  },
];

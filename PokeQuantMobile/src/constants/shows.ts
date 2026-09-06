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
    vendorId: 'matty-stevens',
    name: "Matty Steven's Staten Island Card Show",
    startDate: 'Saturday, September 19, 2026 · 9:00am – 3:30pm',
    location:
      'Our Lady Star of The Sea, 5411 Amboy Road, Staten Island, NY 10312',
    isActive: true,
  },
  {
    id: '685a4592-8e95-483d-b1a9-c5020d284a09',
    vendorId: 'matty-stevens',
    name: "Matty Steven's Staten Island Card Show",
    startDate: 'Friday, October 2, 2026 · 4:30pm – 9:30pm',
    location: 'Nicotras Ballroom, SI Hilton, Staten Island, NY 10314',
    isActive: true,
  },
  {
    id: 'ae5ea263-3f35-4d47-bcbb-67549f56fc32',
    vendorId: 'matty-stevens',
    name: "Matty Steven's Staten Island Card Show",
    startDate: 'Saturday, October 17, 2026 · 9:00am – 4:00pm',
    location:
      'College of Staten Island Sports Complex, 1R 2800 Victory Blvd, Staten Island, NY 10314',
    isActive: true,
  },
];

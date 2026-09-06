import AsyncStorage from '@react-native-async-storage/async-storage';
import { UPCOMING_SHOWS } from '../constants/shows';

export type ShowItem = {
  id: string;
  name: string;
  startDate: string;
  location: string;
};

const SHOWS_CACHE_KEY = 'pokequant-shows-list';
const WORKER_SHOWS_URL = 'https://pokequant-pre-show.totees-mart.workers.dev/shows';

function normalizeShow(raw: Record<string, unknown>): ShowItem {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    startDate: String(raw.start_date ?? ''),
    location: String(raw.location ?? ''),
  };
}

export async function getShowsList(): Promise<ShowItem[]> {
  try {
    const res = await fetch(WORKER_SHOWS_URL, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!res.ok) {
      throw new Error(`Show list request failed: ${res.status}`);
    }

    const json = (await res.json()) as { ok: boolean; shows?: unknown[]; error?: string };
    if (!json.ok || !Array.isArray(json.shows)) {
      throw new Error(json.error ?? 'Invalid show list response');
    }

    const shows = json.shows
      .filter((s) => typeof s === 'object' && s !== null)
      .map((s) => normalizeShow(s as Record<string, unknown>))
      .filter((s) => s.id && s.name);

    await AsyncStorage.setItem(SHOWS_CACHE_KEY, JSON.stringify(shows));
    return shows;
  } catch (err) {
    console.warn('Failed to fetch show list:', err);

    const cached = await AsyncStorage.getItem(SHOWS_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as ShowItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // Fall through to static fallback.
      }
    }

    return UPCOMING_SHOWS.map((show) => ({
      id: show.id,
      name: show.name,
      startDate: show.startDate ?? '',
      location: show.location ?? '',
    }));
  }
}

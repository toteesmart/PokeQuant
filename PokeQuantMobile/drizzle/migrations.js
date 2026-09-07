// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import m0000 from './20260904023650_free_red_ghost/migration.sql';
import m0001 from './20260905000000_split_sync_watermark/migration.sql';

  export default {
    migrations: {
      "20260904023650_free_red_ghost": m0000,
      "20260905000000_split_sync_watermark": m0001
}
  }
  
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // worker_show_vendor.js lives at the repo root, outside this package;
    // its transformed requires resolve @babel/runtime via rootDir's
    // node_modules because the repo root has none of its own.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-navigation|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@shopify|@unimodules|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers/'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // Ratchet rule: raise a floor as coverage improves; lower one only by
  // fixing code, never by dropping or skipping a suite. Directory keys are
  // path-prefix groups (not glob stars): a file counts toward EVERY group
  // whose prefix it matches (deal/ rows count in both `src/scanner/services/`
  // and `src/scanner/services/deal/`), and files matching no group land in
  // `global`. The remainder is screens/components/navigation/constants —
  // ~0% by design (UI coverage via jest is out of scope), so `global` is a
  // "coverage didn't vanish" tripwire, not a regression gate; the named
  // groups carry the real floors, each ~5 under the measured value at its
  // landing (item 36: hooks/scanner; item 50: api, db, services, store,
  // utils, scanner/services, scanner/utils). Global sits ~2 under its
  // post-item-50 remainder (3.7 stmt / 1.4 br / 1.5 fn / 4.0 ln).
  coverageThreshold: {
    global: { statements: 2, branches: 1, functions: 1, lines: 2 },
    'src/api/': { lines: 62, branches: 46 },
    'src/db/': { lines: 54, branches: 42 },
    'src/hooks/': { lines: 90, branches: 85 },
    'src/scanner/hooks/': { lines: 90 },
    'src/scanner/services/': { lines: 51, branches: 63 },
    'src/scanner/services/deal/': { lines: 80, branches: 80 },
    'src/scanner/store/': { lines: 90 },
    'src/scanner/utils/': { lines: 89, branches: 62 },
    'src/services/': { lines: 81, branches: 69 },
    'src/store/': { lines: 77, branches: 73 },
    'src/utils/': { lines: 49, branches: 33 },
  },
};

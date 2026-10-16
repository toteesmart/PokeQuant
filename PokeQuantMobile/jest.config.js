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
  // path-prefix groups (not glob stars): files matching them are checked
  // against that group only and are SUBTRACTED from `global`, so `global`
  // is the backstop for the un-pinned remainder (screens/components sit at
  // ~0% by design — UI coverage via jest is out of scope). Remainder pool
  // measured 21.4/16.6/14.1/21.7 at item-36 HEAD; floors sit ~5 under.
  coverageThreshold: {
    global: { statements: 16, branches: 11, functions: 9, lines: 16 },
    'src/hooks/': { lines: 90, branches: 85 },
    'src/scanner/hooks/': { lines: 90 },
    'src/scanner/services/deal/': { lines: 80, branches: 80 },
    'src/scanner/store/': { lines: 90 },
  },
};

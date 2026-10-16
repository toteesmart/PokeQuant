// Flat config for ESLint 9 — expo lint equivalent. Focus: react-hooks
// correctness on the hook-heavy post-refactor surface.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/**',
      'android/**',
      'ios/**',
      'artifacts/**',
      'assets/**',
      'coverage/**',
      '__tests__/__snapshots__/**',
      'drizzle/**',
    ],
  },
  {
    // Config, tooling, and test files run under Node/Jest, not the app runtime.
    files: [
      'jest.setup.js',
      'jest.config.js',
      'babel.config.js',
      'metro.config.js',
      'drizzle.config.ts',
      '__tests__/**',
      'tools/**',
      'maestro/**',
    ],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
  },
  {
    // Raw console.* bypasses redaction — src/ logs go through utils/log.
    files: ['src/**'],
    rules: { 'no-console': 'error' },
  },
  {
    // The three console calls inside log.ts are the implementation.
    files: ['src/utils/log.ts'],
    rules: { 'no-console': 'off' },
  },
  prettierConfig,
]);

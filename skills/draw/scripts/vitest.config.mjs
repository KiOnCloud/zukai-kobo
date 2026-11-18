import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test, and every CLI it spawns, keeps the run index in a temporary folder.
    setupFiles: ['tests/setup-index-home.mjs'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the built folder works from any static host or sub-path.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});

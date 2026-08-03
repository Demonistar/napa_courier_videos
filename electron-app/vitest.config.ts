import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run in Node — the main-process code is not browser code.
    environment: 'node',
    include: ['electron/**/*.test.ts'],
    globals: true,
  },
});

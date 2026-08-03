import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        // Main-process / Electron unit tests — run in Node.
        test: {
          name: 'electron',
          environment: 'node',
          include: ['electron/**/*.test.ts'],
          globals: true,
        },
      },
      {
        // Renderer / React component tests — run in jsdom.
        plugins: [react()],
        resolve: {
          alias: { '@': resolve(__dirname, 'src') },
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          globals: true,
          setupFiles: ['src/test-setup.ts'],
        },
      },
    ],
  },
});

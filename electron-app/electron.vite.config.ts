import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Load ALL variables from .env / .env.local / .env.[mode] in the electron-app
  // directory.  The empty-string prefix means "no prefix filter" — we get every
  // key, not just VITE_* ones.  These values are inlined at build time via the
  // define block below, because the packaged app runs without any .env file on
  // disk and process.env is NOT populated automatically in a packaged Electron app.
  const env = loadEnv(mode, __dirname, '');

  return {
    main: {
      // Statically replace process.env.* references in main-process code with
      // the literal values read from .env at build time.  This is the ONLY
      // mechanism that gets these values into the packaged binary — there is no
      // dotenv at runtime.
      define: {
        'process.env.DROPBOX_APP_KEY':    JSON.stringify(env.DROPBOX_APP_KEY    || '2nrt3uf9qy4oosn'),
        'process.env.DROPBOX_FOLDER_PATH': JSON.stringify(env.DROPBOX_FOLDER_PATH || '/Delivery Optimization/Delivery Walk Through Videos'),
      },
      resolve: {
        alias: { '@': resolve(__dirname, 'src') },
      },
      build: {
        // externalizeDeps replaces the deprecated externalizeDepsPlugin() call;
        // supported in electron-vite v5+ and the upcoming v6.
        externalizeDeps: true,
        lib: { entry: resolve(__dirname, 'electron/main.ts') },
      },
    },
    preload: {
      build: {
        // externalizeDeps replaces the deprecated externalizeDepsPlugin() call;
        // supported in electron-vite v5+ and the upcoming v6.
        externalizeDeps: true,
        lib: { entry: resolve(__dirname, 'electron/preload.ts') },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src'),
      resolve: {
        alias: { '@': resolve(__dirname, 'src') },
      },
      plugins: [react(), tailwindcss()],
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'src/index.html'),
        },
      },
    },
  };
});

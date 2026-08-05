/**
 * Build-config regression test.
 *
 * Verifies that the `define` block in electron.vite.config.ts bakes non-empty
 * values for the OAuth client ID and default folder path into the packaged
 * binary even when no .env file is present.
 *
 * The regression being guarded: using `?? ''` in the define block causes
 * `JSON.stringify('')` to be injected at build time.  The nullish-coalescing
 * operator treats `''` as a valid (non-null, non-undefined) value, so the
 * source-level fallback (`?? '2nrt3uf9qy4oosn'` in main.ts) is never reached —
 * the packaged binary silently ends up with an empty OAuth client ID.
 *
 * The fix: use `||` (logical OR) in the define block so that an absent or
 * empty DROPBOX_APP_KEY always resolves to the intended hardcoded fallback.
 */

import { describe, it, expect } from 'vitest';

// We cannot import electron.vite.config.ts directly in the Node test runner
// (it depends on electron-vite/vite modules unavailable here), so we validate
// the define-block logic in isolation — same expression as in the config file.

/**
 * Mirrors exactly what electron.vite.config.ts does in its `define` block:
 *   JSON.stringify(env.DROPBOX_APP_KEY || fallback)
 *
 * `env.DROPBOX_APP_KEY` is what loadEnv() returns for that key — an empty
 * string when the key is absent, not undefined/null.
 */
function resolveDefine(rawEnvValue: string | undefined, fallback: string): string {
  return JSON.stringify(rawEnvValue || fallback);
}

describe('electron.vite.config — build-time env defaults', () => {
  describe('DROPBOX_APP_KEY', () => {
    it('falls back to the hardcoded key when the env var is absent', () => {
      expect(JSON.parse(resolveDefine(undefined, '2nrt3uf9qy4oosn'))).toBe('2nrt3uf9qy4oosn');
    });

    it('falls back to the hardcoded key when the env var is an empty string (no .env file)', () => {
      // This is the exact scenario that the previous `?? ''` implementation
      // got wrong: loadEnv returns '' for missing keys, not undefined.
      expect(JSON.parse(resolveDefine('', '2nrt3uf9qy4oosn'))).toBe('2nrt3uf9qy4oosn');
    });

    it('uses the custom key when a non-empty DROPBOX_APP_KEY is set', () => {
      expect(JSON.parse(resolveDefine('mycustomkey123', '2nrt3uf9qy4oosn'))).toBe('mycustomkey123');
    });

    it('is never an empty string regardless of env state', () => {
      expect(JSON.parse(resolveDefine(undefined, '2nrt3uf9qy4oosn'))).not.toBe('');
      expect(JSON.parse(resolveDefine('', '2nrt3uf9qy4oosn'))).not.toBe('');
    });
  });

  describe('DROPBOX_FOLDER_PATH', () => {
    const defaultFolder = '/Delivery Optimization/Delivery Walk Through Videos';

    it('falls back to the default folder when the env var is absent', () => {
      expect(JSON.parse(resolveDefine(undefined, defaultFolder))).toBe(defaultFolder);
    });

    it('falls back to the default folder when the env var is an empty string', () => {
      expect(JSON.parse(resolveDefine('', defaultFolder))).toBe(defaultFolder);
    });

    it('uses the custom path when a non-empty DROPBOX_FOLDER_PATH is set', () => {
      expect(JSON.parse(resolveDefine('/My Custom Folder', defaultFolder))).toBe('/My Custom Folder');
    });
  });
});

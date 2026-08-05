/**
 * electron-builder configuration
 *
 * Using a JS config (instead of electron-builder.yml) so we can check whether
 * optional asset files actually exist before referencing them.  This means a
 * build will NEVER fail with "file not found" for icons or the license file —
 * electron-builder will fall back to its own defaults when any asset is absent.
 *
 * Files that benefit from the guard:
 *   build/icon.ico        — Windows app / NSIS installer icon
 *   build/icon.icns       — macOS app icon
 *   build/license.txt     — NSIS installer license screen
 *   build/entitlements.mac.plist — macOS hardened-runtime entitlements
 */

const fs   = require('fs');
const path = require('path');

const root  = __dirname;           // electron-app/
const build = path.join(root, 'build');

function exists(rel) {
  return fs.existsSync(path.join(build, rel));
}

// ── optional assets ──────────────────────────────────────────────────────────
const hasIco          = exists('icon.ico');
const hasIcns         = exists('icon.icns');
const hasLicense      = exists('license.txt');
const hasEntitlements = exists('entitlements.mac.plist');

// ── config ───────────────────────────────────────────────────────────────────
/** @type {import('electron-builder').Configuration} */
const config = {
  appId:       'com.napacourier.admin',
  productName: 'NAPA Courier Admin',
  copyright:   'Copyright © 2025 NAPA Courier',

  directories: {
    buildResources: 'build',
    output:         'dist-installer',
  },

  files: [
    'out/**/*',
    '!out/**/*.map',
  ],

  // ── Windows ────────────────────────────────────────────────────────────────
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    requestedExecutionLevel: 'asInvoker',
    // signingHashAlgorithms was removed in electron-builder v26; use signtoolOptions instead.
    // Only set icon if the file actually exists; otherwise electron-builder
    // uses its own default icon and the build succeeds regardless.
    ...(hasIco ? { icon: 'build/icon.ico' } : {}),
  },

  // ── NSIS installer ─────────────────────────────────────────────────────────
  nsis: {
    oneClick:                        false,
    perMachine:                      false,   // per-user install → always shows wizard, no UAC needed
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut:           true,
    createStartMenuShortcut:         true,
    shortcutName:                    'NAPA Courier Admin',
    ...(hasIco     ? {
      installerIcon:       'build/icon.ico',
      uninstallerIcon:     'build/icon.ico',
      installerHeaderIcon: 'build/icon.ico',
    } : {}),
    ...(hasLicense ? { license: 'build/license.txt' } : {}),
  },

  // ── Linux ──────────────────────────────────────────────────────────────────
  // Builds run on an ubuntu-latest GitHub Actions runner (see build-linux.yml).
  // Produces an AppImage (universal, no install required) and a .deb package
  // for Debian / Ubuntu systems.
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb',      arch: ['x64'] },
    ],
    category: 'Utility',
    // electron-builder auto-derives Linux icon sizes from icon.icns when no
    // explicit PNG is supplied, so no guard is needed here.
  },

  // ── macOS ──────────────────────────────────────────────────────────────────
  // Builds run on a macos-latest GitHub Actions runner (see build-macos.yml).
  // Produces two .dmg files: one for Intel (x64) and one for Apple Silicon (arm64).
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    category:          'public.app-category.productivity',
    hardenedRuntime:   true,
    gatekeeperAssess:  false,
    ...(hasIcns         ? { icon: 'build/icon.icns' }                         : {}),
    ...(hasEntitlements ? { entitlements:        'build/entitlements.mac.plist',
                            entitlementsInherit: 'build/entitlements.mac.plist' } : {}),
  },

  afterSign: 'electron/notarize.cjs',

  // ── DMG layout ─────────────────────────────────────────────────────────────
  dmg: {
    sign: false,   // DMG container; the .app inside is signed via CSC_LINK
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
    window: { width: 540, height: 380 },
  },

  // ── Auto-update distribution ───────────────────────────────────────────────
  // GH_TOKEN must be set in the environment before running publish:win / publish:mac.
  // See README → "Publishing a New Version" for the full workflow.
  publish: {
    provider: 'github',
    owner:    'Demonistar',
    repo:     'napa_courier_videos',
  },
};

module.exports = config;

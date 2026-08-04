/**
 * Auto-updater logic extracted from main.ts so it can be unit-tested
 * without spinning up a full Electron process.
 *
 * The module keeps its own small piece of mutable state (flags that track
 * whether a manual check is in flight and whether a download has finished)
 * and exposes `resetUpdaterStateForTesting()` so tests can reset between runs.
 */

import { app, dialog, BrowserWindow, MenuItem } from 'electron';
import { autoUpdater } from 'electron-updater';

// ─── Network-error classification ─────────────────────────────────────────────

/** Error codes that mean "the update server was unreachable over the network". */
export const NETWORK_ERROR_CODES = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENETUNREACH',
  'EAI_AGAIN',
] as const;

export function isNetworkError(err: Error): boolean {
  const msg = (err?.message ?? '') + (((err as Error & { code?: string })?.code) ?? '');
  return NETWORK_ERROR_CODES.some((code) => msg.includes(code));
}

// ─── Module-level updater state ────────────────────────────────────────────────

export let _updateDownloaded = false;
export let _manualCheckPending = false;
export let _checkForUpdatesMenuItem: MenuItem | null = null;

/** Reset all mutable state. Only for use in tests. */
export function resetUpdaterStateForTesting(): void {
  _updateDownloaded = false;
  _manualCheckPending = false;
  _checkForUpdatesMenuItem = null;
}

/** Whether an update has been fully downloaded and is waiting to install. */
export function getUpdateDownloaded(): boolean {
  return _updateDownloaded;
}

/**
 * Register the "Check for Updates…" menu item so the updater can toggle its
 * enabled state while a check is in flight. Call from buildAppMenu().
 */
export function setCheckForUpdatesMenuItem(item: MenuItem): void {
  _checkForUpdatesMenuItem = item;
}

// ─── Dialogs ───────────────────────────────────────────────────────────────────

export function showRestartDialog(win: BrowserWindow): void {
  dialog
    .showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: 'A new version of NAPA Courier Admin has been downloaded.',
      detail:
        'Restart now to install the update, or it will be installed automatically the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
}

// ─── Manual check ─────────────────────────────────────────────────────────────

/**
 * Trigger an update check at the user's explicit request (Help → Check for
 * Updates…). Shows a dialog when an update is found, when already up to date,
 * or when the check fails.
 */
export function checkForUpdatesManually(win: BrowserWindow): void {
  if (!app.isPackaged) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Dev build',
      message: 'Update checks are only available in the packaged app.',
    });
    return;
  }
  // If an update is already on disk, jump straight to the restart prompt.
  if (_updateDownloaded) {
    showRestartDialog(win);
    return;
  }
  // Prevent double-clicks from firing two simultaneous checks.
  if (_manualCheckPending) return;
  _manualCheckPending = true;
  if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = false;
  autoUpdater.checkForUpdates().catch((err) => {
    // The 'error' event fires before the promise rejects in electron-updater 6.x,
    // so state cleanup and dialog display are both handled there. This catch is
    // a safety net that only logs to avoid an unhandled-rejection warning.
    console.error('[auto-updater] manual check promise rejected:', err?.message ?? err);
  });
}

// ─── Initialisation ────────────────────────────────────────────────────────────

/**
 * Wire up the auto-updater event listeners and fire the silent startup check.
 * Must be called after the main BrowserWindow is created.
 */
export function initAutoUpdater(win: BrowserWindow): void {
  // Only run in the packaged app — dev builds have no update feed.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Fired after a manual check when already on the latest version.
  autoUpdater.on('update-not-available', () => {
    if (_manualCheckPending) {
      _manualCheckPending = false;
      if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Up to date',
        message: `You're running the latest version (${app.getVersion()}).`,
      });
    }
    // Startup automatic check: stay silent when no update is found.
  });

  autoUpdater.on('update-downloaded', () => {
    _updateDownloaded = true;
    _manualCheckPending = false;
    if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
    // Push an IPC event to the renderer so it can show the in-app update badge.
    win.webContents.send('app:updateReady');
    showRestartDialog(win);
  });

  // Surface errors to the user only when they triggered the check manually.
  // Startup (automatic) checks stay silent on any error — network hiccups at
  // launch should not bother the user.
  autoUpdater.on('error', (err) => {
    const wasManual = _manualCheckPending;
    _manualCheckPending = false;
    // Clear the downloaded flag so a stale/corrupt file cannot silently install
    // on the next restart — electron-updater may have set it to true before the
    // error fired (e.g. checksum mismatch detected after the write completed).
    _updateDownloaded = false;
    if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
    console.error('[auto-updater] error:', err?.message ?? err);
    // Tell the renderer to dismiss the in-app update badge.
    win.webContents.send('app:updateCancelled');

    if (wasManual) {
      const detail = isNetworkError(err as Error)
        ? 'Could not reach the update server — check your internet connection and try again.'
        : ((err as Error)?.message ?? 'An unexpected error occurred. Please try again later.');
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail,
      });
    }
    // Automatic startup check: stay silent on all errors.
  });

  // Startup check — silent unless an update is actually found and downloaded.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[auto-updater] startup check failed:', err?.message ?? err);
  });
}

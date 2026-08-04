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
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** Error codes that mean a local write to disk failed (disk full, permission denied). */
export const WRITE_ERROR_CODES = ['ENOSPC', 'EACCES', 'EPERM'] as const;
export let _updateDownloaded = false;
export let _manualCheckPending = false;
export let _checkForUpdatesMenuItem: MenuItem | null = null;

/** Reset all mutable state. Only for use in tests. */
export function resetUpdaterStateForTesting(): void {
  _updateDownloaded = false;
  _manualCheckPending = false;
  _checkForUpdatesMenuItem = null;
}
/**
 * Returns true when the error looks like a checksum / hash / signature failure
 * rather than a network problem.  Used to decide whether to wipe the local
 * update cache so the corrupt file is not retried on the next check.
 */
export function isChecksumError(err: Error): boolean {
  const msg = (err?.message ?? '').toLowerCase();
  return (
    msg.includes('sha512')    ||
    msg.includes('sha256')    ||
    msg.includes('checksum')  ||
    msg.includes('hash')      ||
    msg.includes('signature') ||
    msg.includes('integrity')
  );
}

/**
 * Resolve the OS-level application cache base directory.
 * Mirrors the logic in electron-updater's ElectronAppAdapter / AppAdapter so
 * we target the same directory the updater writes to.
 *
 * - Windows : %LOCALAPPDATA%  (falls back to ~/AppData/Local)
 * - macOS   : ~/Library/Caches
 * - Linux   : $XDG_CACHE_HOME (falls back to ~/.cache)
 *
 * @internal exported so tests can assert platform-specific paths without
 * touching the real filesystem.
 */
export function getUpdaterCachePendingDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  let cacheBase: string;
  if (platform === 'win32') {
    cacheBase = env['LOCALAPPDATA'] ?? join(homeDir, 'AppData', 'Local');
  } else if (platform === 'darwin') {
    cacheBase = join(homeDir, 'Library', 'Caches');
  } else {
    cacheBase = env['XDG_CACHE_HOME'] ?? join(homeDir, '.cache');
  }
  // electron-updater stores pending downloads under
  //   <cacheBase>/<updaterCacheDirName>/pending
  // where updaterCacheDirName defaults to "<appName>-updater" (the builder
  // appends the "-updater" suffix when writing app-update.yml at build time).
  return join(cacheBase, `${app.getName()}-updater`, 'pending');
}
export function isWriteError(err: Error): boolean {
  const msg = (err?.message ?? '') + (((err as Error & { code?: string })?.code) ?? '');
  return WRITE_ERROR_CODES.some((code) => msg.includes(code));
}

/**
 * Returns true when the app is running on Linux AND was launched directly from
 * its own AppImage (the AppImage runtime sets the APPIMAGE env var to the
 * resolved path of the .AppImage file).
 *
 * electron-updater can only replace the running binary when it is the AppImage
 * itself — it cannot update an app that was extracted, installed via a package
 * manager, or launched some other way.  Callers should skip the auto-update
 * flow when this returns false on Linux.
 */
export function isRunningFromAppImage(): boolean {
  return process.platform === 'linux' && Boolean(process.env.APPIMAGE);
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
  // On Linux the app can only update itself when launched directly from the
  // AppImage.  Inform the user rather than silently doing nothing.
  if (process.platform === 'linux' && !isRunningFromAppImage()) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Updates unavailable',
      message: 'This copy of NAPA Courier Admin was not launched from the AppImage.',
      detail:
        'To receive automatic updates, download the latest .AppImage from GitHub Releases ' +
        'and run that file directly.',
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
  // On Linux, electron-updater can only replace the binary when running from
  // the AppImage.  Skip the background check entirely when APPIMAGE is not set
  // so the admin never sees a spurious "update failed" error.
  if (process.platform === 'linux' && !isRunningFromAppImage()) {
    console.log('[auto-updater] Linux: not running from AppImage — auto-updates skipped');
    return;
  }

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

  // Relay download progress to the renderer so the Settings panel can show a
  // progress bar while the update is downloading.
  autoUpdater.on('download-progress', (info: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => {
    win.webContents.send('app:downloadProgress', info);
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

    // Remove the pending download directory so a corrupt or partially-written
    // file cannot block the next update attempt.  Triggered on:
    //   • write errors (ENOSPC, EACCES, EPERM) — disk or permission problems
    //   • checksum / hash / integrity errors    — corrupt or tampered file
    if (isWriteError(err as Error) || isChecksumError(err as Error)) {
      void cleanUpdaterTempDir();
    }

    if (wasManual) {
      let detail: string;
      if (isNetworkError(err as Error)) {
        detail = 'Could not reach the update server — check your internet connection and try again.';
      } else if (isWriteError(err as Error)) {
        detail =
          'Not enough disk space or insufficient permissions to save the update. ' +
          'Free up disk space or check folder permissions, then try again.';
      } else {
        detail = (err as Error)?.message ?? 'An unexpected error occurred. Please try again later.';
      }
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

/**
 * Attempt to remove the electron-updater pending download directory so that a
 * partially-written (or zero-byte) file from a failed write or checksum error
 * does not prevent the next update attempt from re-downloading.
 *
 * Failures are swallowed and logged — cleanup is best-effort and must never
 * block the error-handling flow.
 */
export async function cleanUpdaterTempDir(): Promise<void> {
  try {
    const pendingDir = getUpdaterCachePendingDir();
    await rm(pendingDir, { recursive: true, force: true });
    console.info('[auto-updater] cleaned pending update directory:', pendingDir);
  } catch (err) {
    console.warn('[auto-updater] temp-dir cleanup failed:', (err as Error)?.message ?? err);
  }
}

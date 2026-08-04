/**
 * Unit tests for the auto-updater logic in updater.ts.
 *
 * These tests run in Node (not inside Electron), so `electron` and
 * `electron-updater` are fully mocked. The mocked autoUpdater is an
 * EventEmitter so we can fire events programmatically and verify that the
 * correct dialogs are shown (or not shown) in response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// ─── Hoisted mock objects ─────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so any variables they
// reference must also be hoisted via vi.hoisted().
// We use require() inside vi.hoisted so Node built-ins are available before any
// ESM imports are initialized.

const { mockAutoUpdater, mockDialog, mockApp, mockRm } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  const emitter = new EventEmitter();
  const mockAutoUpdater = Object.assign(emitter, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
  });

  const mockDialog = {
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
  };

  const mockApp = {
    isPackaged: true,
    getVersion: vi.fn().mockReturnValue('1.2.3'),
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getName: vi.fn().mockReturnValue('napa-courier-admin'),
  };

  const mockRm = vi.fn().mockResolvedValue(undefined);

  return { mockAutoUpdater, mockDialog, mockApp, mockRm };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  dialog: mockDialog,
  app: mockApp,
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock('node:fs/promises', () => ({
  rm: mockRm,
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import {
  isNetworkError,
  NETWORK_ERROR_CODES,
  isWriteError,
  WRITE_ERROR_CODES,
  isChecksumError,
  cleanUpdaterTempDir,
  getUpdaterCachePendingDir,
  isRunningFromAppImage,
  initAutoUpdater,
  checkForUpdatesManually,
  setCheckForUpdatesMenuItem,
  resetUpdaterStateForTesting,
  getUpdateDownloaded,
} from './updater';

// ─── Shared test window stub ──────────────────────────────────────────────────

const mockWebContents = { send: vi.fn() };
const mockWin = {
  webContents: mockWebContents,
} as unknown as import('electron').BrowserWindow;

// ─── Global APPIMAGE default ──────────────────────────────────────────────────
// Tests run on Linux (Replit).  Without APPIMAGE set, initAutoUpdater exits
// early via the AppImage guard.  We set a fake value before every test so the
// guard doesn't interfere with suites that aren't specifically testing it.
// Suites that DO test the guard delete the var in their own beforeEach and
// restore it in afterEach; the global hook re-sets it before the next suite.
beforeEach(() => {
  if (!process.env.APPIMAGE) process.env.APPIMAGE = '/fake/test.AppImage';
});
afterEach(() => {
  // Only clean up if the value is still the sentinel — don't clobber a real
  // APPIMAGE set by a guard-specific test's afterEach.
  if (process.env.APPIMAGE === '/fake/test.AppImage') delete process.env.APPIMAGE;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeError(message: string, code?: string): Error {
  const err = new Error(message);
  if (code) (err as Error & { code?: string }).code = code;
  return err;
}

// ─── isNetworkError ───────────────────────────────────────────────────────────

describe('isNetworkError', () => {
  it('returns true when the error message contains ENOTFOUND', () => {
    expect(isNetworkError(makeError('getaddrinfo ENOTFOUND github.com'))).toBe(true);
  });

  it('returns true when the error code is ECONNREFUSED', () => {
    expect(isNetworkError(makeError('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED'))).toBe(true);
  });

  it('returns true for every listed network error code', () => {
    for (const code of NETWORK_ERROR_CODES) {
      expect(
        isNetworkError(makeError(`connect ${code}`, code)),
        `expected ${code} to be a network error`,
      ).toBe(true);
    }
  });

  it('returns false for a generic non-network error', () => {
    expect(isNetworkError(makeError('YAML parse error'))).toBe(false);
  });

  it('returns false for an unrelated error code', () => {
    expect(isNetworkError(makeError('EPERM: operation not permitted', 'EPERM'))).toBe(false);
  });
});

// ─── isWriteError ─────────────────────────────────────────────────────────────

describe('isWriteError', () => {
  it('returns true when the error message contains ENOSPC', () => {
    expect(isWriteError(makeError('ENOSPC: no space left on device'))).toBe(true);
  });

  it('returns true when the error code is ENOSPC', () => {
    expect(isWriteError(makeError('write ENOSPC /tmp/update.exe', 'ENOSPC'))).toBe(true);
  });

  it('returns true when the error message contains EACCES', () => {
    expect(isWriteError(makeError("EACCES: permission denied, open '/tmp/update.exe'"))).toBe(true);
  });

  it('returns true when the error code is EACCES', () => {
    expect(isWriteError(makeError('open /tmp/update.exe', 'EACCES'))).toBe(true);
  });

  it('returns true when the error message contains EPERM', () => {
    expect(isWriteError(makeError('EPERM: operation not permitted'))).toBe(true);
  });

  it('returns true when the error code is EPERM', () => {
    expect(isWriteError(makeError('operation not permitted', 'EPERM'))).toBe(true);
  });

  it('returns true for every listed write error code', () => {
    for (const code of WRITE_ERROR_CODES) {
      expect(
        isWriteError(makeError(`write failed ${code}`, code)),
        `expected ${code} to be a write error`,
      ).toBe(true);
    }
  });

  it('returns false for a network error', () => {
    expect(isWriteError(makeError('getaddrinfo ENOTFOUND update.example.com'))).toBe(false);
  });

  it('returns false for a generic non-write error', () => {
    expect(isWriteError(makeError('checksum mismatch for file: update.exe'))).toBe(false);
  });
});

// ─── isChecksumError ──────────────────────────────────────────────────────────

describe('isChecksumError', () => {
  it('returns true for a checksum mismatch message', () => {
    expect(isChecksumError(makeError('checksum mismatch for file: update.exe'))).toBe(true);
  });

  it('returns true for a sha512 verification failure', () => {
    expect(isChecksumError(makeError('sha512 hash does not match'))).toBe(true);
  });

  it('returns true for an integrity error message', () => {
    expect(isChecksumError(makeError('integrity check failed'))).toBe(true);
  });

  it('returns true for a signature verification failure', () => {
    expect(isChecksumError(makeError('signature verification failed'))).toBe(true);
  });

  it('returns false for a network error', () => {
    expect(isChecksumError(makeError('getaddrinfo ENOTFOUND update.example.com'))).toBe(false);
  });

  it('returns false for a write error', () => {
    expect(isChecksumError(makeError('ENOSPC: no space left on device', 'ENOSPC'))).toBe(false);
  });
});

// ─── getUpdaterCachePendingDir ────────────────────────────────────────────────
//
// Mirrors the path-resolution logic electron-updater uses for its cache dir so
// the cleanup targets the actual pending-download folder on each platform.
// Tests use contains/pattern assertions; path separators vary by host OS but
// the important invariants are: (a) the correct cache base is chosen for each
// platform, and (b) the path always ends with <appName>/pending.

describe('getUpdaterCachePendingDir', () => {
  const HOME = '/home/testuser';
  const APP_NAME = 'napa-courier-admin';

  beforeEach(() => {
    mockApp.getName.mockReturnValue(APP_NAME);
  });

  it('uses LOCALAPPDATA on Windows when the env var is set', () => {
    const localAppData = '/mock/AppData/Local';
    const result = getUpdaterCachePendingDir('win32', { LOCALAPPDATA: localAppData }, HOME);
    // The cache base must come from LOCALAPPDATA, not the home dir.
    expect(result).toContain(localAppData);
    expect(result).not.toContain('AppData/Local/AppData');
  });

  it('falls back to ~/AppData/Local on Windows when LOCALAPPDATA is absent', () => {
    const result = getUpdaterCachePendingDir('win32', {}, HOME);
    expect(result).toContain(HOME);
    expect(result).toContain('AppData');
    expect(result).toContain('Local');
  });

  it('uses ~/Library/Caches on macOS', () => {
    const result = getUpdaterCachePendingDir('darwin', {}, HOME);
    expect(result).toContain(HOME);
    expect(result).toContain('Library');
    expect(result).toContain('Caches');
  });

  it('uses XDG_CACHE_HOME on Linux when the env var is set', () => {
    const xdgCache = '/custom/cache';
    const result = getUpdaterCachePendingDir('linux', { XDG_CACHE_HOME: xdgCache }, HOME);
    expect(result).toContain(xdgCache);
    // Must NOT fall back to ~/.cache when XDG_CACHE_HOME is set.
    expect(result).not.toContain('.cache');
  });

  it('falls back to ~/.cache on Linux when XDG_CACHE_HOME is absent', () => {
    const result = getUpdaterCachePendingDir('linux', {}, HOME);
    expect(result).toContain(HOME);
    expect(result).toContain('.cache');
  });

  it('always ends with <appName>-updater then "pending"', () => {
    const result = getUpdaterCachePendingDir('darwin', {}, HOME);
    // Normalise separators so the assertion works on any host OS.
    const normalised = result.replace(/\\/g, '/');
    const parts = normalised.split('/');
    expect(parts.at(-1)).toBe('pending');
    // electron-builder appends "-updater" to the app name when writing app-update.yml
    expect(parts.at(-2)).toBe(`${APP_NAME}-updater`);
  });
});
// ─── cleanUpdaterTempDir ──────────────────────────────────────────────────────

describe('cleanUpdaterTempDir', () => {
  beforeEach(() => {
    mockRm.mockClear();
    mockApp.getName.mockReturnValue('napa-courier-admin');
  });

  it('calls rm with { recursive: true, force: true } on the pending directory', async () => {
    await cleanUpdaterTempDir();

    expect(mockRm).toHaveBeenCalledOnce();
    const [, opts] = mockRm.mock.calls[0] as [string, object];
    expect(opts).toMatchObject({ recursive: true, force: true });
  });

  it('passes a path that ends with <appName>-updater/pending', async () => {
    await cleanUpdaterTempDir();

    const [dirPath] = mockRm.mock.calls[0] as [string, object];
    expect(dirPath).toMatch(/napa-courier-admin-updater[/\\]pending$/);
  });

  it('does not throw when rm rejects (best-effort cleanup)', async () => {
    mockRm.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

    await expect(cleanUpdaterTempDir()).resolves.toBeUndefined();
  });
});

// ─── Error event — manual check ───────────────────────────────────────────────

describe('initAutoUpdater — error event (manual check)', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    // Never resolves — simulates a check that is in flight when the error fires
    mockAutoUpdater.checkForUpdates.mockReturnValue(new Promise(() => { /* pending */ }));
    initAutoUpdater(mockWin);
    // Put the updater into "manual check in flight" state
    checkForUpdatesManually(mockWin);
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('shows a network-specific dialog when ENOTFOUND is in the error message', () => {
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('internet connection');
  });

  it('shows a network-specific dialog when the error code is ECONNREFUSED', () => {
    mockAutoUpdater.emit('error', makeError('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.detail).toContain('internet connection');
  });

  it('shows a generic error detail for a non-network, non-write failure (e.g. certificate error)', () => {
    mockAutoUpdater.emit('error', makeError('Certificate verification failed'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.detail).toBe('Certificate verification failed');
    expect(opts.detail).not.toContain('internet connection');
    expect(opts.detail).not.toContain('disk space');
  });

  it('re-enables the menu item after a manual-check error', () => {
    const fakeMenuItem = { enabled: false } as unknown as import('electron').MenuItem;
    setCheckForUpdatesMenuItem(fakeMenuItem);

    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));

    expect(fakeMenuItem.enabled).toBe(true);
  });

  it('only shows one dialog even if the error event fires twice', () => {
    // Second spurious error — wasManual is already false after the first.
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
  });
});

// ─── Error event — startup (automatic) check ──────────────────────────────────

describe('initAutoUpdater — error event (startup / automatic check)', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    initAutoUpdater(mockWin);
    // No checkForUpdatesManually() call — _manualCheckPending remains false
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('stays completely silent when a startup check encounters a network error', () => {
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stays completely silent when a startup check encounters a generic error', () => {
    mockAutoUpdater.emit('error', makeError('Certificate verification failed'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stays completely silent when a startup check encounters ECONNREFUSED', () => {
    mockAutoUpdater.emit('error', makeError('connect ECONNREFUSED', 'ECONNREFUSED'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });
});

// ─── update-not-available event ───────────────────────────────────────────────

describe('initAutoUpdater — update-not-available event', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    initAutoUpdater(mockWin);
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('shows the "Up to date" dialog after a manual check', () => {
    mockAutoUpdater.checkForUpdates.mockReturnValue(new Promise(() => { /* pending */ }));
    checkForUpdatesManually(mockWin);

    mockAutoUpdater.emit('update-not-available');

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.title).toBe('Up to date');
    expect(opts.message).toContain('1.2.3');
  });

  it('stays silent when the startup check finds no update', () => {
    // _manualCheckPending is false → silent path
    mockAutoUpdater.emit('update-not-available');
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('re-enables the menu item after a manual "up to date" response', () => {
    const fakeMenuItem = { enabled: true } as unknown as import('electron').MenuItem;
    setCheckForUpdatesMenuItem(fakeMenuItem);
    mockAutoUpdater.checkForUpdates.mockReturnValue(new Promise(() => { /* pending */ }));
    checkForUpdatesManually(mockWin);
    // Menu item should have been disabled while the check was in flight.
    expect(fakeMenuItem.enabled).toBe(false);

    mockAutoUpdater.emit('update-not-available');
    expect(fakeMenuItem.enabled).toBe(true);
  });
});

// ─── Download-phase failure scenarios — manual check ─────────────────────────
//
// These cover the failure modes that are invisible to admins without explicit
// error handling: network interruption mid-download, checksum/tamper detection,
// and write failures (disk full, permission denied).

describe('initAutoUpdater — download interruption (manual check)', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    // Never resolves — simulates a check that is in flight when the error fires
    mockAutoUpdater.checkForUpdates.mockReturnValue(new Promise(() => { /* pending */ }));
    initAutoUpdater(mockWin);
    checkForUpdatesManually(mockWin);
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('shows a network dialog when the download is interrupted mid-transfer (ECONNRESET)', () => {
    mockAutoUpdater.emit('error', makeError('read ECONNRESET', 'ECONNRESET'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('internet connection');
  });

  it('shows a network dialog when the download times out mid-transfer (ETIMEDOUT)', () => {
    mockAutoUpdater.emit('error', makeError('connect ETIMEDOUT', 'ETIMEDOUT'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('internet connection');
  });

  it('shows a generic error dialog for a checksum mismatch (tampered or partial file)', () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('checksum mismatch');
    expect(opts.detail).not.toContain('internet connection');
    expect(opts.detail).not.toContain('disk space');
  });

  it('shows a write-error dialog when the disk is full (ENOSPC)', () => {
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('disk space');
    expect(opts.detail).not.toContain('internet connection');
  });

  it('shows a write-error dialog when writing the update file is denied (EACCES)', () => {
    mockAutoUpdater.emit('error', makeError("EACCES: permission denied, open '/tmp/update.exe'", 'EACCES'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('permissions');
    expect(opts.detail).not.toContain('internet connection');
  });

  it('shows a write-error dialog when the OS blocks the write (EPERM)', () => {
    mockAutoUpdater.emit('error', makeError('EPERM: operation not permitted', 'EPERM'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('permissions');
    expect(opts.detail).not.toContain('internet connection');
  });

  it('re-enables the menu item after any download-phase error', () => {
    const fakeMenuItem = { enabled: false } as unknown as import('electron').MenuItem;
    setCheckForUpdatesMenuItem(fakeMenuItem);

    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));

    expect(fakeMenuItem.enabled).toBe(true);
  });
});

// ─── Download-phase failure scenarios — startup (automatic) check ─────────────
//
// The same errors must stay completely silent during the background startup
// check so the app does not bother admins with pop-ups on every launch.

describe('initAutoUpdater — download interruption (startup / automatic check)', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    initAutoUpdater(mockWin);
    // No checkForUpdatesManually() call — _manualCheckPending remains false
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('stays silent when the download is interrupted mid-transfer (ECONNRESET)', () => {
    mockAutoUpdater.emit('error', makeError('read ECONNRESET', 'ECONNRESET'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stays silent when the download times out mid-transfer (ETIMEDOUT)', () => {
    mockAutoUpdater.emit('error', makeError('connect ETIMEDOUT', 'ETIMEDOUT'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stays silent when a checksum mismatch is detected during a background download', () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stays silent when the disk is full during a background download (ENOSPC)', () => {
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('stays silent when writing is denied during a background download (EACCES)', () => {
    mockAutoUpdater.emit('error', makeError("EACCES: permission denied, open '/tmp/update.exe'", 'EACCES'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });
});

// ─── Cleanup on write errors and checksum failures ───────────────────────────
//
// After ENOSPC, EACCES, EPERM, or a checksum/integrity failure, the
// partially-written update cache must be removed so the next launch can
// attempt a fresh download without hitting the corrupt file.

describe('initAutoUpdater — temp-dir cleanup on write and checksum errors', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    initAutoUpdater(mockWin);
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('triggers a cleanup when the disk is full (ENOSPC)', async () => {
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));
    // cleanUpdaterTempDir is async — wait for microtasks to flush
    await Promise.resolve();
    expect(mockRm).toHaveBeenCalledOnce();
  });

  it('triggers a cleanup when writing is denied (EACCES)', async () => {
    mockAutoUpdater.emit('error', makeError("EACCES: permission denied, open '/tmp/update.exe'", 'EACCES'));
    await Promise.resolve();
    expect(mockRm).toHaveBeenCalledOnce();
  });

  it('triggers a cleanup when the OS blocks the write (EPERM)', async () => {
    mockAutoUpdater.emit('error', makeError('EPERM: operation not permitted', 'EPERM'));
    await Promise.resolve();
    expect(mockRm).toHaveBeenCalledOnce();
  });

  it('triggers a cleanup for a checksum mismatch so the corrupt file is not retried', async () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    await Promise.resolve();
    expect(mockRm).toHaveBeenCalledOnce();
  });

  it('does NOT trigger a cleanup for a network error (ECONNRESET)', async () => {
    mockAutoUpdater.emit('error', makeError('read ECONNRESET', 'ECONNRESET'));
    await Promise.resolve();
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('does NOT trigger a cleanup for a generic non-write, non-checksum error', async () => {
    mockAutoUpdater.emit('error', makeError('Certificate verification failed'));
    await Promise.resolve();
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('does not throw if the cleanup itself fails', async () => {
    mockRm.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));
    // Should not throw — cleanup errors are swallowed
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));
    await Promise.resolve();
    // No assertion needed — the test passes if no unhandled rejection occurs
  });
});

// ─── Stale-download flag and IPC badge dismissal on error ─────────────────────
//
// If electron-updater set _updateDownloaded = true before the error fired
// (e.g. checksum mismatch detected after the file was written), the next
// restart must NOT silently install the corrupt file.  The error handler must
// (a) reset the flag and (b) tell the renderer to dismiss the update badge.

describe('initAutoUpdater — error clears _updateDownloaded and sends app:updateCancelled', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockWebContents.send.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    initAutoUpdater(mockWin);
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('resets _updateDownloaded to false when an error fires after a completed download', () => {
    // Simulate a successful download that set the flag…
    mockAutoUpdater.emit('update-downloaded');
    expect(getUpdateDownloaded()).toBe(true);

    // …then a subsequent error (e.g. checksum mismatch on verification).
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));

    expect(getUpdateDownloaded()).toBe(false);
  });

  it('resets _updateDownloaded to false even when the flag was never set', () => {
    expect(getUpdateDownloaded()).toBe(false);
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));
    expect(getUpdateDownloaded()).toBe(false);
  });

  it('sends app:updateCancelled via IPC on every error (startup check path)', () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));

    expect(mockWebContents.send).toHaveBeenCalledWith('app:updateCancelled');
  });

  it('sends app:updateCancelled via IPC on every error (manual check path)', () => {
    mockAutoUpdater.checkForUpdates.mockReturnValue(new Promise(() => { /* pending */ }));
    checkForUpdatesManually(mockWin);

    mockAutoUpdater.emit('error', makeError('ECONNRESET', 'ECONNRESET'));

    expect(mockWebContents.send).toHaveBeenCalledWith('app:updateCancelled');
  });

  it('sends app:updateCancelled exactly once per error event', () => {
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));

    const calls = mockWebContents.send.mock.calls.filter(
      ([channel]: [string]) => channel === 'app:updateCancelled',
    );
    expect(calls).toHaveLength(1);
  });

  it('sends app:updateCancelled for a network error too', () => {
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));

    expect(mockWebContents.send).toHaveBeenCalledWith('app:updateCancelled');
  });
});

// ─── isChecksumError ──────────────────────────────────────────────────────────

describe('isChecksumError', () => {
  it('returns true when the message contains "sha512"', () => {
    expect(isChecksumError(makeError('sha512 mismatch for update.exe'))).toBe(true);
  });

  it('returns true when the message contains "sha256"', () => {
    expect(isChecksumError(makeError('sha256 verification failed'))).toBe(true);
  });

  it('returns true when the message contains "checksum"', () => {
    expect(isChecksumError(makeError('checksum mismatch for file: update.exe'))).toBe(true);
  });

  it('returns true when the message contains "hash"', () => {
    expect(isChecksumError(makeError('hash does not match expected value'))).toBe(true);
  });

  it('returns true when the message contains "integrity"', () => {
    expect(isChecksumError(makeError('integrity check failed'))).toBe(true);
  });

  it('returns true when the message contains "signature"', () => {
    expect(isChecksumError(makeError('signature verification failed'))).toBe(true);
  });

  it('returns false for a network error', () => {
    expect(isChecksumError(makeError('getaddrinfo ENOTFOUND update.example.com'))).toBe(false);
  });

  it('returns false for a disk-full error', () => {
    expect(isChecksumError(makeError('ENOSPC: no space left on device', 'ENOSPC'))).toBe(false);
  });

  it('returns false for a permission error', () => {
    expect(isChecksumError(makeError('EACCES: permission denied', 'EACCES'))).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isChecksumError(makeError('SHA512 MISMATCH'))).toBe(true);
  });
});

// ─── isWriteError ─────────────────────────────────────────────────────────────

describe('isWriteError', () => {
  it('returns true for ENOSPC', () => {
    expect(isWriteError(makeError('no space left on device', 'ENOSPC'))).toBe(true);
  });

  it('returns true for EACCES', () => {
    expect(isWriteError(makeError('permission denied', 'EACCES'))).toBe(true);
  });

  it('returns true for EPERM', () => {
    expect(isWriteError(makeError('operation not permitted', 'EPERM'))).toBe(true);
  });

  it('returns false for a network error code', () => {
    expect(isWriteError(makeError('ENOTFOUND github.com', 'ENOTFOUND'))).toBe(false);
  });

  it('returns false for a checksum error (no error code)', () => {
    expect(isWriteError(makeError('checksum mismatch for file: update.exe'))).toBe(false);
  });

  it('returns false when there is no error code at all', () => {
    expect(isWriteError(makeError('something went wrong'))).toBe(false);
  });
});

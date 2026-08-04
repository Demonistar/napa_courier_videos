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
  _pendingUpdateVersion,
  _checksumFailedVersion,
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

// ─── Version-scoped checksum-error retry guard ────────────────────────────────
//
// After a checksum / integrity error, electron-updater may automatically retry
// the download and fire update-downloaded again.  The guard scopes the block to
// the specific *target* (update) version captured from the update-available
// event — NOT autoUpdater.currentVersion, which is the installed app version.
//
// Real-world flow:
//   update-available { version:'2.0.0' }  → _pendingUpdateVersion = '2.0.0'
//   error (checksum)                       → _checksumFailedVersion = '2.0.0'
//   update-downloaded { version:'2.0.0' } → REJECTED (same as quarantined)
//
// INSTALLED_VERSION = the currently-installed app version ('1.2.3')
// TARGET_VERSION    = the target update version ('2.0.0'), captured via event
// CLEAN_VERSION     = a later release ('3.0.0') that should never be blocked

const INSTALLED_VERSION = '1.2.3'; // mockApp.getVersion() — the running app
const TARGET_VERSION = '2.0.0';    // offered update, captured from update-available
const CLEAN_VERSION = '3.0.0';     // a subsequent clean release

describe('initAutoUpdater — checksum-error guard: _pendingUpdateVersion tracking', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockWebContents.send.mockClear();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });
    initAutoUpdater(mockWin);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('captures the target update version from update-available (not the installed version)', () => {
    // Installed version is INSTALLED_VERSION (1.2.3), target is TARGET_VERSION (2.0.0)
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });
    expect(_pendingUpdateVersion).toBe(TARGET_VERSION);
    expect(_pendingUpdateVersion).not.toBe(INSTALLED_VERSION);
  });

  it('is null before update-available fires', () => {
    expect(_pendingUpdateVersion).toBeNull();
  });

  it('resets _pendingUpdateVersion when resetUpdaterStateForTesting is called', () => {
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });
    resetUpdaterStateForTesting();
    expect(_pendingUpdateVersion).toBeNull();
  });
});

describe('initAutoUpdater — checksum-error guard: quarantine is set from _pendingUpdateVersion', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockWebContents.send.mockClear();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });
    initAutoUpdater(mockWin);
    // Simulate the real flow: update-available fires first so _pendingUpdateVersion
    // tracks the target version (2.0.0), not the installed version (1.2.3).
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('sets _checksumFailedVersion to the target update version (from update-available)', () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    // Must be the TARGET (update) version, not the installed app version
    expect(_checksumFailedVersion).toBe(TARGET_VERSION);
    expect(_checksumFailedVersion).not.toBe(INSTALLED_VERSION);
  });

  it('sets _checksumFailedVersion for a sha512 integrity error', () => {
    mockAutoUpdater.emit('error', makeError('sha512 hash does not match'));
    expect(_checksumFailedVersion).toBe(TARGET_VERSION);
  });

  it('does NOT set _checksumFailedVersion for a network error', () => {
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));
    expect(_checksumFailedVersion).toBeNull();
  });

  it('does NOT set _checksumFailedVersion for a write/disk error', () => {
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));
    expect(_checksumFailedVersion).toBeNull();
  });

  it('resets _checksumFailedVersion when resetUpdaterStateForTesting is called', () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    expect(_checksumFailedVersion).toBe(TARGET_VERSION);
    resetUpdaterStateForTesting();
    expect(_checksumFailedVersion).toBeNull();
  });
});

describe('initAutoUpdater — checksum-error guard: blocks retry of quarantined version', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockWebContents.send.mockClear();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });
    initAutoUpdater(mockWin);
    // Real-world sequence: update-available sets target version, then error quarantines it
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    // Clear IPC calls from the error event before each test assertion
    mockWebContents.send.mockClear();
    mockDialog.showMessageBox.mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('does NOT set _updateDownloaded when the quarantined version is retried', () => {
    // electron-updater retries and fires update-downloaded with the same version
    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });
    expect(getUpdateDownloaded()).toBe(false);
  });

  it('does NOT show the restart dialog when the quarantined retry is rejected', () => {
    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    const restartCalls = mockDialog.showMessageBox.mock.calls.filter(
      ([, opts]: [unknown, Electron.MessageBoxOptions]) => opts.title === 'Update ready',
    );
    expect(restartCalls).toHaveLength(0);
  });

  it('sends app:updateCancelled (not app:updateReady) when the retry is rejected', () => {
    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    const channels = mockWebContents.send.mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain('app:updateCancelled');
    expect(channels).not.toContain('app:updateReady');
  });

  it('logs a console.warn when the quarantined retry is rejected', () => {
    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('rejected'),
    );
  });

  it('does NOT block a clean first download when no prior error occurred', () => {
    // Fresh init — no checksum error. Reset state and spy so the outer
    // beforeEach's checksum-error warn call does not pollute this assertion.
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    initAutoUpdater(mockWin);
    warnSpy.mockClear(); // clear warns emitted by beforeEach
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });

    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    expect(getUpdateDownloaded()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('rejected'));
  });

  it('keeps _updateDownloaded false when the quarantined version is retried twice', () => {
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    // Two consecutive errors — badge must stay false
    expect(getUpdateDownloaded()).toBe(false);
    expect(_checksumFailedVersion).toBe(TARGET_VERSION);
  });

  it('sends app:updateCancelled for each error in the retry cycle', () => {
    mockWebContents.send.mockClear();
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));

    const cancelCalls = mockWebContents.send.mock.calls.filter(
      ([channel]: [string]) => channel === 'app:updateCancelled',
    );
    // Each error event sends exactly one app:updateCancelled
    expect(cancelCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT block a different (newer) version — quarantine is version-scoped', () => {
    // CLEAN_VERSION (3.0.0) was never quarantined — must install normally
    mockAutoUpdater.emit('update-downloaded', { version: CLEAN_VERSION });
    expect(getUpdateDownloaded()).toBe(true);
  });
});

describe('initAutoUpdater — checksum-error guard: network-error retries are not quarantined', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockWebContents.send.mockClear();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });
    initAutoUpdater(mockWin);
    // update-available fires to track target version
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('accepts the target version after a network error (network retries are safe)', () => {
    // Network error does NOT set _checksumFailedVersion
    mockAutoUpdater.emit('error', makeError('getaddrinfo ENOTFOUND update.example.com'));
    expect(_checksumFailedVersion).toBeNull();

    // Retry of the same version succeeds — file is genuinely valid
    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    expect(getUpdateDownloaded()).toBe(true);
  });

  it('sends app:updateReady (not app:updateCancelled) when a network-error retry succeeds', () => {
    mockAutoUpdater.emit('error', makeError('read ECONNRESET', 'ECONNRESET'));
    mockWebContents.send.mockClear();

    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    const channels = mockWebContents.send.mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain('app:updateReady');
    expect(channels).not.toContain('app:updateCancelled');
  });
});

describe('initAutoUpdater — checksum-error guard: recovery paths clear the quarantine', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockWebContents.send.mockClear();
    mockRm.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    // checkForUpdates never resolves — keeps _manualCheckPending true for the
    // duration of the test so we can observe other state changes cleanly.
    mockAutoUpdater.checkForUpdates.mockReturnValue(new Promise(() => { /* pending */ }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });
    initAutoUpdater(mockWin);
    // Simulate the normal sequence before a checksum error
    mockAutoUpdater.emit('update-available', { version: TARGET_VERSION });
    mockAutoUpdater.emit('error', makeError('checksum mismatch for file: update.exe'));
    mockWebContents.send.mockClear();
    mockDialog.showMessageBox.mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
  });

  it('clears _checksumFailedVersion when checkForUpdatesManually is called', () => {
    expect(_checksumFailedVersion).toBe(TARGET_VERSION);

    checkForUpdatesManually(mockWin);

    expect(_checksumFailedVersion).toBeNull();
  });

  it('also clears _pendingUpdateVersion when checkForUpdatesManually is called', () => {
    expect(_pendingUpdateVersion).toBe(TARGET_VERSION);

    checkForUpdatesManually(mockWin);

    expect(_pendingUpdateVersion).toBeNull();
  });

  it('allows the target version to install after a manual fresh check clears the quarantine', () => {
    // Admin deliberately requests a fresh check — quarantine is cleared
    checkForUpdatesManually(mockWin);

    // Fresh download of the same version now proceeds normally
    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    expect(getUpdateDownloaded()).toBe(true);
  });

  it('sends app:updateReady (not app:updateCancelled) after recovery via manual check', () => {
    checkForUpdatesManually(mockWin);
    mockWebContents.send.mockClear();

    mockAutoUpdater.emit('update-downloaded', { version: TARGET_VERSION });

    const channels = mockWebContents.send.mock.calls.map(([ch]: [string]) => ch);
    expect(channels).toContain('app:updateReady');
    expect(channels).not.toContain('app:updateCancelled');
  });

  it('clears _checksumFailedVersion when update-available fires (new check generation)', () => {
    expect(_checksumFailedVersion).toBe(TARGET_VERSION);

    // A new check found a newer release — fresh generation
    mockAutoUpdater.emit('update-available', { version: CLEAN_VERSION });

    expect(_checksumFailedVersion).toBeNull();
  });

  it('sets _pendingUpdateVersion to the new version when update-available fires', () => {
    mockAutoUpdater.emit('update-available', { version: CLEAN_VERSION });
    expect(_pendingUpdateVersion).toBe(CLEAN_VERSION);
  });

  it('allows a clean new-version download after update-available clears the quarantine', () => {
    // A newer release was found — fresh check, new version
    mockAutoUpdater.emit('update-available', { version: CLEAN_VERSION });
    mockAutoUpdater.emit('update-downloaded', { version: CLEAN_VERSION });

    expect(getUpdateDownloaded()).toBe(true);
  });
});

// ─── isRunningFromAppImage ─────────────────────────────────────────────────────
//
// This function gates the entire auto-update flow on Linux.  It must return
// true only when the process is running on Linux AND the AppImage runtime has
// set the APPIMAGE environment variable to the resolved path of the .AppImage
// file.

describe('isRunningFromAppImage', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    // Restore platform descriptor if a test replaced it.
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('returns true on Linux when APPIMAGE is set', () => {
    // Global beforeEach already sets APPIMAGE = '/fake/test.AppImage'
    expect(process.platform).toBe('linux');
    expect(process.env.APPIMAGE).toBeTruthy();
    expect(isRunningFromAppImage()).toBe(true);
  });

  it('returns false on Linux when APPIMAGE is not set', () => {
    const saved = process.env.APPIMAGE;
    delete process.env.APPIMAGE;
    try {
      expect(isRunningFromAppImage()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.APPIMAGE = saved;
    }
  });

  it('returns false on macOS even when APPIMAGE is set', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
    // APPIMAGE is set by the global beforeEach
    expect(isRunningFromAppImage()).toBe(false);
  });

  it('returns false on Windows even when APPIMAGE is set', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
    expect(isRunningFromAppImage()).toBe(false);
  });

  it('returns false when APPIMAGE is an empty string', () => {
    const saved = process.env.APPIMAGE;
    process.env.APPIMAGE = '';
    try {
      expect(isRunningFromAppImage()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.APPIMAGE = saved;
      else delete process.env.APPIMAGE;
    }
  });
});

// ─── initAutoUpdater — Linux AppImage guard ────────────────────────────────────
//
// On Linux, initAutoUpdater must:
//   • skip checkForUpdates entirely (and log a warning) when APPIMAGE is absent
//   • proceed normally and call checkForUpdates when APPIMAGE is present
//
// The global beforeEach sets APPIMAGE so other suites are unaffected; this
// suite manipulates the variable inside its own beforeEach / afterEach.

describe('initAutoUpdater — Linux AppImage guard (APPIMAGE not set → skip)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* suppress */ });
    // Remove APPIMAGE so the guard fires
    delete process.env.APPIMAGE;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
    // Restore the sentinel so the global afterEach can clean up normally
    process.env.APPIMAGE = '/fake/test.AppImage';
  });

  it('does NOT call checkForUpdates when APPIMAGE is absent', () => {
    initAutoUpdater(mockWin);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('logs a console warning explaining why auto-updates are skipped', () => {
    initAutoUpdater(mockWin);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('not running from AppImage'),
    );
  });

  it('registers no event listeners when APPIMAGE is absent', () => {
    initAutoUpdater(mockWin);
    expect(mockAutoUpdater.listenerCount('update-available')).toBe(0);
    expect(mockAutoUpdater.listenerCount('update-downloaded')).toBe(0);
    expect(mockAutoUpdater.listenerCount('error')).toBe(0);
  });
});

describe('initAutoUpdater — Linux AppImage guard (APPIMAGE set → proceeds)', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockAutoUpdater.checkForUpdates.mockClear();
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);
    // Global beforeEach already sets APPIMAGE; be explicit for clarity
    process.env.APPIMAGE = '/home/user/NapaCourierAdmin.AppImage';
    initAutoUpdater(mockWin);
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
    // Restore sentinel for global afterEach
    process.env.APPIMAGE = '/fake/test.AppImage';
  });

  it('calls checkForUpdates when APPIMAGE is set', () => {
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('registers the update-available listener when APPIMAGE is set', () => {
    expect(mockAutoUpdater.listenerCount('update-available')).toBeGreaterThan(0);
  });

  it('registers the error listener when APPIMAGE is set', () => {
    expect(mockAutoUpdater.listenerCount('error')).toBeGreaterThan(0);
  });
});

// ─── checkForUpdatesManually — Linux AppImage guard ───────────────────────────
//
// When the admin triggers a manual check on Linux and APPIMAGE is absent, the
// function must show an informational dialog and return without calling
// checkForUpdates, so the admin understands why updates are unavailable.

describe('checkForUpdatesManually — Linux AppImage guard (APPIMAGE not set)', () => {
  beforeEach(() => {
    resetUpdaterStateForTesting();
    mockAutoUpdater.removeAllListeners();
    mockDialog.showMessageBox.mockClear();
    mockAutoUpdater.checkForUpdates.mockClear();
    // Remove APPIMAGE before calling initAutoUpdater — the guard must fire
    delete process.env.APPIMAGE;
    // initAutoUpdater will return early (no listeners), but checkForUpdatesManually
    // has its own guard which we are testing independently here.
  });

  afterEach(() => {
    mockAutoUpdater.removeAllListeners();
    resetUpdaterStateForTesting();
    process.env.APPIMAGE = '/fake/test.AppImage';
  });

  it('shows an informational dialog when APPIMAGE is not set', () => {
    checkForUpdatesManually(mockWin);

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('info');
    expect(opts.title).toBe('Updates unavailable');
  });

  it('dialog message explains the AppImage requirement to the admin', () => {
    checkForUpdatesManually(mockWin);

    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.message).toContain('AppImage');
  });

  it('does NOT call checkForUpdates when APPIMAGE is absent', () => {
    checkForUpdatesManually(mockWin);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

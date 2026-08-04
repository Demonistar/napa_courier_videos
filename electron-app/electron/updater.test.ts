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

const { mockAutoUpdater, mockDialog, mockApp } = vi.hoisted(() => {
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
  };

  return { mockAutoUpdater, mockDialog, mockApp };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  dialog: mockDialog,
  app: mockApp,
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import {
  isNetworkError,
  NETWORK_ERROR_CODES,
  initAutoUpdater,
  checkForUpdatesManually,
  setCheckForUpdatesMenuItem,
  resetUpdaterStateForTesting,
} from './updater';

// ─── Shared test window stub ──────────────────────────────────────────────────

const mockWebContents = { send: vi.fn() };
const mockWin = {
  webContents: mockWebContents,
} as unknown as import('electron').BrowserWindow;

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

  it('shows a generic error detail for a non-network failure (e.g. certificate error)', () => {
    mockAutoUpdater.emit('error', makeError('Certificate verification failed'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.detail).toBe('Certificate verification failed');
    expect(opts.detail).not.toContain('internet connection');
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
  });

  it('shows a generic error dialog when the disk is full (ENOSPC)', () => {
    mockAutoUpdater.emit('error', makeError('ENOSPC: no space left on device', 'ENOSPC'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('ENOSPC');
    expect(opts.detail).not.toContain('internet connection');
  });

  it('shows a generic error dialog when writing the update file is denied (EACCES)', () => {
    mockAutoUpdater.emit('error', makeError('EACCES: permission denied, open \'/tmp/update.exe\'', 'EACCES'));

    expect(mockDialog.showMessageBox).toHaveBeenCalledOnce();
    const [, opts] = mockDialog.showMessageBox.mock.calls[0] as [unknown, Electron.MessageBoxOptions];
    expect(opts.type).toBe('warning');
    expect(opts.title).toBe('Update check failed');
    expect(opts.detail).toContain('EACCES');
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
    mockAutoUpdater.emit('error', makeError('EACCES: permission denied, open \'/tmp/update.exe\'', 'EACCES'));
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });
});

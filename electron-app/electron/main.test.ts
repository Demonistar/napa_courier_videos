/**
 * Smoke tests for the main-process IPC handlers in main.ts.
 *
 * These tests run in Node (not inside Electron) and fully mock all Electron,
 * electron-updater, and Node built-in modules so nothing touches the real
 * filesystem, OS keychain, or network.
 *
 * The primary goal is to catch silent API breakage introduced by the v31→v43
 * Electron major-version jump: if a handler channel is renamed, removed, or
 * receives the wrong arguments, at least one assertion here will fail.
 *
 * Coverage: every IPC channel declared in preload.ts must be registered by
 * registerIpcHandlers() in main.ts, and the most safety-critical handlers
 * (settings, app lifecycle, auth) must honour their basic contracts.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ─── Hoisted mock objects ─────────────────────────────────────────────────────
// vi.mock factories are hoisted; variables must be created with vi.hoisted()
// so they exist before any ESM imports are resolved.

const {
  handlers,
  mockApp,
  mockIpcMain,
  mockShell,
  mockSafeStorage,
  mockNativeTheme,
  mockMenu,
  mockBrowserWindowCtor,
  mockWin,
  mockWebContents,
  mockAutoUpdaterDirect,
  mockFs,
  // Stable references to the updater mocks — kept in vi.hoisted so the exact
  // same vi.fn() instance is used both by the vi.mock factory and by our tests.
  mockInitAutoUpdater,
  mockGetUpdateDownloaded,
} = vi.hoisted(() => {
  // ── Captured handler map ───────────────────────────────────────────────────
  // ipcMain.handle stores each registered handler here so tests can call them
  // directly without a live Electron process.
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  // ── Window / webContents stub ──────────────────────────────────────────────
  const mockWebContents = {
    send: vi.fn(),
    openDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  const mockWin = {
    webContents: mockWebContents,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  };

  // ── BrowserWindow mock (constructor + static getAllWindows) ────────────────
  // Use a regular function (not an arrow) for the implementation so Vitest
  // doesn't complain when main.ts calls `new BrowserWindow(...)`.
  function BrowserWindowImpl(this: unknown) { return mockWin; }
  const mockBrowserWindowCtor = Object.assign(
    vi.fn().mockImplementation(BrowserWindowImpl),
    {
      getAllWindows: vi.fn().mockReturnValue([mockWin]),
    },
  );

  // ── app mock ───────────────────────────────────────────────────────────────
  const mockApp = {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    getName: vi.fn().mockReturnValue('napa-courier-admin'),
    isPackaged: false,
    quit: vi.fn(),
    // whenReady() must resolve so the .then() callback runs and registers handlers.
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  // ── ipcMain mock ───────────────────────────────────────────────────────────
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };

  // ── shell, safeStorage, nativeTheme, Menu, dialog ─────────────────────────
  const mockShell = { openExternal: vi.fn() };

  const mockSafeStorage = {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  };

  const mockNativeTheme = { themeSource: 'light' as string };

  const mockMenu = {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn().mockReturnValue({}),
  };

  // ── autoUpdater used directly in main.ts (for quitAndInstall) ─────────────
  const mockAutoUpdaterDirect = {
    quitAndInstall: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(null),
  };

  // ── fs mock ────────────────────────────────────────────────────────────────
  const mockFs = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };

  // ── Stable updater mock references ────────────────────────────────────────
  // Created here (not inside vi.mock) so the same vi.fn() object is used
  // both by the mock factory and by assertions in the test body.
  const mockInitAutoUpdater = vi.fn();
  const mockGetUpdateDownloaded = vi.fn().mockReturnValue(false);

  return {
    handlers,
    mockApp,
    mockIpcMain,
    mockShell,
    mockSafeStorage,
    mockNativeTheme,
    mockMenu,
    mockBrowserWindowCtor,
    mockWin,
    mockWebContents,
    mockAutoUpdaterDirect,
    mockFs,
    mockInitAutoUpdater,
    mockGetUpdateDownloaded,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: mockApp,
  ipcMain: mockIpcMain,
  shell: mockShell,
  safeStorage: mockSafeStorage,
  nativeTheme: mockNativeTheme,
  // Menu needs both the constructor shape and static methods.
  Menu: mockMenu,
  MenuItem: class {},
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) },
  BrowserWindow: mockBrowserWindowCtor,
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdaterDirect,
}));

// The updater sub-module is imported by main.ts for initAutoUpdater and
// getUpdateDownloaded.  We use the stable references from vi.hoisted so that
// the exact same vi.fn() objects are shared between the mock factory and our
// test assertions — avoiding identity-mismatch false-negatives.
vi.mock('./updater', () => ({
  initAutoUpdater: mockInitAutoUpdater,
  checkForUpdatesManually: vi.fn(),
  getUpdateDownloaded: mockGetUpdateDownloaded,
  setCheckForUpdatesMenuItem: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: mockFs,
  existsSync: mockFs.existsSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
  unlinkSync: mockFs.unlinkSync,
}));

// node:http is used by the OAuth local redirect server — stub it out so no
// real TCP socket is opened during tests.
vi.mock('node:http', () => ({
  createServer: vi.fn().mockReturnValue({
    listen: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
  }),
}));

// node:child_process is used by the Windows uninstall path.
vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
}));

// ─── Load the module under test ───────────────────────────────────────────────
// Dynamic import ensures all vi.mock() calls are in effect first.
// app.whenReady() resolves immediately (see mock above), queuing its .then()
// callback as a microtask.  We flush one tick after the import so the handlers
// are registered before any test runs.

beforeAll(async () => {
  await import('./main');
  // One microtask tick lets the app.whenReady().then(...) callback run,
  // which is where registerIpcHandlers() is called.
  await Promise.resolve();
});

// ─── IPC channel coverage ─────────────────────────────────────────────────────
//
// Every channel in this list must appear in both preload.ts (exposed to the
// renderer) and be registered by registerIpcHandlers() in main.ts.
// If either side adds a channel without updating the other, this test fails.

describe('IPC channel registration coverage', () => {
  /** All channels that preload.ts exposes via ipcRenderer.invoke() */
  const EXPECTED_CHANNELS = [
    // Auth
    'auth:status',
    'auth:login',
    'auth:logout',
    // Data
    'data:loadStaging',
    'data:saveStaging',
    'data:publish',
    'data:loadLive',
    'data:listBackups',
    'data:loadBackup',
    'data:saveBackup',
    // Settings
    'settings:get',
    'settings:set',
    // App lifecycle / update
    'app:getVersion',
    'app:getUpdateStatus',
    'app:quitAndInstall',
    'app:getPlatform',
    'app:uninstall',
    // Dropbox folder browser
    'dropbox:listFolder',
    'dropbox:findNapaAdminFolders',
    'dropbox:testFolderPath',
  ] as const;

  it('registers every IPC channel declared in preload.ts', () => {
    for (const channel of EXPECTED_CHANNELS) {
      expect(
        handlers.has(channel),
        `IPC channel '${channel}' is exposed in preload.ts but not registered in main.ts`,
      ).toBe(true);
    }
  });

  it('has no unregistered channels not declared in preload.ts', () => {
    const registered = [...handlers.keys()].sort();
    const expected = [...EXPECTED_CHANNELS].sort();
    // Every registered channel must be in the expected list.
    for (const ch of registered) {
      expect(
        expected.includes(ch as (typeof EXPECTED_CHANNELS)[number]),
        `IPC channel '${ch}' is registered in main.ts but not exposed in preload.ts`,
      ).toBe(true);
    }
    // And the counts must match so neither side has extras.
    expect(registered.length).toBe(expected.length);
  });
});

// ─── settings:get ─────────────────────────────────────────────────────────────

describe('settings:get handler', () => {
  beforeEach(() => {
    mockFs.existsSync.mockReturnValue(false);
  });

  it('returns an object with a dropboxFolderPath property', async () => {
    const handler = handlers.get('settings:get')!;
    const result = await handler() as Record<string, unknown>;
    expect(result).toHaveProperty('dropboxFolderPath');
    expect(typeof result.dropboxFolderPath).toBe('string');
  });

  it('returns default settings when no settings file exists on disk', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const handler = handlers.get('settings:get')!;
    const result = await handler() as { dropboxFolderPath: string };
    // Default comes from DEFAULT_FOLDER_PATH env var or '/NAPA Courier Admin'
    expect(result.dropboxFolderPath).toBeTruthy();
  });

  it('parses settings from disk when the settings file exists', async () => {
    const stored = { dropboxFolderPath: '/My Dropbox/NAPA', theme: 'dark' };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(stored));
    const handler = handlers.get('settings:get')!;
    const result = await handler() as typeof stored;
    expect(result.dropboxFolderPath).toBe('/My Dropbox/NAPA');
    expect(result.theme).toBe('dark');
  });
});

// ─── settings:set ─────────────────────────────────────────────────────────────

describe('settings:set handler', () => {
  beforeEach(() => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.writeFileSync.mockClear();
    mockNativeTheme.themeSource = 'light';
  });

  it('persists the updated settings to disk', async () => {
    const handler = handlers.get('settings:set')!;
    await handler({} /* event */, { dropboxFolderPath: '/Updated/Path' });
    expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
    const [, json] = mockFs.writeFileSync.mock.calls[0] as [string, string];
    expect(JSON.parse(json)).toMatchObject({ dropboxFolderPath: '/Updated/Path' });
  });

  it('applies theme change immediately to nativeTheme.themeSource', async () => {
    const handler = handlers.get('settings:set')!;
    await handler({}, { theme: 'dark' });
    // nativeTheme.themeSource must be updated synchronously (Electron 32+
    // honours this change without requiring an app restart).
    expect(mockNativeTheme.themeSource).toBe('dark');
  });

  it('does not modify nativeTheme.themeSource when theme is absent from the update', async () => {
    mockNativeTheme.themeSource = 'system';
    const handler = handlers.get('settings:set')!;
    await handler({}, { dropboxFolderPath: '/Unchanged/Path' });
    expect(mockNativeTheme.themeSource).toBe('system');
  });
});

// ─── app:getVersion ───────────────────────────────────────────────────────────

describe('app:getVersion handler', () => {
  it('delegates to app.getVersion() from the electron module', async () => {
    mockApp.getVersion.mockReturnValue('4.5.6');
    const handler = handlers.get('app:getVersion')!;
    const result = await handler();
    expect(result).toBe('4.5.6');
    expect(mockApp.getVersion).toHaveBeenCalled();
  });
});

// ─── app:getUpdateStatus ──────────────────────────────────────────────────────

describe('app:getUpdateStatus handler', () => {
  it('returns { updateDownloaded: false } when no update is ready', async () => {
    mockGetUpdateDownloaded.mockReturnValue(false);
    const handler = handlers.get('app:getUpdateStatus')!;
    expect(await handler()).toEqual({ updateDownloaded: false });
  });

  it('returns { updateDownloaded: true } when an update has been downloaded', async () => {
    mockGetUpdateDownloaded.mockReturnValue(true);
    const handler = handlers.get('app:getUpdateStatus')!;
    expect(await handler()).toEqual({ updateDownloaded: true });
  });
});

// ─── app:quitAndInstall ───────────────────────────────────────────────────────

describe('app:quitAndInstall handler', () => {
  beforeEach(() => {
    mockAutoUpdaterDirect.quitAndInstall.mockClear();
    mockWebContents.send.mockClear();
    mockBrowserWindowCtor.getAllWindows.mockReturnValue([mockWin]);
  });

  it('calls autoUpdater.quitAndInstall() when an update is downloaded', () => {
    mockGetUpdateDownloaded.mockReturnValue(true);
    const handler = handlers.get('app:quitAndInstall')!;
    handler();
    expect(mockAutoUpdaterDirect.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('sends app:updateCancelled to the renderer window before quitting', () => {
    mockGetUpdateDownloaded.mockReturnValue(true);
    const handler = handlers.get('app:quitAndInstall')!;
    handler();
    expect(mockWebContents.send).toHaveBeenCalledWith('app:updateCancelled');
    // The send must come before quitAndInstall so the renderer can clean up.
    const sendOrder = mockWebContents.send.mock.invocationCallOrder[0];
    const quitOrder = mockAutoUpdaterDirect.quitAndInstall.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(quitOrder!);
  });

  it('is a no-op when no update has been downloaded', () => {
    mockGetUpdateDownloaded.mockReturnValue(false);
    const handler = handlers.get('app:quitAndInstall')!;
    handler();
    expect(mockAutoUpdaterDirect.quitAndInstall).not.toHaveBeenCalled();
    expect(mockWebContents.send).not.toHaveBeenCalled();
  });

  it('does not throw when BrowserWindow.getAllWindows() returns an empty array', () => {
    mockGetUpdateDownloaded.mockReturnValue(true);
    mockBrowserWindowCtor.getAllWindows.mockReturnValue([]);
    const handler = handlers.get('app:quitAndInstall')!;
    // Must not throw even when there is no window to send to (optional-chain).
    expect(() => handler()).not.toThrow();
    // quitAndInstall is still called regardless of window presence.
    expect(mockAutoUpdaterDirect.quitAndInstall).toHaveBeenCalledOnce();
  });
});

// ─── app:getPlatform ──────────────────────────────────────────────────────────

describe('app:getPlatform handler', () => {
  it('returns the current process.platform value', async () => {
    const handler = handlers.get('app:getPlatform')!;
    const result = await handler() as { platform: string; appBundlePath: string | null };
    expect(result.platform).toBe(process.platform);
  });

  it('always includes the appBundlePath key (null on non-macOS)', async () => {
    const handler = handlers.get('app:getPlatform')!;
    const result = await handler() as { platform: string; appBundlePath: string | null };
    expect(Object.prototype.hasOwnProperty.call(result, 'appBundlePath')).toBe(true);
  });

  // Tests run on Linux on Replit — assert the non-mac path explicitly.
  it('returns appBundlePath:null when not running on macOS', async () => {
    if (process.platform !== 'darwin') {
      const handler = handlers.get('app:getPlatform')!;
      const result = await handler() as { platform: string; appBundlePath: string | null };
      expect(result.appBundlePath).toBeNull();
    }
  });
});

// ─── app:uninstall ────────────────────────────────────────────────────────────

describe('app:uninstall handler', () => {
  it('returns ok:false with a human-readable error on Linux', async () => {
    if (process.platform === 'linux') {
      const handler = handlers.get('app:uninstall')!;
      const result = await handler() as { ok: boolean; platform: string; error: string };
      expect(result.ok).toBe(false);
      expect(result.platform).toBe('linux');
      expect(result.error).toContain('not supported');
    }
  });

  it('always returns a result with an ok property (never throws)', async () => {
    const handler = handlers.get('app:uninstall')!;
    const result = await handler() as { ok: boolean };
    expect(typeof result.ok).toBe('boolean');
  });
});

// ─── auth:status ─────────────────────────────────────────────────────────────

describe('auth:status handler', () => {
  it('returns { authenticated: false } when no token file exists', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const handler = handlers.get('auth:status')!;
    const result = await handler() as { authenticated: boolean };
    expect(result.authenticated).toBe(false);
  });
});

// ─── auth:logout ─────────────────────────────────────────────────────────────

describe('auth:logout handler', () => {
  it('returns { ok: true }', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const handler = handlers.get('auth:logout')!;
    const result = await handler();
    expect(result).toEqual({ ok: true });
  });

  it('deletes the token file when it exists', async () => {
    mockFs.existsSync.mockImplementation((p: unknown) =>
      (p as string).includes('dropbox-token'),
    );
    mockFs.unlinkSync.mockClear();

    const handler = handlers.get('auth:logout')!;
    await handler();

    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });
});

// ─── Updater bootstrap (via main.ts app.whenReady) ───────────────────────────
// Confirms that main.ts wires up the auto-updater correctly after the window
// is created — using the stable hoisted vi.fn() reference so there is no
// module-identity ambiguity between the mock factory and the test assertion.

describe('updater integration (via main.ts app.whenReady bootstrap)', () => {
  it('calls initAutoUpdater exactly once after app.whenReady resolves', () => {
    // mockInitAutoUpdater is the exact vi.fn() used by the ./updater mock factory,
    // so any call recorded when main.ts bootstrapped is visible here.
    expect(mockInitAutoUpdater).toHaveBeenCalledOnce();
  });

  it('passes the BrowserWindow instance to initAutoUpdater', () => {
    const [win] = mockInitAutoUpdater.mock.calls[0] as [typeof mockWin];
    // The window must be the object returned by new BrowserWindow(...) in main.ts.
    expect(win).toBe(mockWin);
  });
});

/**
 * Unit tests for SettingsPanel — "Restart to Install" button wiring.
 *
 * The primary concern: when `updateReady` is true and the admin clicks the
 * "Restart" button, `window.electronAPI.app.quitAndInstall()` must be called.
 * If that wire breaks (e.g. the onClick handler is accidentally removed) the
 * admin would click the button and nothing would happen — these tests catch
 * that regression.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import type { DropboxUserInfo } from '@/hooks/use-dropbox-user';
import type { DetectedFolder } from './DropboxFolderBrowser';

// ─── window stubs ─────────────────────────────────────────────────────────────

// jsdom doesn't implement matchMedia; stub it so applyTheme() doesn't throw.
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

function stubElectronAPI(quitAndInstall = vi.fn()) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      app: {
        getVersion: vi.fn().mockResolvedValue('1.0.0'),
        getPlatform: vi.fn().mockResolvedValue({ platform: 'darwin', appBundlePath: '' }),
        quitAndInstall,
      },
      settings: {
        get: vi.fn().mockResolvedValue({ dropboxFolderPath: '', theme: 'light' }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
  return { quitAndInstall };
}

/**
 * Stub for mismatch-dialog tests.  Includes the `dropbox` namespace so the
 * auto-detection useEffect resolves to the supplied detected folders.
 */
function stubElectronAPIWithDropbox({
  detectedFolders = [] as DetectedFolder[],
  settingsSet = vi.fn().mockResolvedValue(undefined),
  initialFolderPath = '',
} = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      app: {
        getVersion: vi.fn().mockResolvedValue('1.0.0'),
        getPlatform: vi.fn().mockResolvedValue({ platform: 'darwin', appBundlePath: '' }),
        quitAndInstall: vi.fn(),
      },
      settings: {
        get: vi.fn().mockResolvedValue({ dropboxFolderPath: initialFolderPath, theme: 'light' }),
        set: settingsSet,
      },
      dropbox: {
        findNapaAdminFolders: vi.fn().mockResolvedValue({ ok: true, folders: detectedFolders }),
        testFolderPath: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
  });
  return { settingsSet };
}

// ─── Prop helpers ─────────────────────────────────────────────────────────────

const disconnectedDropboxUser: DropboxUserInfo = { connected: false };
const noop = () => {};

function defaultProps(
  overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {},
) {
  return {
    open: true,
    onOpenChange: noop,
    dropboxUser: disconnectedDropboxUser,
    onDropboxDisconnect: noop,
    onDropboxRefresh: noop,
    currentUser: 'Test Admin',
    onCurrentUserChange: noop,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SettingsPanel — Restart to Install button', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls quitAndInstall when the Restart button is clicked', () => {
    const { quitAndInstall } = stubElectronAPI();

    render(<SettingsPanel {...defaultProps({ updateReady: true })} />);

    const restartButton = screen.getByRole('button', { name: /restart/i });
    fireEvent.click(restartButton);

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenChange(false) before quitAndInstall when Restart is clicked', () => {
    const callOrder: string[] = [];
    const quitAndInstall = vi.fn(() => { callOrder.push('quitAndInstall'); });
    stubElectronAPI(quitAndInstall);

    const onOpenChange = vi.fn((_open: boolean) => { callOrder.push('onOpenChange'); });

    render(<SettingsPanel {...defaultProps({ updateReady: true, onOpenChange })} />);

    const restartButton = screen.getByRole('button', { name: /restart/i });
    fireEvent.click(restartButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    // onOpenChange must fire before quitAndInstall so the dialog dismisses
    // before the app begins shutting down.
    expect(callOrder).toEqual(['onOpenChange', 'quitAndInstall']);
  });

  it('renders the Restart button when updateReady is true', () => {
    stubElectronAPI();

    render(<SettingsPanel {...defaultProps({ updateReady: true })} />);

    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });

  it('does not render the Restart button when updateReady is false', () => {
    stubElectronAPI();

    render(<SettingsPanel {...defaultProps({ updateReady: false })} />);

    expect(
      screen.queryByRole('button', { name: /restart/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render the Restart button when updateReady is omitted', () => {
    stubElectronAPI();

    render(<SettingsPanel {...defaultProps()} />);

    expect(
      screen.queryByRole('button', { name: /restart/i }),
    ).not.toBeInTheDocument();
  });

  it('calls quitAndInstall exactly once even when the button is clicked twice rapidly', () => {
    const { quitAndInstall } = stubElectronAPI();

    render(<SettingsPanel {...defaultProps({ updateReady: true })} />);

    const restartButton = screen.getByRole('button', { name: /restart/i });
    fireEvent.click(restartButton);
    fireEvent.click(restartButton);

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('disables the Restart button after the first click', () => {
    stubElectronAPI();

    render(<SettingsPanel {...defaultProps({ updateReady: true })} />);

    const restartButton = screen.getByRole('button', { name: /restart/i });
    expect(restartButton).not.toBeDisabled();

    fireEvent.click(restartButton);

    expect(restartButton).toBeDisabled();
  });
});

// ─── Download progress bar ────────────────────────────────────────────────────

describe('SettingsPanel — download progress bar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the progress bar when downloadProgress is set and updateReady is false', () => {
    stubElectronAPI();

    render(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: { percent: 42, bytesPerSecond: 1000, transferred: 42, total: 100 },
          updateReady: false,
        })}
      />,
    );

    expect(screen.getByText(/downloading update/i)).toBeInTheDocument();
  });

  it('displays the correct percent label', () => {
    stubElectronAPI();

    render(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: { percent: 42, bytesPerSecond: 1000, transferred: 42, total: 100 },
          updateReady: false,
        })}
      />,
    );

    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('rounds the percent value when it is fractional', () => {
    stubElectronAPI();

    render(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: { percent: 73.7, bytesPerSecond: 500, transferred: 73, total: 100 },
          updateReady: false,
        })}
      />,
    );

    expect(screen.getByText('74%')).toBeInTheDocument();
  });

  it('hides the progress bar and shows the Restart button once updateReady becomes true', () => {
    stubElectronAPI();

    const { rerender } = render(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: { percent: 99, bytesPerSecond: 500, transferred: 99, total: 100 },
          updateReady: false,
        })}
      />,
    );

    // Progress bar is visible during download.
    expect(screen.getByText(/downloading update/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart/i })).not.toBeInTheDocument();

    // Update finishes — parent sets updateReady: true.
    rerender(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: null,
          updateReady: true,
        })}
      />,
    );

    expect(screen.queryByText(/downloading update/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });

  it('does not show the progress bar when downloadProgress is null', () => {
    stubElectronAPI();

    render(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: null,
          updateReady: false,
        })}
      />,
    );

    expect(screen.queryByText(/downloading update/i)).not.toBeInTheDocument();
  });

  it('does not show the progress bar when updateReady is already true', () => {
    stubElectronAPI();

    // Both props set — updateReady wins; the progress bar should not appear.
    render(
      <SettingsPanel
        {...defaultProps({
          downloadProgress: { percent: 80, bytesPerSecond: 800, transferred: 80, total: 100 },
          updateReady: true,
        })}
      />,
    );

    expect(screen.queryByText(/downloading update/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });
});

// ─── Mismatch confirmation dialog ─────────────────────────────────────────────

/**
 * These tests cover the guard in `saveFolderPath`: when the typed folder path
 * doesn't match the parent of any auto-detected "NAPA Admin Data" folder, an
 * AlertDialog must appear asking the admin to confirm before saving.
 */
describe('SettingsPanel — mismatch confirmation dialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** A single detected folder whose parent is /napa couriers. */
  const detectedFolders: DetectedFolder[] = [
    {
      name: 'NAPA Admin Data',
      pathDisplay: '/NAPA Couriers/NAPA Admin Data',
      pathLower: '/napa couriers/napa admin data',
    },
  ];

  const connectedDropboxUser: DropboxUserInfo = {
    connected: true,
    name: 'Test Admin',
    email: 'admin@example.com',
  };

  it('opens the mismatch dialog when the typed path does not match any detected parent', async () => {
    stubElectronAPIWithDropbox({ detectedFolders });

    render(
      <SettingsPanel
        {...defaultProps({ dropboxUser: connectedDropboxUser })}
      />,
    );

    // Wait for auto-detection to resolve and populate detectedFolders.
    await waitFor(() =>
      expect(screen.getByText(/existing shared data folder found/i)).toBeInTheDocument(),
    );

    // Type a path that does NOT match /napa couriers.
    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Some Other Folder' } });

    // Click the Save button (first one in the folder-path row).
    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    // The mismatch AlertDialog should now be open.
    expect(await screen.findByText(/use a different folder\?/i)).toBeInTheDocument();
  });

  it('does not open the mismatch dialog when the typed path matches the detected parent', async () => {
    const { settingsSet } = stubElectronAPIWithDropbox({ detectedFolders });

    render(
      <SettingsPanel
        {...defaultProps({ dropboxUser: connectedDropboxUser })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/existing shared data folder found/i)).toBeInTheDocument(),
    );

    // Type the correct parent path (case-insensitive comparison is used internally).
    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/NAPA Couriers' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    // Dialog must NOT appear.
    expect(screen.queryByText(/use a different folder\?/i)).not.toBeInTheDocument();

    // settings.set must have been called immediately (no confirmation needed).
    await waitFor(() => expect(settingsSet).toHaveBeenCalledTimes(1));
    expect(settingsSet).toHaveBeenCalledWith({ dropboxFolderPath: '/NAPA Couriers' });
  });

  it('calls settings.set with the mismatched path when "Save anyway" is clicked', async () => {
    const { settingsSet } = stubElectronAPIWithDropbox({ detectedFolders });

    render(
      <SettingsPanel
        {...defaultProps({ dropboxUser: connectedDropboxUser })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/existing shared data folder found/i)).toBeInTheDocument(),
    );

    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Wrong Folder' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    // Wait for the dialog to appear.
    const saveAnywayButton = await screen.findByRole('button', { name: /save anyway/i });

    // settings.set must NOT have been called yet.
    expect(settingsSet).not.toHaveBeenCalled();

    fireEvent.click(saveAnywayButton);

    await waitFor(() => expect(settingsSet).toHaveBeenCalledTimes(1));
    expect(settingsSet).toHaveBeenCalledWith({ dropboxFolderPath: '/Wrong Folder' });
  });

  it('does not call settings.set when "Go back" is clicked in the mismatch dialog', async () => {
    const { settingsSet } = stubElectronAPIWithDropbox({ detectedFolders });

    render(
      <SettingsPanel
        {...defaultProps({ dropboxUser: connectedDropboxUser })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/existing shared data folder found/i)).toBeInTheDocument(),
    );

    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Wrong Folder' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    const goBackButton = await screen.findByRole('button', { name: /go back/i });
    fireEvent.click(goBackButton);

    // settings.set must not have been called.
    expect(settingsSet).not.toHaveBeenCalled();

    // Dialog should close.
    await waitFor(() =>
      expect(screen.queryByText(/use a different folder\?/i)).not.toBeInTheDocument(),
    );
  });
});

// ─── Save-time path validation ────────────────────────────────────────────────

/**
 * These tests cover the new `validateAndCommit` guard: when the admin clicks
 * Save (and the mismatch check passes), the app calls testFolderPath via IPC
 * before writing the setting.  A not-found response must show an inline error
 * and prevent the setting from being saved.
 */
describe('SettingsPanel — save-time path validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const connectedDropboxUser: DropboxUserInfo = {
    connected: true,
    name: 'Test Admin',
    email: 'admin@example.com',
  };

  /**
   * Stub with no detected folders so the mismatch check is skipped and
   * validateAndCommit fires immediately on Save.
   */
  function stubWithTestFolderPath({
    testFolderPathResult,
    settingsSet = vi.fn().mockResolvedValue(undefined),
  }: {
    testFolderPathResult: { ok: boolean; error?: string; message?: string };
    settingsSet?: ReturnType<typeof vi.fn>;
  }) {
    const testFolderPath = vi.fn().mockResolvedValue(testFolderPathResult);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        app: {
          getVersion: vi.fn().mockResolvedValue('1.0.0'),
          getPlatform: vi.fn().mockResolvedValue({ platform: 'darwin', appBundlePath: '' }),
          quitAndInstall: vi.fn(),
        },
        settings: {
          get: vi.fn().mockResolvedValue({ dropboxFolderPath: '', theme: 'light' }),
          set: settingsSet,
        },
        dropbox: {
          findNapaAdminFolders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
          testFolderPath,
        },
      },
    });
    return { testFolderPath, settingsSet };
  }

  it('saves the path when testFolderPath returns ok', async () => {
    const { settingsSet } = stubWithTestFolderPath({
      testFolderPathResult: { ok: true, message: '✓ Path is accessible (no data yet)' },
    });

    render(
      <SettingsPanel {...defaultProps({ dropboxUser: connectedDropboxUser })} />,
    );

    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Valid Folder' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => expect(settingsSet).toHaveBeenCalledTimes(1));
    expect(settingsSet).toHaveBeenCalledWith({ dropboxFolderPath: '/Valid Folder' });

    // No inline error should be shown.
    expect(
      screen.queryByText(/not found in your dropbox/i),
    ).not.toBeInTheDocument();
  });

  it('shows an inline error and does not save when testFolderPath returns not-found', async () => {
    const { settingsSet } = stubWithTestFolderPath({
      testFolderPathResult: {
        ok: false,
        error: 'Folder not found in your Dropbox: /Bad Path',
      },
    });

    render(
      <SettingsPanel {...defaultProps({ dropboxUser: connectedDropboxUser })} />,
    );

    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Bad Path' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    // Inline error must appear.
    expect(
      await screen.findByText(/not found in your dropbox/i),
    ).toBeInTheDocument();

    // settings.set must NOT have been called.
    expect(settingsSet).not.toHaveBeenCalled();
  });

  it('skips validation and saves directly when Dropbox is disconnected', async () => {
    const settingsSet = vi.fn().mockResolvedValue(undefined);
    const testFolderPath = vi.fn();

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        app: {
          getVersion: vi.fn().mockResolvedValue('1.0.0'),
          getPlatform: vi.fn().mockResolvedValue({ platform: 'darwin', appBundlePath: '' }),
          quitAndInstall: vi.fn(),
        },
        settings: {
          get: vi.fn().mockResolvedValue({ dropboxFolderPath: '', theme: 'light' }),
          set: settingsSet,
        },
        // dropbox namespace is intentionally omitted — the component is
        // disconnected and must not call testFolderPath at all.
      },
    });

    render(
      <SettingsPanel {...defaultProps({ dropboxUser: disconnectedDropboxUser })} />,
    );

    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Offline Path' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    // Path saved without any Dropbox call.
    await waitFor(() => expect(settingsSet).toHaveBeenCalledTimes(1));
    expect(settingsSet).toHaveBeenCalledWith({ dropboxFolderPath: '/Offline Path' });
    expect(testFolderPath).not.toHaveBeenCalled();
  });

  it('disables the path input while validation is in progress', async () => {
    // Use a never-resolving promise to freeze the component mid-validation.
    let resolve!: (v: { ok: boolean }) => void;
    const pending = new Promise<{ ok: boolean }>((r) => { resolve = r; });

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        app: {
          getVersion: vi.fn().mockResolvedValue('1.0.0'),
          getPlatform: vi.fn().mockResolvedValue({ platform: 'darwin', appBundlePath: '' }),
          quitAndInstall: vi.fn(),
        },
        settings: {
          get: vi.fn().mockResolvedValue({ dropboxFolderPath: '', theme: 'light' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        dropbox: {
          findNapaAdminFolders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
          testFolderPath: vi.fn().mockReturnValue(pending),
        },
      },
    });

    render(
      <SettingsPanel {...defaultProps({ dropboxUser: connectedDropboxUser })} />,
    );

    const input = screen.getByRole('textbox', { name: /data folder path/i });
    fireEvent.change(input, { target: { value: '/Some Path' } });

    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    fireEvent.click(saveButtons[0]);

    // While the validation promise is pending, the input must be disabled.
    await waitFor(() => expect(input).toBeDisabled());

    // Resolve the promise to unblock the component.
    resolve({ ok: true });

    await waitFor(() => expect(input).not.toBeDisabled());
  });
});

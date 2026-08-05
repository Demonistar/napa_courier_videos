/**
 * Integration tests for AdminDashboard — update-badge lifecycle.
 *
 * These tests verify that:
 *   1. The update badge (green dot on the Settings button) appears when
 *      window.electronAPI.app.getUpdateStatus resolves { updateDownloaded: true }.
 *   2. The badge is absent when getUpdateStatus resolves { updateDownloaded: false }.
 *   3. The badge appears when the onUpdateReady push event fires mid-session.
 *   4. After a simulated restart (remount with updateDownloaded: false), the badge
 *      is absent — confirming the "badge disappears once the admin restarts" path.
 *
 * AdminDashboard owns the updateReady state and IPC subscription; TopBar renders
 * the badge. Testing them together exercises the full wire from IPC → state →
 * badge visibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminDashboard from './AdminDashboard';

// ─── Mock heavy dependencies so AdminDashboard renders without real Electron ──

vi.mock('@/lib/store', () => ({
  useLocationStore: () => ({
    state: {
      locations: [],
      publishedLocations: [],
      auditLog: [],
      currentUser: 'Test Admin',
    },
    isLoading: false,
    isSaving: false,
    hasConflict: false,
    conflictMessage: null,
    pendingChangesCount: 0,
    addLocation: vi.fn(),
    updateLocation: vi.fn(),
    deleteLocation: vi.fn(),
    publish: vi.fn().mockResolvedValue(true),
    exportData: vi.fn(),
    exportCsv: vi.fn(),
    setCurrentUser: vi.fn(),
    getAuditHistory: vi.fn(() => []),
    getBackups: vi.fn().mockResolvedValue([]),
    restoreBackup: vi.fn().mockResolvedValue(true),
    restoreSingleLocation: vi.fn().mockResolvedValue(true),
    resolveConflict: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-dropbox-user', () => ({
  useDropboxUser: () => ({
    user: { connected: false },
    disconnect: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ─── electronAPI stub factory ─────────────────────────────────────────────────

type UpdateReadyListener = () => void;
type DownloadProgressInfo = { percent: number; bytesPerSecond: number; transferred: number; total: number };
type DownloadProgressListener = (info: DownloadProgressInfo) => void;

function makeElectronAPI(updateDownloaded: boolean) {
  // Capture the listeners so tests can fire them programmatically.
  let storedReadyListener: UpdateReadyListener | null = null;
  let storedCancelledListener: UpdateReadyListener | null = null;
  let storedProgressListener: DownloadProgressListener | null = null;

  const api = {
    app: {
      getUpdateStatus: vi.fn().mockResolvedValue({ updateDownloaded }),
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      getPlatform: vi.fn().mockResolvedValue({ platform: 'darwin', appBundlePath: '' }),
      onUpdateReady: vi.fn().mockImplementation((cb: UpdateReadyListener) => {
        storedReadyListener = cb;
        // Return cleanup function.
        return () => { storedReadyListener = null; };
      }),
      onUpdateCancelled: vi.fn().mockImplementation((cb: UpdateReadyListener) => {
        storedCancelledListener = cb;
        return () => { storedCancelledListener = null; };
      }),
      onDownloadProgress: vi.fn().mockImplementation((cb: DownloadProgressListener) => {
        storedProgressListener = cb;
        return () => { storedProgressListener = null; };
      }),
    },
    auth: {
      getStatus: vi.fn().mockResolvedValue({ authenticated: false }),
      startOAuth: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onAuthChange: vi.fn().mockReturnValue(() => {}),
    },
    data: {
      load: vi.fn().mockResolvedValue({ locations: [], auditLog: [], currentUser: 'Test Admin' }),
      publish: vi.fn().mockResolvedValue({ ok: true }),
    },
    settings: {
      get: vi.fn().mockResolvedValue({ dropboxFolderPath: '', theme: 'light' }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    dropbox: {
      findNapaAdminFolders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      testFolderPath: vi.fn().mockResolvedValue({ ok: true }),
      uploadImage: vi.fn(),
      downloadImage: vi.fn(),
    },
  };

  type Helpers = {
    _fireUpdateReady: () => void;
    _fireUpdateCancelled: () => void;
    _fireDownloadProgress: (info: DownloadProgressInfo) => void;
  };

  // Expose helpers to fire push events in tests.
  (api as typeof api & Helpers)._fireUpdateReady = () => { storedReadyListener?.(); };
  (api as typeof api & Helpers)._fireUpdateCancelled = () => { storedCancelledListener?.(); };
  (api as typeof api & Helpers)._fireDownloadProgress = (info) => { storedProgressListener?.(info); };

  return api as typeof api & Helpers;
}

function setElectronAPI(api: ReturnType<typeof makeElectronAPI>) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: api,
  });
}

// ─── Render helper ────────────────────────────────────────────────────────────

function renderDashboard() {
  return render(
    <TooltipProvider>
      <AdminDashboard onLogout={vi.fn()} initialUser="Test Admin" />
    </TooltipProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminDashboard — update badge lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the update badge when getUpdateStatus returns updateDownloaded: true', async () => {
    const api = makeElectronAPI(true);
    setElectronAPI(api);

    renderDashboard();

    // Wait for the useEffect promise to resolve and state to update.
    await waitFor(() => {
      expect(screen.getByLabelText('Update available')).toBeInTheDocument();
    });

    expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
  });

  it('does not show the update badge when getUpdateStatus returns updateDownloaded: false', async () => {
    const api = makeElectronAPI(false);
    setElectronAPI(api);

    renderDashboard();

    // Give the effect time to settle; the badge should never appear.
    await waitFor(() => {
      expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
    });

    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });

  it('shows the badge when the onUpdateReady push event fires mid-session', async () => {
    const api = makeElectronAPI(false);
    setElectronAPI(api);

    renderDashboard();

    // Effect has run; no badge yet.
    await waitFor(() => {
      expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
    });
    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();

    // Simulate the main process pushing an update-ready event.
    act(() => { api._fireUpdateReady(); });

    expect(screen.getByLabelText('Update available')).toBeInTheDocument();
  });

  it('hides the badge when the onUpdateCancelled push event fires mid-session', async () => {
    // Start with a completed download so the badge is visible.
    const api = makeElectronAPI(true);
    setElectronAPI(api);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Update available')).toBeInTheDocument();
    });

    // Main process signals that the download was cancelled / errored.
    act(() => { api._fireUpdateCancelled(); });

    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });

  it('badge is absent after a simulated restart (remount with updateDownloaded: false)', async () => {
    // First launch: update was already downloaded, badge should appear.
    const apiBeforeRestart = makeElectronAPI(true);
    setElectronAPI(apiBeforeRestart);

    const { unmount } = renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Update available')).toBeInTheDocument();
    });

    // Admin clicks "Restart to Install" → app quits and relaunches.
    // Model that by unmounting (quit) then remounting (fresh launch) with
    // getUpdateStatus returning false — the installed version has no pending update.
    unmount();

    const apiAfterRestart = makeElectronAPI(false);
    setElectronAPI(apiAfterRestart);

    renderDashboard();

    await waitFor(() => {
      expect(apiAfterRestart.app.getUpdateStatus).toHaveBeenCalledOnce();
    });

    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });
});

// ─── Download progress flow ───────────────────────────────────────────────────

describe('AdminDashboard — download progress flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to onDownloadProgress on mount', async () => {
    const api = makeElectronAPI(false);
    setElectronAPI(api);

    renderDashboard();

    await waitFor(() => {
      expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
    });

    expect(api.app.onDownloadProgress).toHaveBeenCalledOnce();
  });

  it('passes downloadProgress into SettingsPanel so the progress bar appears', async () => {
    const api = makeElectronAPI(false);
    setElectronAPI(api);

    renderDashboard();

    await waitFor(() => {
      expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
    });

    // Fire a download-progress push event from the main process.
    act(() => {
      api._fireDownloadProgress({ percent: 57, bytesPerSecond: 2000, transferred: 57, total: 100 });
    });

    // Open the Settings panel.
    fireEvent.click(screen.getByTestId('button-settings'));

    // The progress bar section and the percent label must be visible.
    await waitFor(() => {
      expect(screen.getByText(/downloading update/i)).toBeInTheDocument();
    });
    expect(screen.getByText('57%')).toBeInTheDocument();
  });

  it('clears downloadProgress when the update-ready event fires', async () => {
    const api = makeElectronAPI(false);
    setElectronAPI(api);

    renderDashboard();

    await waitFor(() => {
      expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
    });

    // Simulate a download in progress.
    act(() => {
      api._fireDownloadProgress({ percent: 90, bytesPerSecond: 1500, transferred: 90, total: 100 });
    });

    // Open Settings and confirm progress bar is showing.
    fireEvent.click(screen.getByTestId('button-settings'));

    await waitFor(() => {
      expect(screen.getByText(/downloading update/i)).toBeInTheDocument();
    });

    // Main process signals download complete → updateReady fires.
    act(() => { api._fireUpdateReady(); });

    // Progress bar should disappear; Restart button should appear.
    expect(screen.queryByText(/downloading update/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });

  it('walks the full 0% → 100% → restart flow through the same IPC path', async () => {
    const api = makeElectronAPI(false);
    setElectronAPI(api);

    renderDashboard();

    await waitFor(() => {
      expect(api.app.getUpdateStatus).toHaveBeenCalledOnce();
    });

    // Open Settings before any progress arrives.
    fireEvent.click(screen.getByTestId('button-settings'));

    // ── 0% ──────────────────────────────────────────────────────────────
    act(() => {
      api._fireDownloadProgress({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 100 });
    });

    await waitFor(() => {
      expect(screen.getByText(/downloading update/i)).toBeInTheDocument();
    });
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart/i })).not.toBeInTheDocument();

    // ── 100% ─────────────────────────────────────────────────────────────
    act(() => {
      api._fireDownloadProgress({ percent: 100, bytesPerSecond: 2000, transferred: 100, total: 100 });
    });

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/downloading update/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart/i })).not.toBeInTheDocument();

    // ── update-ready → restart ─────────────────────────────────────────
    act(() => { api._fireUpdateReady(); });

    expect(screen.queryByText(/downloading update/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });
});

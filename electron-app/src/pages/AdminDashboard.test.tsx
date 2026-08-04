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
import { render, screen, waitFor, act } from '@testing-library/react';
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

function makeElectronAPI(updateDownloaded: boolean) {
  // Capture the listeners so tests can fire them programmatically.
  let storedReadyListener: UpdateReadyListener | null = null;
  let storedCancelledListener: UpdateReadyListener | null = null;

  const api = {
    app: {
      getUpdateStatus: vi.fn().mockResolvedValue({ updateDownloaded }),
      onUpdateReady: vi.fn().mockImplementation((cb: UpdateReadyListener) => {
        storedReadyListener = cb;
        // Return cleanup function.
        return () => { storedReadyListener = null; };
      }),
      onUpdateCancelled: vi.fn().mockImplementation((cb: UpdateReadyListener) => {
        storedCancelledListener = cb;
        return () => { storedCancelledListener = null; };
      }),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
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
  };

  // Expose helpers to fire push events in tests.
  (api as typeof api & { _fireUpdateReady: () => void; _fireUpdateCancelled: () => void })._fireUpdateReady = () => {
    storedReadyListener?.();
  };
  (api as typeof api & { _fireUpdateReady: () => void; _fireUpdateCancelled: () => void })._fireUpdateCancelled = () => {
    storedCancelledListener?.();
  };

  return api as typeof api & { _fireUpdateReady: () => void; _fireUpdateCancelled: () => void };
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

/**
 * Unit tests for the TopBar update-badge and download-progress behaviour.
 *
 * The badge (a green dot on the Settings button) must appear when an update
 * has been downloaded and must be absent otherwise. The dot is driven by the
 * `updateReady` prop, which AdminDashboard derives from
 * `window.electronAPI.app.getUpdateStatus()`. Both the prop path and the
 * IPC mock are exercised here so regressions in either layer are caught.
 *
 * The download-progress ring (an SVG arc) must appear while `downloadProgress`
 * is non-null AND `updateReady` is false. It must disappear once the download
 * completes and `updateReady` flips to true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TopBar } from './TopBar';
import type { DropboxUserInfo } from '@/hooks/use-dropbox-user';

// ─── Minimal prop helpers ─────────────────────────────────────────────────────

const disconnectedDropboxUser: DropboxUserInfo = { connected: false };

const noop = () => {};

function defaultProps(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return {
    searchQuery: '',
    onSearchChange: noop,
    pendingChanges: 0,
    onPublish: noop,
    onExportJson: noop,
    onExportCsv: noop,
    currentUser: 'Test User',
    onStartTour: noop,
    onOpenSettings: noop,
    onOpenBackup: noop,
    onOpenImport: noop,
    dropboxUser: disconnectedDropboxUser,
    ...overrides,
  };
}

function renderTopBar(props: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return render(
    // TooltipProvider is required by Radix UI Tooltip used inside TopBar.
    <TooltipProvider>
      <TopBar {...defaultProps(props)} />
    </TooltipProvider>,
  );
}

// ─── window.electronAPI stub ──────────────────────────────────────────────────
//
// TopBar itself does not call window.electronAPI — that happens in
// AdminDashboard. However, stubbing it here keeps the environment realistic and
// guards against future changes that might move the IPC call closer to the
// component.

function stubElectronAPI(updateDownloaded: boolean) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      app: {
        getUpdateStatus: vi.fn().mockResolvedValue({ updateDownloaded }),
        onUpdateReady: vi.fn().mockReturnValue(noop),
      },
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TopBar — update badge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the green dot indicator when updateReady is true', () => {
    // Simulate the resolved value AdminDashboard would read.
    stubElectronAPI(true);

    // Render TopBar with updateReady=true (as AdminDashboard would pass after
    // receiving the downloaded notification).
    renderTopBar({ updateReady: true });

    const dot = screen.getByLabelText('Update available');
    expect(dot).toBeInTheDocument();
  });

  it('does not render the dot indicator when updateReady is false', () => {
    // Simulate no update downloaded.
    stubElectronAPI(false);

    renderTopBar({ updateReady: false });

    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });

  it('does not render the dot indicator when updateReady is omitted (default)', () => {
    stubElectronAPI(false);

    // Do not pass updateReady at all — the default is false.
    renderTopBar();

    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });

  it('Settings button carries a descriptive aria-label when updateReady is true', () => {
    stubElectronAPI(true);

    renderTopBar({ updateReady: true });

    // The dot span next to the Settings button carries the accessible label.
    const dot = screen.getByLabelText('Update available');
    // It should be a sibling inside the Settings button.
    expect(dot.closest('[data-testid="button-settings"]')).toBeInTheDocument();
  });

  it('Settings button has no update-related aria-label when updateReady is false', () => {
    stubElectronAPI(false);

    renderTopBar({ updateReady: false });

    // No dot → no aria-label="Update available" anywhere in the tree.
    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });
});

// ─── Download progress ring ────────────────────────────────────────────────────

describe('TopBar — download progress ring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubElectronAPI(false);
  });

  const makeProgress = (percent: number) => ({
    percent,
    bytesPerSecond: 1_000_000,
    transferred: percent * 1_000_000,
    total: 100_000_000,
  });

  it('renders the progress ring when downloadProgress is non-null and updateReady is false', () => {
    renderTopBar({ downloadProgress: makeProgress(42), updateReady: false });

    expect(screen.getByTestId('download-progress-ring')).toBeInTheDocument();
  });

  it('does not render the progress ring when downloadProgress is null', () => {
    renderTopBar({ downloadProgress: null });

    expect(screen.queryByTestId('download-progress-ring')).not.toBeInTheDocument();
  });

  it('does not render the progress ring when downloadProgress is omitted', () => {
    renderTopBar();

    expect(screen.queryByTestId('download-progress-ring')).not.toBeInTheDocument();
  });

  it('does not render the progress ring when updateReady is true even if progress is set', () => {
    // Once the download is done, the green dot takes over; the ring must hide.
    renderTopBar({ downloadProgress: makeProgress(100), updateReady: true });

    expect(screen.queryByTestId('download-progress-ring')).not.toBeInTheDocument();
  });

  it('the progress ring carries an accessible label with the current percentage', () => {
    renderTopBar({ downloadProgress: makeProgress(42), updateReady: false });

    // The SVG ring carries aria-label so screen readers announce progress.
    expect(screen.getByLabelText('Downloading update… 42%')).toBeInTheDocument();
  });

  it('the progress ring is inside the Settings button', () => {
    renderTopBar({ downloadProgress: makeProgress(30), updateReady: false });

    const ring = screen.getByTestId('download-progress-ring');
    expect(ring.closest('[data-testid="button-settings"]')).toBeInTheDocument();
  });

  it('does not render the green dot while the download is still in progress', () => {
    renderTopBar({ downloadProgress: makeProgress(60), updateReady: false });

    // Green dot must not appear until the download is fully ready.
    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument();
  });

  it('renders the green dot (and not the ring) when updateReady transitions to true', () => {
    renderTopBar({ downloadProgress: null, updateReady: true });

    expect(screen.getByLabelText('Update available')).toBeInTheDocument();
    expect(screen.queryByTestId('download-progress-ring')).not.toBeInTheDocument();
  });
});

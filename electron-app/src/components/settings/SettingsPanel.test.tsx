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
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import type { DropboxUserInfo } from '@/hooks/use-dropbox-user';

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
});

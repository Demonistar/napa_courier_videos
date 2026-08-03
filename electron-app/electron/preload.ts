import { contextBridge, ipcRenderer } from 'electron';

// ─── Types exposed to the renderer ───────────────────────────────────────────
// These mirror the IPC handler signatures in main.ts.

export interface DropboxUser {
  name: string;
  email: string;
  accountId: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: DropboxUser;
  authAge?: number;    // days since initial login
  needsReauth?: boolean; // true when within 7 days of 30-day expiry
}

export interface AppSettings {
  dropboxFolderPath: string;
  displayNameOverride?: string;
}

export interface BackupMeta {
  id: string;
  label: string;
  timestamp: string;
  locationId: string | null;
  locationName: string | null;
  dropboxPath: string;
}

export type IpcResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; conflict?: boolean; error: string };

// ─── API surface ──────────────────────────────────────────────────────────────

const api = {
  auth: {
    getStatus: (): Promise<AuthStatus> =>
      ipcRenderer.invoke('auth:status'),
    login: (): Promise<{ ok: boolean; user?: DropboxUser; error?: string }> =>
      ipcRenderer.invoke('auth:login'),
    logout: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('auth:logout'),
  },

  data: {
    loadStaging: (): Promise<{ ok: boolean; data?: unknown; rev?: string; error?: string }> =>
      ipcRenderer.invoke('data:loadStaging'),
    loadLive: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('data:loadLive'),
    saveStaging: (data: unknown, rev: string): Promise<{ ok: boolean; conflict?: boolean; newRev?: string; error?: string }> =>
      ipcRenderer.invoke('data:saveStaging', data, rev),
    publish: (locations: unknown[], publishedBy: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('data:publish', locations, publishedBy),
    listBackups: (): Promise<{ ok: boolean; backups?: BackupMeta[]; error?: string }> =>
      ipcRenderer.invoke('data:listBackups'),
    loadBackup: (dropboxPath: string): Promise<{ ok: boolean; snapshot?: unknown; error?: string }> =>
      ipcRenderer.invoke('data:loadBackup', dropboxPath),
    saveBackup: (entry: unknown): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('data:saveBackup', entry),
  },

  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:get'),
    set: (updates: Partial<AppSettings>): Promise<void> =>
      ipcRenderer.invoke('settings:set', updates),
  },

  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke('app:getVersion'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

// ─── TypeScript global declaration (used by renderer) ────────────────────────

declare global {
  interface Window {
    electronAPI: typeof api;
  }
}

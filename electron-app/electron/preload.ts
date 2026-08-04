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
  theme?: 'light' | 'dark' | 'system';
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
    getUpdateStatus: (): Promise<{ updateDownloaded: boolean }> =>
      ipcRenderer.invoke('app:getUpdateStatus'),
    onUpdateReady: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('app:updateReady', handler);
      // Return a cleanup function so callers can remove the listener.
      return () => ipcRenderer.removeListener('app:updateReady', handler);
    },
    /** Fired when a download that had already set the badge fails mid-session. */
    onUpdateCancelled: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('app:updateCancelled', handler);
      return () => ipcRenderer.removeListener('app:updateCancelled', handler);
    },
    /** Fired repeatedly while an update is downloading. Percent is 0–100. */
    onDownloadProgress: (callback: (info: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => callback(info);
      ipcRenderer.on('app:downloadProgress', handler);
      return () => ipcRenderer.removeListener('app:downloadProgress', handler);
    },
    quitAndInstall: (): Promise<void> =>
      ipcRenderer.invoke('app:quitAndInstall'),
    /** Returns the OS platform string and the .app path on macOS. */
    getPlatform: (): Promise<{ platform: string; appBundlePath: string | null }> =>
      ipcRenderer.invoke('app:getPlatform'),
    /**
     * Windows: launches the NSIS uninstaller and quits.
     * macOS:   returns the .app bundle path for manual drag-to-Trash instructions.
     * Dropbox data is NEVER touched by either path.
     */
    uninstall: (): Promise<{
      ok: boolean;
      platform?: string;
      appBundlePath?: string;
      error?: string;
    }> => ipcRenderer.invoke('app:uninstall'),
  },

  dropbox: {
    /** List immediate subfolders at a Dropbox path. Pass '' for the root. */
    listFolder: (path: string): Promise<{
      ok: boolean;
      folders?: Array<{ name: string; pathDisplay: string; pathLower: string }>;
      error?: string;
    }> => ipcRenderer.invoke('dropbox:listFolder', path),

    /** Search the entire Dropbox for folders named "NAPA Admin Data". */
    findNapaAdminFolders: (): Promise<{
      ok: boolean;
      folders?: Array<{ name: string; pathDisplay: string; pathLower: string }>;
      error?: string;
    }> => ipcRenderer.invoke('dropbox:findNapaAdminFolders'),

    /**
     * Test whether a folder path is accessible in Dropbox and whether the
     * "NAPA Admin Data" subfolder already exists inside it.
     * Returns ok:true with a human-readable message on success, or
     * ok:false with the Dropbox error message on failure.
     */
    testFolderPath: (path: string): Promise<{
      ok: boolean;
      message?: string;
      error?: string;
    }> => ipcRenderer.invoke('dropbox:testFolderPath', path),

    /**
     * Scan a Dropbox folder and return a public shareable link for every file.
     * Existing links are reused; new ones created only when none exist.
     */
    generateLinks: (folderPath: string): Promise<{
      ok: boolean;
      files?: number;
      results?: Array<{ name: string; path: string; url: string; reused: boolean; error?: string }>;
      error?: string;
    }> => ipcRenderer.invoke('dropbox:generateLinks', folderPath),

    /**
     * Upload an image file into NAPA Admin Data/images/ and return the
     * relative path "images/<filename>" to store in the location record.
     */
    uploadImage: (payload: { base64: string; fileName: string }): Promise<{
      ok: boolean;
      relativePath?: string;
      error?: string;
    }> => ipcRenderer.invoke('dropbox:uploadImage', payload),

    /**
     * Download an image from NAPA Admin Data/<relativePath> and return it as
     * a base64 data URI for display in an <img> tag.
     */
    downloadImage: (relativePath: string): Promise<{
      ok: boolean;
      dataUri?: string;
      error?: string;
    }> => ipcRenderer.invoke('dropbox:downloadImage', relativePath),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

// ─── TypeScript global declaration (used by renderer) ────────────────────────

declare global {
  interface Window {
    electronAPI: typeof api;
  }
}

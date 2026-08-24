/**
 * Type declarations for the contextBridge API exposed by electron/preload.ts.
 * Consumed by the renderer (src/) so TypeScript knows the shape of window.electronAPI.
 */

export interface DropboxUser {
  name: string;
  email: string;
  accountId: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: DropboxUser;
  authAge?: number;
  needsReauth?: boolean;
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

declare global {
  interface Window {
    electronAPI: {
      auth: {
        getStatus(): Promise<AuthStatus>;
        login(): Promise<{ ok: boolean; user?: DropboxUser; error?: string }>;
        logout(): Promise<{ ok: boolean }>;
      };
      data: {
        loadStaging(): Promise<{ ok: boolean; data?: unknown; rev?: string; error?: string }>;
        loadLive(): Promise<{ ok: boolean; data?: unknown; error?: string }>;
        saveStaging(
          data: unknown,
          rev: string,
        ): Promise<{ ok: boolean; conflict?: boolean; newRev?: string; error?: string }>;
        publish(
          locations: unknown[],
          publishedBy: string,
        ): Promise<{ ok: boolean; error?: string }>;
        listBackups(): Promise<{ ok: boolean; backups?: BackupMeta[]; error?: string }>;
        loadBackup(
          dropboxPath: string,
        ): Promise<{ ok: boolean; snapshot?: unknown; error?: string }>;
        saveBackup(entry: unknown): Promise<{ ok: boolean; error?: string }>;
        loadLookup(): Promise<{
          ok: boolean;
          data?: Record<string, { address?: string; city?: string; state?: string }>;
          error?: string;
        }>;
        upsertLookupEntry(
          accountNumber: string,
          updates: { address?: string; city?: string; state?: string },
        ): Promise<{ ok: boolean; error?: string }>;
        seedLookupFromBundle(): Promise<{
          ok: boolean;
          added?: number;
          alreadyPresent?: number;
          totalInSeed?: number;
          error?: string;
        }>;
      };
      settings: {
        get(): Promise<AppSettings>;
        set(updates: Partial<AppSettings>): Promise<void>;
      };
      menu: {
        /** Subscribe to File → Save. Returns a cleanup function to remove the listener. */
        onManualSave(callback: () => void): () => void;
        /** Subscribe to File → Backup Now. Returns a cleanup function to remove the listener. */
        onManualBackup(callback: () => void): () => void;
      };
    };
  }
}

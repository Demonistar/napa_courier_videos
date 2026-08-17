import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  safeStorage,
  nativeTheme,
  Menu,
  MenuItem,
  dialog,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  initAutoUpdater,
  checkForUpdatesManually,
  getUpdateDownloaded,
  setCheckForUpdatesMenuItem,
} from './updater';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ─── Build-time config (set via .env before running `pnpm run package`) ───────

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY ?? '2nrt3uf9qy4oosn';
const DEFAULT_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH ?? '/Delivery Optimization/Delivery Walk Through Videos';

// ─── Paths ────────────────────────────────────────────────────────────────────

const USER_DATA = app.getPath('userData');
const TOKEN_FILE = path.join(USER_DATA, 'dropbox-token.enc');
const SETTINGS_FILE = path.join(USER_DATA, 'app-settings.json');

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: number; // unix ms — access token expiry (typically 4 hours)
  authenticatedAt: number; // unix ms — when user originally logged in
}

interface AppSettings {
  dropboxFolderPath: string;
  displayNameOverride?: string;
  theme?: 'light' | 'dark' | 'system';
}

interface DropboxUser {
  name: string;
  email: string;
  accountId: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as AppSettings;
    }
  } catch { /* fall through */ }
  return { dropboxFolderPath: DEFAULT_FOLDER_PATH };
}

function saveSettings(s: Partial<AppSettings>): void {
  const current = loadSettings();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, ...s }, null, 2));
}

// ─── Token storage (encrypted with OS keychain via safeStorage / DPAPI) ───────

function saveToken(token: StoredToken): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback for dev environments — plain JSON (never ship without encryption)
    fs.writeFileSync(TOKEN_FILE + '.plain', JSON.stringify(token));
    return;
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(token));
  fs.writeFileSync(TOKEN_FILE, encrypted);
}

function loadToken(): StoredToken | null {
  try {
    // Try encrypted first
    if (fs.existsSync(TOKEN_FILE) && safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(TOKEN_FILE);
      const json = safeStorage.decryptString(buf);
      const token = JSON.parse(json) as StoredToken;
      // Enforce 30-day re-auth regardless of Dropbox token validity
      if (Date.now() - token.authenticatedAt > 30 * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(TOKEN_FILE);
        return null;
      }
      return token;
    }
    // Fallback plain file (dev only)
    const plain = TOKEN_FILE + '.plain';
    if (fs.existsSync(plain)) {
      const token = JSON.parse(fs.readFileSync(plain, 'utf8')) as StoredToken;
      if (Date.now() - token.authenticatedAt > 30 * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(plain);
        return null;
      }
      return token;
    }
  } catch { /* corrupted — treat as logged out */ }
  return null;
}

function clearToken(): void {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  if (fs.existsSync(TOKEN_FILE + '.plain')) fs.unlinkSync(TOKEN_FILE + '.plain');
}

// ─── Dropbox token refresh ────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: DROPBOX_APP_KEY,
    }),
  });
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getValidToken(): Promise<StoredToken> {
  const token = loadToken();
  if (!token) throw new Error('NOT_AUTHENTICATED');

  // Refresh if expiring within 5 minutes
  if (token.expiresAt < Date.now() + 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(token.refreshToken);
    const updated: StoredToken = { ...token, ...refreshed };
    saveToken(updated);
    return updated;
  }
  return token;
}

// ─── Dropbox API helpers ──────────────────────────────────────────────────────

async function dbxApi(endpoint: string, body: unknown): Promise<Response> {
  const token = await getValidToken();
  return fetch(`https://api.dropboxapi.com/2${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function dbxDownload(dropboxPath: string): Promise<{ content: string; rev: string } | null> {
  const token = await getValidToken();
  const resp = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
    },
  });
  if (resp.status === 409) return null; // file not found
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const apiResult = JSON.parse(resp.headers.get('dropbox-api-result') ?? '{}') as { rev: string };
  const content = await resp.text();
  return { content, rev: apiResult.rev ?? '' };
}

/** Download raw bytes from Dropbox — used for images. */
async function dbxDownloadBytes(dropboxPath: string): Promise<Buffer | null> {
  const token = await getValidToken();
  const resp = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
    },
  });
  if (resp.status === 409) return null; // file not found
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Build a deterministic, filesystem-safe image filename from a location's
 * account number and site name.
 * e.g. accountNumber="63", siteName="BMW of NWA", ext="png"
 *   → "63-BMW-OF-NWA.png"
 */
function sanitizeImageName(accountNumber: string, siteName: string, ext: string): string {
  const safePart = (s: string) =>
    s.trim().toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')   // non-alphanumeric runs → single dash
      .replace(/^-+|-+$/g, '');       // trim leading/trailing dashes
  const acc  = safePart(accountNumber);
  const site = safePart(siteName);
  const safeExt = (ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = [acc, site].filter(Boolean).join('-') || `upload-${Date.now()}`;
  return `${base}.${safeExt}`;
}

/**
 * Upload a file to Dropbox.
 * @param mode 'overwrite' | { update: rev } — use update+rev for write-safety.
 * Returns the new rev on success, or throws with code 'CONFLICT' on rev mismatch.
 */
async function dbxUpload(
  dropboxPath: string,
  content: string | Buffer,
  mode: 'overwrite' | { update: string } = 'overwrite',
): Promise<string> {
  const token = await getValidToken();
  const modeArg = mode === 'overwrite'
    ? { '.tag': 'overwrite' }
    : { '.tag': 'update', update: mode.update };

  const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: dropboxPath,
        mode: modeArg,
        autorename: false,
        mute: true,
      }),
    },
    body: content,
  });

  if (resp.status === 409) {
    const err = await resp.json() as { error?: { '.tag'?: string } };
    const tag = err?.error?.['.tag'] ?? '';
    if (tag === 'conflict') {
      const conflictErr = new Error('Another admin saved changes since you loaded. Reload to get the latest data before editing.');
      (conflictErr as Error & { code: string }).code = 'CONFLICT';
      throw conflictErr;
    }
  }

  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  const result = await resp.json() as { rev: string };
  return result.rev;
}

async function dbxDelete(dropboxPath: string): Promise<void> {
  const resp = await dbxApi('/files/delete_v2', { path: dropboxPath });
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`Delete failed: ${resp.status}`);
  }
}

async function dbxListFolder(dropboxPath: string): Promise<Array<{ name: string; path_lower: string; rev?: string }>> {
  const resp = await dbxApi('/files/list_folder', { path: dropboxPath });
  if (resp.status === 409) return []; // folder doesn't exist yet
  if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
  const data = await resp.json() as { entries: Array<{ name: string; path_lower: string; rev?: string }> };
  return data.entries;
}

// ─── OAuth PKCE flow ──────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function findFreePort(start = 47291, end = 47299): Promise<number> {
  for (let port = start; port <= end; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => { srv.close(); resolve(true); });
      srv.listen(port, '127.0.0.1');
    });
    if (available) return port;
  }
  throw new Error('No free port found in range 47291–47299. Add these as redirect URIs in your Dropbox app.');
}

async function runOAuthFlow(): Promise<StoredToken> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const port = await findFreePort();
  const redirectUri = `http://localhost:${port}/callback`;

  const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', DROPBOX_APP_KEY);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('token_access_type', 'offline');

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><head><title>NAPA Courier Admin</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa}
.box{text-align:center;padding:2rem;border-radius:12px;background:white;box-shadow:0 4px 24px rgba(0,0,0,.1)}
h1{color:#16a34a;margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="box"><h1>✅ Signed in successfully!</h1><p>You can close this tab and return to NAPA Courier Admin.</p></div></body></html>`);
          server.close();
          resolve(code);
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><body><h1>❌ Sign-in failed: ${error ?? 'unknown error'}. Close this tab and try again.</h1></body></html>`);
          server.close();
          reject(new Error(error ?? 'oauth_error'));
        }
      } catch (e) {
        res.writeHead(500);
        res.end();
        reject(e);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      shell.openExternal(authUrl.toString());
    });

    // 10-minute timeout
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out after 10 minutes.'));
    }, 10 * 60 * 1000);
  });

  // Exchange code for tokens
  const tokenResp = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: DROPBOX_APP_KEY,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokenData = await tokenResp.json() as {
    access_token: string;
    refresh_token: string;
    account_id: string;
    expires_in: number;
  };

  const token: StoredToken = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    accountId: tokenData.account_id,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    authenticatedAt: Date.now(),
  };

  saveToken(token);
  return token;
}

// ─── Dropbox data operations ──────────────────────────────────────────────────

function folderPath(folder: string, file: string): string {
  return `${folder.replace(/\/$/, '')}/NAPA Admin Data/${file}`;
}

/**
 * One-time migration: scan locations for inline base64 imageUrls, upload each
 * as a real file into NAPA Admin Data/images/, and replace the stored value
 * with the relative path "images/<filename>".  Returns true if any records
 * were updated (caller should re-save staging).
 */
async function migrateBase64Images(
  folder: string,
  staging: { locations?: Array<{ imageUrl?: string | null; accountNumber?: string; siteName?: string }> },
): Promise<boolean> {
  const locations = staging.locations ?? [];
  let changed = false;
  for (const loc of locations) {
    const url = loc.imageUrl ?? '';
    if (!url.startsWith('data:image/')) continue;

    // Parse "data:image/png;base64,<data>"
    const match = url.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/s);
    if (!match) continue;
    const ext     = match[1].split('+')[0].toLowerCase();  // e.g. "png", "jpeg"
    const b64data = match[2];

    const fileName = sanitizeImageName(loc.accountNumber ?? '', loc.siteName ?? '', ext === 'jpeg' ? 'jpg' : ext);
    const dropboxImagePath = folderPath(folder, `images/${fileName}`);

    try {
      const buf = Buffer.from(b64data, 'base64');
      await dbxUpload(dropboxImagePath, buf);
      loc.imageUrl = `images/${fileName}`;
      changed = true;
      console.log(`[migrate] Uploaded ${fileName} for "${loc.siteName ?? ''}"`);
    } catch (err) {
      console.error(`[migrate] Failed to upload image for "${loc.siteName ?? ''}":`, err);
      // Leave the base64 value in place — better than losing the image.
    }
  }
  return changed;
}

async function loadStagingFile(folder: string) {
  const result = await dbxDownload(folderPath(folder, 'locations-staging.json'));
  if (!result) {
    // First run — return empty state
    return {
      data: {
        version: 1,
        locations: [],
        auditLog: [],
        currentUser: 'Admin',
        lastModified: new Date().toISOString(),
      },
      rev: '',
    };
  }
  const data = JSON.parse(result.content);
  let { rev } = result;

  // Transparently migrate any legacy base64 imageUrls to Dropbox files.
  try {
    const migrated = await migrateBase64Images(folder, data);
    if (migrated) {
      const newRev = await dbxUpload(
        folderPath(folder, 'locations-staging.json'),
        JSON.stringify({ ...data, lastModified: new Date().toISOString() }, null, 2),
      );
      rev = newRev;
      console.log('[migrate] Staging file re-saved with image paths.');
    }
  } catch (err) {
    console.error('[migrate] Migration error (non-fatal):', err);
  }

  return { data, rev };
}

async function saveStagingFile(
  folder: string,
  data: unknown,
  rev: string,
  force = false,
): Promise<{ ok: boolean; conflict?: boolean; newRev?: string; error?: string }> {
  try {
    let mode: 'overwrite' | { update: string };
    if (rev) {
      // Normal path: use the rev we loaded — Dropbox rejects on mismatch
      mode = { update: rev };
    } else if (force) {
      // Explicit admin-confirmed force-overwrite after conflict dialog
      mode = 'overwrite';
    } else {
      // No rev and no explicit force — check whether the file already exists.
      // A blind overwrite here would clobber data we've never loaded.
      const metaResp = await dbxApi('/files/get_metadata', {
        path: folderPath(folder, 'locations-staging.json'),
      });
      if (metaResp.ok) {
        // File exists but caller has no rev — real conflict, reject save
        return {
          ok: false,
          conflict: true,
          error: 'Staging file already exists in Dropbox but this session has no rev for it. Reload before saving.',
        };
      }
      if (metaResp.status !== 409) {
        throw new Error(`Metadata check failed: ${metaResp.status}`);
      }
      // 409 → file does not exist → safe to create
      mode = 'overwrite';
    }
    const newRev = await dbxUpload(
      folderPath(folder, 'locations-staging.json'),
      JSON.stringify({ ...data as object, lastModified: new Date().toISOString() }, null, 2),
      mode,
    );
    return { ok: true, newRev };
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    if (e.code === 'CONFLICT') return { ok: false, conflict: true, error: e.message };
    return { ok: false, error: e.message };
  }
}

async function publishToLive(
  folder: string,
  locations: unknown[],
  publishedBy: string,
  liveRev = '',
): Promise<{ ok: boolean; newRev?: string; conflict?: boolean; error?: string }> {
  try {
    const payload = {
      version: 1,
      publishedAt: new Date().toISOString(),
      publishedBy,
      locations,
    };

    let mode: 'overwrite' | { update: string };
    if (liveRev) {
      // Use the rev we loaded — concurrent publish will produce a Dropbox 409
      mode = { update: liveRev };
    } else {
      // No rev held — check whether the live file already exists before writing
      const metaResp = await dbxApi('/files/get_metadata', {
        path: folderPath(folder, 'locations-live.json'),
      });
      if (metaResp.ok) {
        // File exists but we have no rev — would clobber content we haven't loaded
        return {
          ok: false,
          conflict: true,
          error: 'The live file exists in Dropbox but this session has no rev for it. Reload before publishing.',
        };
      }
      if (metaResp.status !== 409) {
        throw new Error(`Metadata check failed: ${metaResp.status}`);
      }
      // 409 → file does not exist → first publish, safe to create
      mode = 'overwrite';
    }

    const newRev = await dbxUpload(
      folderPath(folder, 'locations-live.json'),
      JSON.stringify(payload, null, 2),
      mode,
    );
    return { ok: true, newRev };
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    if (e.code === 'CONFLICT') return { ok: false, conflict: true, error: e.message };
    return { ok: false, error: e.message };
  }
}

// ─── Customer address lookup ────────────────────────────────────────────────

interface LookupEntry {
  address?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  customerName?: string;
}

async function loadLookupFile(folder: string): Promise<Record<string, LookupEntry>> {
  const result = await dbxDownload(folderPath(folder, 'customer-lookup.json'));
  if (!result) return {};
  try {
    return JSON.parse(result.content) as Record<string, LookupEntry>;
  } catch (err) {
    console.error('[lookup] Failed to parse customer-lookup.json:', err);
    return {};
  }
}

/**
 * Merges a partial address update into the lookup entry for one account
 * number and writes the whole file back. Last-write-wins for this file —
 * concurrent edits to *different* account numbers from different admins are
 * safe (each write re-downloads and merges before uploading), but two admins
 * correcting the *same* account number in the same instant could race.
 * Acceptable for this data: address corrections are infrequent, and the next
 * save re-syncs whichever value was most recently typed, so it's self-healing.
 */
async function upsertLookupEntry(
  folder: string,
  accountNumber: string,
  updates: Partial<LookupEntry>,
): Promise<void> {
  if (!accountNumber.trim()) return;
  const lookup = await loadLookupFile(folder);
  const existing = lookup[accountNumber] ?? {};
  lookup[accountNumber] = { ...existing, ...updates };
  await dbxUpload(
    folderPath(folder, 'customer-lookup.json'),
    JSON.stringify(lookup, null, 2),
  );
}

const MAX_BACKUPS = 20;

async function listBackups(folder: string): Promise<Array<{ id: string; label: string; timestamp: string; locationId: string | null; locationName: string | null; dropboxPath: string }>> {
  const backupsPath = folderPath(folder, 'backups');
  try {
    const entries = await dbxListFolder(backupsPath);
    const backupFiles = entries
      .filter((e) => e.name.startsWith('backup-') && e.name.endsWith('.json'))
      .sort((a, b) => b.name.localeCompare(a.name)) // newest first
      .slice(0, MAX_BACKUPS);

    const results = await Promise.all(
      backupFiles.map(async (entry) => {
        const dl = await dbxDownload(entry.path_lower);
        if (!dl) return null;
        const meta = JSON.parse(dl.content) as {
          id: string; label: string; timestamp: string;
          locationId: string | null; locationName: string | null;
        };
        return {
          id: meta.id,
          label: meta.label,
          timestamp: meta.timestamp,
          locationId: meta.locationId ?? null,
          locationName: meta.locationName ?? null,
          dropboxPath: entry.path_lower,
        };
      }),
    );

    return results.filter(Boolean) as Array<{ id: string; label: string; timestamp: string; locationId: string | null; locationName: string | null; dropboxPath: string }>;
  } catch {
    return [];
  }
}

async function loadBackupSnapshot(dropboxPath: string): Promise<unknown> {
  const dl = await dbxDownload(dropboxPath);
  if (!dl) throw new Error('Backup file not found');
  return JSON.parse(dl.content);
}

async function saveBackup(
  folder: string,
  entry: {
    id: string; label: string; timestamp: string;
    locationId: string | null; locationName: string | null;
    snapshot: unknown;
  },
): Promise<void> {
  const safeName = entry.timestamp.replace(/[:.]/g, '-');
  const backupPath = folderPath(folder, `backups/backup-${safeName}.json`);
  await dbxUpload(backupPath, JSON.stringify(entry, null, 2));

  // Prune to MAX_BACKUPS
  try {
    const backupsDir = folderPath(folder, 'backups');
    const entries = await dbxListFolder(backupsDir);
    const files = entries
      .filter((e) => e.name.startsWith('backup-') && e.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name)); // oldest first

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      await Promise.all(toDelete.map((f) => dbxDelete(f.path_lower)));
    }
  } catch { /* pruning failure is non-fatal */ }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Auth ──────────────────────────────────────────────────────────────────

  ipcMain.handle('auth:status', async () => {
    const token = loadToken();
    if (!token) return { authenticated: false };

    const needsReauth = Date.now() - token.authenticatedAt > 23 * 24 * 60 * 60 * 1000; // warn at 23 days
    try {
      const resp = await dbxApi('/users/get_current_account', null);
      if (!resp.ok) return { authenticated: false };
      const account = await resp.json() as { name: { display_name: string }; email: string; account_id: string };
      return {
        authenticated: true,
        needsReauth,
        authAge: Math.floor((Date.now() - token.authenticatedAt) / (24 * 60 * 60 * 1000)),
        user: {
          name: account.name.display_name,
          email: account.email,
          accountId: account.account_id,
        },
      };
    } catch {
      return { authenticated: false };
    }
  });

  ipcMain.handle('auth:login', async () => {
    try {
      const token = await runOAuthFlow();
      // Fetch user info immediately
      const resp = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (!resp.ok) return { ok: false, error: 'Login succeeded but user fetch failed.' };
      const account = await resp.json() as { name: { display_name: string }; email: string; account_id: string };
      return {
        ok: true,
        user: { name: account.name.display_name, email: account.email, accountId: account.account_id },
      };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('auth:logout', () => {
    clearToken();
    return { ok: true };
  });

  // ── Data ──────────────────────────────────────────────────────────────────

  ipcMain.handle('data:loadStaging', async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const { data, rev } = await loadStagingFile(dropboxFolderPath);
      return { ok: true, data, rev };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('data:saveStaging', async (_event, data: unknown, rev: string, force = false) => {
    const { dropboxFolderPath } = loadSettings();
    return saveStagingFile(dropboxFolderPath, data, rev, force);
  });

  ipcMain.handle('data:publish', async (_event, locations: unknown[], publishedBy: string, liveRev = '') => {
    const { dropboxFolderPath } = loadSettings();
    return publishToLive(dropboxFolderPath, locations, publishedBy, liveRev);
  });

  ipcMain.handle('data:loadLive', async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const result = await dbxDownload(folderPath(dropboxFolderPath, 'locations-live.json'));
      if (!result) return { ok: true, data: null, rev: '' }; // live file doesn't exist yet
      return { ok: true, data: JSON.parse(result.content), rev: result.rev };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('data:listBackups', async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const backups = await listBackups(dropboxFolderPath);
      return { ok: true, backups };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message, backups: [] };
    }
  });

  ipcMain.handle('data:loadBackup', async (_event, dropboxPath: string) => {
    try {
      const snapshot = await loadBackupSnapshot(dropboxPath);
      return { ok: true, snapshot };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('data:saveBackup', async (_event, entry: unknown) => {
    const { dropboxFolderPath } = loadSettings();
    try {
      await saveBackup(dropboxFolderPath, entry as Parameters<typeof saveBackup>[1]);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('data:loadLookup', async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const lookup = await loadLookupFile(dropboxFolderPath);
      return { ok: true, data: lookup };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(
    'data:upsertLookupEntry',
    async (_event, accountNumber: string, updates: Partial<LookupEntry>) => {
      const { dropboxFolderPath } = loadSettings();
      try {
        await upsertLookupEntry(dropboxFolderPath, accountNumber, updates);
        return { ok: true };
      } catch (err: unknown) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => loadSettings());

  ipcMain.handle('settings:set', (_event, updates: Partial<AppSettings>) => {
    saveSettings(updates);
    // Apply theme change immediately so the native OS window title bar / menus
    // update without requiring a restart.
    if (updates.theme) {
      nativeTheme.themeSource = updates.theme;
    }
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('app:getUpdateStatus', () => ({
    updateDownloaded: getUpdateDownloaded(),
  }));

  ipcMain.handle('app:quitAndInstall', () => {
    if (getUpdateDownloaded()) {
      // Dismiss the update badge in the renderer before we disappear so the
      // notice doesn't linger if the restart is delayed by OS dialogs.
      BrowserWindow.getAllWindows()[0]?.webContents.send('app:updateCancelled');
      autoUpdater.quitAndInstall();
    }
  });

  /** Returns the OS platform and, on macOS, the resolved .app bundle path. */
  ipcMain.handle('app:getPlatform', () => {
    const platform = process.platform;
    let appBundlePath: string | null = null;
    if (platform === 'darwin') {
      // exe is e.g. /Applications/NAPA Courier Admin.app/Contents/MacOS/NAPA Courier Admin
      // Strip back to the .app bundle root for display to the user.
      appBundlePath = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '');
    }
    return { platform, appBundlePath };
  });

  /**
   * Windows: locate the NSIS-generated Uninstall.exe in the install directory,
   * launch it detached, then quit immediately so the app isn't holding its own
   * files open during removal.  Returns an error object if the uninstaller can't
   * be found so the renderer can show a useful fallback message.
   *
   * macOS: no programmatic self-uninstall is attempted.  Returns the .app bundle
   * path so the renderer can show exact drag-to-Trash instructions.  Nothing is
   * deleted or modified.
   *
   * In both cases Dropbox is NEVER touched — this is purely a local-install action.
   */
  ipcMain.handle('app:uninstall', () => {
    if (process.platform === 'win32') {
      // electron-builder NSIS names the uninstaller "Uninstall {productName}.exe"
      // and places it alongside the main executable.
      const installDir = path.dirname(app.getPath('exe'));
      const uninstallerPath = path.join(installDir, `Uninstall ${app.getName()}.exe`);

      if (!fs.existsSync(uninstallerPath)) {
        return {
          ok: false,
          platform: 'win32',
          error: `Uninstaller not found at:\n${uninstallerPath}\n\nYou can remove the app manually via Windows Settings → Apps → Installed apps.`,
        };
      }

      // Spawn detached with stdio ignored so the child survives after we quit.
      const child = spawn(uninstallerPath, [], { detached: true, stdio: 'ignore' });
      child.unref();

      // Short delay so the NSIS process is past its startup before we exit.
      setTimeout(() => app.quit(), 400);
      return { ok: true, platform: 'win32' };
    }

    if (process.platform === 'darwin') {
      // Return the bundle path for the manual-instructions dialog.  We do not
      // attempt self-deletion of the .app bundle.
      const appBundlePath = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '');
      return { ok: true, platform: 'darwin', appBundlePath };
    }

    return { ok: false, platform: process.platform, error: 'Uninstall is not supported on this platform.' };
  });

  // ── Dropbox folder browser ─────────────────────────────────────────────────

  /**
   * List immediate subfolders at a Dropbox path.
   * Pass path='' for the Dropbox root.  Returns only folder entries (not files).
   */
  ipcMain.handle('dropbox:listFolder', async (_event, path: string) => {
    try {
      type EntryRaw = { '.tag': string; name: string; path_display: string; path_lower: string };
      type ListFolderPage = { entries: EntryRaw[]; has_more: boolean; cursor: string };

      // First page
      const firstResp = await dbxApi('/files/list_folder', {
        path,                               // '' = root; '/Foo/Bar' = subfolder
        include_non_downloadable_files: false,
      });
      if (firstResp.status === 409) return { ok: true, folders: [] }; // path doesn't exist
      if (!firstResp.ok) throw new Error(`List failed: ${firstResp.status}`);

      let page = await firstResp.json() as ListFolderPage;
      const allEntries: EntryRaw[] = [...page.entries];

      // Follow pagination until Dropbox signals has_more = false
      while (page.has_more) {
        const token = await getValidToken();
        const contResp = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cursor: page.cursor }),
        });
        if (!contResp.ok) throw new Error(`List continue failed: ${contResp.status}`);
        page = await contResp.json() as ListFolderPage;
        allEntries.push(...page.entries);
      }

      const folders = allEntries
        .filter(e => e['.tag'] === 'folder')
        .map(e => ({ name: e.name, pathDisplay: e.path_display, pathLower: e.path_lower }));
      return { ok: true, folders };
    } catch (err) {
      return { ok: false, error: (err as Error).message, folders: [] };
    }
  });

  /**
   * Search the entire connected Dropbox account for folders whose name is
   * exactly "NAPA Admin Data" (case-insensitive).  Used on Settings open to
   * steer new admins to the folder every other admin is already using.
   */
  ipcMain.handle('dropbox:findNapaAdminFolders', async () => {
    try {
      type SearchMatch = {
        metadata?: {
          '.tag'?: string;
          metadata?: { '.tag'?: string; name?: string; path_display?: string; path_lower?: string };
        };
      };
      type SearchPage = { matches?: SearchMatch[]; has_more: boolean; cursor: string };

      const resp = await dbxApi('/files/search_v2', {
        query: 'NAPA Admin Data',
        options: { filename_only: true },
      });
      if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);

      let page = await resp.json() as SearchPage;
      const allMatches: SearchMatch[] = [...(page.matches ?? [])];

      // Follow pagination until Dropbox signals has_more = false
      while (page.has_more) {
        const contResp = await dbxApi('/files/search_v2/continue', { cursor: page.cursor });
        if (!contResp.ok) throw new Error(`Search continue failed: ${contResp.status}`);
        page = await contResp.json() as SearchPage;
        allMatches.push(...(page.matches ?? []));
      }

      const folders = allMatches
        .filter(m =>
          m?.metadata?.metadata?.['.tag'] === 'folder' &&
          m?.metadata?.metadata?.name?.toLowerCase() === 'napa admin data'
        )
        .map(m => ({
          name:        m.metadata!.metadata!.name!,
          pathDisplay: m.metadata!.metadata!.path_display!,
          pathLower:   m.metadata!.metadata!.path_lower!,
        }));
      return { ok: true, folders };
    } catch (err) {
      return { ok: false, error: (err as Error).message, folders: [] };
    }
  });

  /**
   * Test whether a given folder path is accessible in Dropbox and whether the
   * "NAPA Admin Data" subfolder already exists inside it.
   *
   * - Returns { ok: true, message: '✓ Found existing data folder' } when the
   *   NAPA Admin Data subfolder already exists at the path.
   * - Returns { ok: true, message: '✓ Path is accessible (no data yet)' } when
   *   the parent folder exists but no data subfolder has been created yet.
   * - Returns { ok: false, error: '…' } with the Dropbox error message when the
   *   folder is not found or any other API error occurs.
   */
  ipcMain.handle('dropbox:testFolderPath', async (_event, testPath: string) => {
    try {
      const normalized = (testPath ?? '').replace(/\/$/, '');
      const napaDataPath = normalized
        ? `${normalized}/NAPA Admin Data`
        : '/NAPA Admin Data';

      // First: does the NAPA Admin Data subfolder already exist?
      const napaResp = await dbxApi('/files/get_metadata', { path: napaDataPath });

      if (napaResp.ok) {
        return { ok: true, message: '✓ Found existing data folder' };
      }

      if (napaResp.status === 409) {
        // Subfolder not found — check whether the parent path itself is reachable.
        // The Dropbox root ('') is always reachable so skip the extra call.
        if (!normalized) {
          return { ok: true, message: '✓ Path is accessible (no data yet)' };
        }

        const parentResp = await dbxApi('/files/get_metadata', { path: normalized });

        if (parentResp.ok) {
          return { ok: true, message: '✓ Path is accessible (no data yet)' };
        }

        if (parentResp.status === 409) {
          return { ok: false, error: `Folder not found in your Dropbox: ${normalized}` };
        }

        const errText = await parentResp.text().catch(() => String(parentResp.status));
        return { ok: false, error: `Dropbox error ${parentResp.status}: ${errText}` };
      }

      const errText = await napaResp.text().catch(() => String(napaResp.status));
      return { ok: false, error: `Dropbox error ${napaResp.status}: ${errText}` };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ── Image upload / download ──────────────────────────────────────────────────

  /**
   * Upload an image file into NAPA Admin Data/images/ and return the relative
   * path that should be stored in the location record ("images/<filename>").
   */
  ipcMain.handle(
    'dropbox:uploadImage',
    async (_event, { base64, fileName }: { base64: string; fileName: string }) => {
      try {
        const folder = loadSettings().dropboxFolderPath;
        if (!folder) return { ok: false, error: 'Dropbox folder path not configured' };
        const buf  = Buffer.from(base64, 'base64');
        const dest = folderPath(folder, `images/${fileName}`);
        await dbxUpload(dest, buf);
        return { ok: true, relativePath: `images/${fileName}` };
      } catch (err: unknown) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  /**
   * Scan a Dropbox folder and return a public shareable link for every file in
   * it.  Existing shared links are reused; new ones are created only when none
   * exist.  Files are processed five at a time to keep latency reasonable for
   * large folders (100 + files).
   */
  ipcMain.handle('dropbox:generateLinks', async (_event, folderPath: string) => {
    interface FileEntry { name: string; path_lower: string; path_display: string }
    interface LinkResult {
      name: string; path: string; url: string; reused: boolean; error?: string;
    }

    try {
      // ── Step 1: collect all files in the folder (paginated) ──────────────
      const files: FileEntry[] = [];
      type ListData = {
        entries: Array<{ '.tag': string; name: string; path_lower: string; path_display: string }>;
        cursor: string; has_more: boolean;
      };

      let resp = await dbxApi('/files/list_folder', { path: folderPath, recursive: false, limit: 2000 });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => String(resp.status));
        return { ok: false, error: `Could not list folder: ${msg}` };
      }
      let page = await resp.json() as ListData;
      for (const e of page.entries) {
        if (e['.tag'] === 'file') files.push({ name: e.name, path_lower: e.path_lower, path_display: e.path_display });
      }
      while (page.has_more) {
        resp = await dbxApi('/files/list_folder/continue', { cursor: page.cursor });
        if (!resp.ok) break;
        page = await resp.json() as ListData;
        for (const e of page.entries) {
          if (e['.tag'] === 'file') files.push({ name: e.name, path_lower: e.path_lower, path_display: e.path_display });
        }
      }

      if (files.length === 0) return { ok: true, files: 0, results: [] };

      // ── Step 2: get or create shared link for a single file ───────────────
      const getOrCreate = async (file: FileEntry): Promise<LinkResult> => {
        try {
          // Check for an existing direct link first
          const listResp = await dbxApi('/sharing/list_shared_links', {
            path: file.path_lower, direct_only: true,
          });
          if (listResp.ok) {
            const listData = await listResp.json() as { links: Array<{ url: string }> };
            if (listData.links?.length > 0) {
              return { name: file.name, path: file.path_display, url: listData.links[0].url, reused: true };
            }
          }

          // Create a new public link
          const createResp = await dbxApi('/sharing/create_shared_link_with_settings', {
            path: file.path_lower,
            settings: { requested_visibility: 'public' },
          });

          if (createResp.ok) {
            const cd = await createResp.json() as { url: string };
            return { name: file.name, path: file.path_display, url: cd.url, reused: false };
          }

          if (createResp.status === 409) {
            // The link already exists — Dropbox returns it in the error body
            const ed = await createResp.json() as {
              error?: { '.tag': string; metadata?: { url?: string } };
            };
            if (ed?.error?.['.tag'] === 'shared_link_already_exists') {
              const existingUrl = ed.error!.metadata?.url;
              if (existingUrl) return { name: file.name, path: file.path_display, url: existingUrl, reused: true };
              // Rare: metadata missing — list again
              const fl = await dbxApi('/sharing/list_shared_links', { path: file.path_lower });
              if (fl.ok) {
                const fd = await fl.json() as { links: Array<{ url: string }> };
                const url = fd.links?.[0]?.url ?? '';
                return { name: file.name, path: file.path_display, url, reused: true };
              }
            }
          }

          const bodyText = await createResp.text().catch(() => '');
          let reason = bodyText;
          try {
            const parsed = JSON.parse(bodyText) as { error?: { '.tag'?: string }; error_summary?: string };
            reason = parsed.error_summary || parsed.error?.['.tag'] || bodyText;
          } catch { /* not JSON, use raw body text as-is */ }
          return { name: file.name, path: file.path_display, url: '', reused: false,
            error: `HTTP ${createResp.status}: ${reason || 'no details returned'}` };
        } catch (err: unknown) {
          return { name: file.name, path: file.path_display, url: '', reused: false,
            error: (err as Error).message };
        }
      };

      // ── Step 3: process in batches of 5 ──────────────────────────────────
      const results: LinkResult[] = [];
      const BATCH = 5;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(getOrCreate));
        results.push(...batchResults);
      }

      return { ok: true, files: files.length, results };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });

  /**
   * Download an image from NAPA Admin Data/<relativePath> and return it as a
   * base64 data URI suitable for use in an <img src="…"> tag.
   */
  ipcMain.handle('dropbox:downloadImage', async (_event, relativePath: string) => {
    try {
      const folder = loadSettings().dropboxFolderPath;
      if (!folder) return { ok: false, error: 'Dropbox folder path not configured' };
      const src = folderPath(folder, relativePath);
      const buf = await dbxDownloadBytes(src);
      if (!buf) return { ok: false, error: 'Image not found' };
      const ext  = relativePath.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : ext === 'webp'                  ? 'image/webp'
                 : ext === 'gif'                   ? 'image/gif'
                 : 'image/png';
      return { ok: true, dataUri: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

/**
 * Build a macOS-compatible application menu.
 *
 * On macOS, Electron apps do NOT get a default Edit menu, which means standard
 * keyboard shortcuts (Cmd+C, Cmd+V, Cmd+A, Cmd+Z, Cmd+X) are silently broken
 * in every text input unless you explicitly create a menu with those roles.
 * This function wires them all up. On Windows/Linux the system handles this
 * natively, but the menu is harmless there too.
 */
function buildAppMenu(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  const template: (Electron.MenuItemConstructorOptions | MenuItem)[] = [
    // macOS requires the first menu item to be the app name menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => win.webContents.send('menu:manualSave'),
        },
        {
          label: 'Backup Now',
          click: () => win.webContents.send('menu:manualBackup'),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    // Edit menu — this is the critical one for text field shortcuts on macOS
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' as const },
              { role: 'stopSpeaking' as const },
            ],
          },
        ] : []),
      ],
    },
    // View menu — dev tools only in development
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        ...(process.env.NODE_ENV === 'development' ? [
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const },
        ] : []),
      ],
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
    // Help menu — available on all platforms
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: (menuItem) => {
            setCheckForUpdatesMenuItem(menuItem);
            checkForUpdatesManually(win);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'NAPA Courier Admin',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required because contextBridge + ipcRenderer in preload
      // needs access to Node.js-side APIs that the renderer sandbox blocks.
      // safeStorage lives entirely in the main process and is unrelated.
      sandbox: false,
    },
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Open external links in the system browser, not Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  return win;
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  nativeTheme.themeSource = loadSettings().theme ?? 'light';
  registerIpcHandlers();
  const win = createMainWindow();
  buildAppMenu(win);       // needs win for the Help → Check for Updates handler
  initAutoUpdater(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

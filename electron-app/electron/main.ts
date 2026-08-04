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
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ─── Build-time config (set via .env before running `npm run package`) ────────

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY ?? '';
const DEFAULT_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH ?? '/NAPA Courier Admin';

if (!DROPBOX_APP_KEY) {
  console.warn(
    '[NAPA] DROPBOX_APP_KEY not set. Copy .env.example to .env and fill in your Dropbox App Key.',
  );
}

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

/**
 * Upload a file to Dropbox.
 * @param mode 'overwrite' | { update: rev } — use update+rev for write-safety.
 * Returns the new rev on success, or throws with code 'CONFLICT' on rev mismatch.
 */
async function dbxUpload(
  dropboxPath: string,
  content: string,
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
  return { data: JSON.parse(result.content), rev: result.rev };
}

async function saveStagingFile(folder: string, data: unknown, rev: string): Promise<{ ok: boolean; conflict?: boolean; newRev?: string; error?: string }> {
  try {
    const mode = rev ? { update: rev } : 'overwrite' as const;
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

async function publishToLive(folder: string, locations: unknown[], publishedBy: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = {
      version: 1,
      publishedAt: new Date().toISOString(),
      publishedBy,
      locations,
    };
    await dbxUpload(folderPath(folder, 'locations-live.json'), JSON.stringify(payload, null, 2));
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message };
  }
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
      if (!DROPBOX_APP_KEY) {
        return { ok: false, error: 'DROPBOX_APP_KEY is not configured. See .env.example.' };
      }
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

  ipcMain.handle('data:saveStaging', async (_event, data: unknown, rev: string) => {
    const { dropboxFolderPath } = loadSettings();
    return saveStagingFile(dropboxFolderPath, data, rev);
  });

  ipcMain.handle('data:publish', async (_event, locations: unknown[], publishedBy: string) => {
    const { dropboxFolderPath } = loadSettings();
    return publishToLive(dropboxFolderPath, locations, publishedBy);
  });

  ipcMain.handle('data:loadLive', async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const result = await dbxDownload(folderPath(dropboxFolderPath, 'locations-live.json'));
      if (!result) return { ok: true, data: null }; // live file doesn't exist yet
      return { ok: true, data: JSON.parse(result.content) };
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
    if (getUpdateDownloaded()) autoUpdater.quitAndInstall();
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

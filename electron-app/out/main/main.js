"use strict";
const electron = require("electron");
const electronUpdater = require("electron-updater");
const node_http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const NETWORK_ERROR_CODES = [
  "ENOTFOUND",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENETUNREACH",
  "EAI_AGAIN"
];
function isNetworkError(err) {
  const msg = (err?.message ?? "") + (err?.code ?? "");
  return NETWORK_ERROR_CODES.some((code) => msg.includes(code));
}
let _updateDownloaded = false;
let _manualCheckPending = false;
let _checkForUpdatesMenuItem = null;
function getUpdateDownloaded() {
  return _updateDownloaded;
}
function setCheckForUpdatesMenuItem(item) {
  _checkForUpdatesMenuItem = item;
}
function showRestartDialog(win) {
  electron.dialog.showMessageBox(win, {
    type: "info",
    title: "Update ready",
    message: "A new version of NAPA Courier Admin has been downloaded.",
    detail: "Restart now to install the update, or it will be installed automatically the next time you quit.",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0) electronUpdater.autoUpdater.quitAndInstall();
  });
}
function checkForUpdatesManually(win) {
  if (!electron.app.isPackaged) {
    electron.dialog.showMessageBox(win, {
      type: "info",
      title: "Dev build",
      message: "Update checks are only available in the packaged app."
    });
    return;
  }
  if (_updateDownloaded) {
    showRestartDialog(win);
    return;
  }
  if (_manualCheckPending) return;
  _manualCheckPending = true;
  if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = false;
  electronUpdater.autoUpdater.checkForUpdates().catch((err) => {
    console.error("[auto-updater] manual check promise rejected:", err?.message ?? err);
  });
}
function initAutoUpdater(win) {
  if (!electron.app.isPackaged) return;
  electronUpdater.autoUpdater.autoDownload = true;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
  electronUpdater.autoUpdater.on("update-not-available", () => {
    if (_manualCheckPending) {
      _manualCheckPending = false;
      if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
      electron.dialog.showMessageBox(win, {
        type: "info",
        title: "Up to date",
        message: `You're running the latest version (${electron.app.getVersion()}).`
      });
    }
  });
  electronUpdater.autoUpdater.on("update-downloaded", () => {
    _updateDownloaded = true;
    _manualCheckPending = false;
    if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
    win.webContents.send("app:updateReady");
    showRestartDialog(win);
  });
  electronUpdater.autoUpdater.on("error", (err) => {
    const wasManual = _manualCheckPending;
    _manualCheckPending = false;
    if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
    console.error("[auto-updater] error:", err?.message ?? err);
    if (wasManual) {
      const detail = isNetworkError(err) ? "Could not reach the update server — check your internet connection and try again." : err?.message ?? "An unexpected error occurred. Please try again later.";
      electron.dialog.showMessageBox(win, {
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail
      });
    }
  });
  electronUpdater.autoUpdater.checkForUpdates().catch((err) => {
    console.error("[auto-updater] startup check failed:", err?.message ?? err);
  });
}
const DROPBOX_APP_KEY = "2nrt3uf9qy4oosn";
const DEFAULT_FOLDER_PATH = "/Delivery Optimization/Delivery Walk Through Videos";
const USER_DATA = electron.app.getPath("userData");
const TOKEN_FILE = path.join(USER_DATA, "dropbox-token.enc");
const SETTINGS_FILE = path.join(USER_DATA, "app-settings.json");
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    }
  } catch {
  }
  return { dropboxFolderPath: DEFAULT_FOLDER_PATH };
}
function saveSettings(s) {
  const current = loadSettings();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, ...s }, null, 2));
}
function saveToken(token) {
  if (!electron.safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(TOKEN_FILE + ".plain", JSON.stringify(token));
    return;
  }
  const encrypted = electron.safeStorage.encryptString(JSON.stringify(token));
  fs.writeFileSync(TOKEN_FILE, encrypted);
}
function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE) && electron.safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(TOKEN_FILE);
      const json = electron.safeStorage.decryptString(buf);
      const token = JSON.parse(json);
      if (Date.now() - token.authenticatedAt > 30 * 24 * 60 * 60 * 1e3) {
        fs.unlinkSync(TOKEN_FILE);
        return null;
      }
      return token;
    }
    const plain = TOKEN_FILE + ".plain";
    if (fs.existsSync(plain)) {
      const token = JSON.parse(fs.readFileSync(plain, "utf8"));
      if (Date.now() - token.authenticatedAt > 30 * 24 * 60 * 60 * 1e3) {
        fs.unlinkSync(plain);
        return null;
      }
      return token;
    }
  } catch {
  }
  return null;
}
function clearToken() {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  if (fs.existsSync(TOKEN_FILE + ".plain")) fs.unlinkSync(TOKEN_FILE + ".plain");
}
async function refreshAccessToken(refreshToken) {
  const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: DROPBOX_APP_KEY
    })
  });
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
  const data = await resp.json();
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1e3
  };
}
async function getValidToken() {
  const token = loadToken();
  if (!token) throw new Error("NOT_AUTHENTICATED");
  if (token.expiresAt < Date.now() + 5 * 60 * 1e3) {
    const refreshed = await refreshAccessToken(token.refreshToken);
    const updated = { ...token, ...refreshed };
    saveToken(updated);
    return updated;
  }
  return token;
}
async function dbxApi(endpoint, body) {
  const token = await getValidToken();
  return fetch(`https://api.dropboxapi.com/2${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}
async function dbxDownload(dropboxPath) {
  const token = await getValidToken();
  const resp = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath })
    }
  });
  if (resp.status === 409) return null;
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const apiResult = JSON.parse(resp.headers.get("dropbox-api-result") ?? "{}");
  const content = await resp.text();
  return { content, rev: apiResult.rev ?? "" };
}
async function dbxUpload(dropboxPath, content, mode = "overwrite") {
  const token = await getValidToken();
  const modeArg = mode === "overwrite" ? { ".tag": "overwrite" } : { ".tag": "update", update: mode.update };
  const resp = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path: dropboxPath,
        mode: modeArg,
        autorename: false,
        mute: true
      })
    },
    body: content
  });
  if (resp.status === 409) {
    const err = await resp.json();
    const tag = err?.error?.[".tag"] ?? "";
    if (tag === "conflict") {
      const conflictErr = new Error("Another admin saved changes since you loaded. Reload to get the latest data before editing.");
      conflictErr.code = "CONFLICT";
      throw conflictErr;
    }
  }
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  const result = await resp.json();
  return result.rev;
}
async function dbxDelete(dropboxPath) {
  const resp = await dbxApi("/files/delete_v2", { path: dropboxPath });
  if (!resp.ok && resp.status !== 409) {
    throw new Error(`Delete failed: ${resp.status}`);
  }
}
async function dbxListFolder(dropboxPath) {
  const resp = await dbxApi("/files/list_folder", { path: dropboxPath });
  if (resp.status === 409) return [];
  if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
  const data = await resp.json();
  return data.entries;
}
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}
function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
async function findFreePort(start = 47291, end = 47299) {
  for (let port = start; port <= end; port++) {
    const available = await new Promise((resolve) => {
      const srv = node_http.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => {
        srv.close();
        resolve(true);
      });
      srv.listen(port, "127.0.0.1");
    });
    if (available) return port;
  }
  throw new Error("No free port found in range 47291–47299. Add these as redirect URIs in your Dropbox app.");
}
async function runOAuthFlow() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const port = await findFreePort();
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
  authUrl.searchParams.set("client_id", DROPBOX_APP_KEY);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("token_access_type", "offline");
  const code = await new Promise((resolve, reject) => {
    const server = node_http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const code2 = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (code2) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><head><title>NAPA Courier Admin</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa}
.box{text-align:center;padding:2rem;border-radius:12px;background:white;box-shadow:0 4px 24px rgba(0,0,0,.1)}
h1{color:#16a34a;margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="box"><h1>✅ Signed in successfully!</h1><p>You can close this tab and return to NAPA Courier Admin.</p></div></body></html>`);
          server.close();
          resolve(code2);
        } else {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><body><h1>❌ Sign-in failed: ${error ?? "unknown error"}. Close this tab and try again.</h1></body></html>`);
          server.close();
          reject(new Error(error ?? "oauth_error"));
        }
      } catch (e) {
        res.writeHead(500);
        res.end();
        reject(e);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      electron.shell.openExternal(authUrl.toString());
    });
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out after 10 minutes."));
    }, 10 * 60 * 1e3);
  });
  const tokenResp = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: DROPBOX_APP_KEY,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri
    })
  });
  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error(`Token exchange failed: ${err}`);
  }
  const tokenData = await tokenResp.json();
  const token = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    accountId: tokenData.account_id,
    expiresAt: Date.now() + tokenData.expires_in * 1e3,
    authenticatedAt: Date.now()
  };
  saveToken(token);
  return token;
}
function folderPath(folder, file) {
  return `${folder.replace(/\/$/, "")}/NAPA Admin Data/${file}`;
}
async function loadStagingFile(folder) {
  const result = await dbxDownload(folderPath(folder, "locations-staging.json"));
  if (!result) {
    return {
      data: {
        version: 1,
        locations: [],
        auditLog: [],
        currentUser: "Admin",
        lastModified: (/* @__PURE__ */ new Date()).toISOString()
      },
      rev: ""
    };
  }
  return { data: JSON.parse(result.content), rev: result.rev };
}
async function saveStagingFile(folder, data, rev) {
  try {
    const mode = rev ? { update: rev } : "overwrite";
    const newRev = await dbxUpload(
      folderPath(folder, "locations-staging.json"),
      JSON.stringify({ ...data, lastModified: (/* @__PURE__ */ new Date()).toISOString() }, null, 2),
      mode
    );
    return { ok: true, newRev };
  } catch (err) {
    const e = err;
    if (e.code === "CONFLICT") return { ok: false, conflict: true, error: e.message };
    return { ok: false, error: e.message };
  }
}
async function publishToLive(folder, locations, publishedBy) {
  try {
    const payload = {
      version: 1,
      publishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      publishedBy,
      locations
    };
    await dbxUpload(folderPath(folder, "locations-live.json"), JSON.stringify(payload, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
const MAX_BACKUPS = 20;
async function listBackups(folder) {
  const backupsPath = folderPath(folder, "backups");
  try {
    const entries = await dbxListFolder(backupsPath);
    const backupFiles = entries.filter((e) => e.name.startsWith("backup-") && e.name.endsWith(".json")).sort((a, b) => b.name.localeCompare(a.name)).slice(0, MAX_BACKUPS);
    const results = await Promise.all(
      backupFiles.map(async (entry) => {
        const dl = await dbxDownload(entry.path_lower);
        if (!dl) return null;
        const meta = JSON.parse(dl.content);
        return {
          id: meta.id,
          label: meta.label,
          timestamp: meta.timestamp,
          locationId: meta.locationId ?? null,
          locationName: meta.locationName ?? null,
          dropboxPath: entry.path_lower
        };
      })
    );
    return results.filter(Boolean);
  } catch {
    return [];
  }
}
async function loadBackupSnapshot(dropboxPath) {
  const dl = await dbxDownload(dropboxPath);
  if (!dl) throw new Error("Backup file not found");
  return JSON.parse(dl.content);
}
async function saveBackup(folder, entry) {
  const safeName = entry.timestamp.replace(/[:.]/g, "-");
  const backupPath = folderPath(folder, `backups/backup-${safeName}.json`);
  await dbxUpload(backupPath, JSON.stringify(entry, null, 2));
  try {
    const backupsDir = folderPath(folder, "backups");
    const entries = await dbxListFolder(backupsDir);
    const files = entries.filter((e) => e.name.startsWith("backup-") && e.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      await Promise.all(toDelete.map((f) => dbxDelete(f.path_lower)));
    }
  } catch {
  }
}
function registerIpcHandlers() {
  electron.ipcMain.handle("auth:status", async () => {
    const token = loadToken();
    if (!token) return { authenticated: false };
    const needsReauth = Date.now() - token.authenticatedAt > 23 * 24 * 60 * 60 * 1e3;
    try {
      const resp = await dbxApi("/users/get_current_account", null);
      if (!resp.ok) return { authenticated: false };
      const account = await resp.json();
      return {
        authenticated: true,
        needsReauth,
        authAge: Math.floor((Date.now() - token.authenticatedAt) / (24 * 60 * 60 * 1e3)),
        user: {
          name: account.name.display_name,
          email: account.email,
          accountId: account.account_id
        }
      };
    } catch {
      return { authenticated: false };
    }
  });
  electron.ipcMain.handle("auth:login", async () => {
    try {
      if (!DROPBOX_APP_KEY) ;
      const token = await runOAuthFlow();
      const resp = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.accessToken}` }
      });
      if (!resp.ok) return { ok: false, error: "Login succeeded but user fetch failed." };
      const account = await resp.json();
      return {
        ok: true,
        user: { name: account.name.display_name, email: account.email, accountId: account.account_id }
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle("auth:logout", () => {
    clearToken();
    return { ok: true };
  });
  electron.ipcMain.handle("data:loadStaging", async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const { data, rev } = await loadStagingFile(dropboxFolderPath);
      return { ok: true, data, rev };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle("data:saveStaging", async (_event, data, rev) => {
    const { dropboxFolderPath } = loadSettings();
    return saveStagingFile(dropboxFolderPath, data, rev);
  });
  electron.ipcMain.handle("data:publish", async (_event, locations, publishedBy) => {
    const { dropboxFolderPath } = loadSettings();
    return publishToLive(dropboxFolderPath, locations, publishedBy);
  });
  electron.ipcMain.handle("data:loadLive", async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const result = await dbxDownload(folderPath(dropboxFolderPath, "locations-live.json"));
      if (!result) return { ok: true, data: null };
      return { ok: true, data: JSON.parse(result.content) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle("data:listBackups", async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const backups = await listBackups(dropboxFolderPath);
      return { ok: true, backups };
    } catch (err) {
      return { ok: false, error: err.message, backups: [] };
    }
  });
  electron.ipcMain.handle("data:loadBackup", async (_event, dropboxPath) => {
    try {
      const snapshot = await loadBackupSnapshot(dropboxPath);
      return { ok: true, snapshot };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle("data:saveBackup", async (_event, entry) => {
    const { dropboxFolderPath } = loadSettings();
    try {
      await saveBackup(dropboxFolderPath, entry);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle("settings:get", () => loadSettings());
  electron.ipcMain.handle("settings:set", (_event, updates) => {
    saveSettings(updates);
    if (updates.theme) {
      electron.nativeTheme.themeSource = updates.theme;
    }
  });
  electron.ipcMain.handle("app:getVersion", () => electron.app.getVersion());
  electron.ipcMain.handle("app:getUpdateStatus", () => ({
    updateDownloaded: getUpdateDownloaded()
  }));
  electron.ipcMain.handle("app:quitAndInstall", () => {
    if (getUpdateDownloaded()) electronUpdater.autoUpdater.quitAndInstall();
  });
  electron.ipcMain.handle("dropbox:listFolder", async (_event, path2) => {
    try {
      const resp = await dbxApi("/files/list_folder", {
        path: path2,
        // '' = root; '/Foo/Bar' = subfolder
        include_non_downloadable_files: false
      });
      if (resp.status === 409) return { ok: true, folders: [] };
      if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
      const data = await resp.json();
      const folders = data.entries.filter((e) => e[".tag"] === "folder").map((e) => ({ name: e.name, pathDisplay: e.path_display, pathLower: e.path_lower }));
      return { ok: true, folders };
    } catch (err) {
      return { ok: false, error: err.message, folders: [] };
    }
  });
  electron.ipcMain.handle("dropbox:findNapaAdminFolders", async () => {
    try {
      const resp = await dbxApi("/files/search_v2", {
        query: "NAPA Admin Data",
        options: { filename_only: true }
      });
      if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
      const data = await resp.json();
      const folders = (data.matches ?? []).filter(
        (m) => m?.metadata?.metadata?.[".tag"] === "folder" && m?.metadata?.metadata?.name?.toLowerCase() === "napa admin data"
      ).map((m) => ({
        name: m.metadata.metadata.name,
        pathDisplay: m.metadata.metadata.path_display,
        pathLower: m.metadata.metadata.path_lower
      }));
      return { ok: true, folders };
    } catch (err) {
      return { ok: false, error: err.message, folders: [] };
    }
  });
}
function buildAppMenu(win) {
  const isMac = process.platform === "darwin";
  const template = [
    // macOS requires the first menu item to be the app name menu
    ...isMac ? [{
      label: electron.app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : [],
    // File menu
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    // Edit menu — this is the critical one for text field shortcuts on macOS
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        ...isMac ? [
          { type: "separator" },
          {
            label: "Speech",
            submenu: [
              { role: "startSpeaking" },
              { role: "stopSpeaking" }
            ]
          }
        ] : []
      ]
    },
    // View menu — dev tools only in development
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...process.env.NODE_ENV === "development" ? [
          { type: "separator" },
          { role: "toggleDevTools" }
        ] : []
      ]
    },
    // Window menu
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...isMac ? [
          { type: "separator" },
          { role: "front" }
        ] : [
          { role: "close" }
        ]
      ]
    },
    // Help menu — available on all platforms
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates…",
          click: (menuItem) => {
            setCheckForUpdatesMenuItem(menuItem);
            checkForUpdatesManually(win);
          }
        }
      ]
    }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
function createMainWindow() {
  const win = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "NAPA Courier Admin",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required because contextBridge + ipcRenderer in preload
      // needs access to Node.js-side APIs that the renderer sandbox blocks.
      // safeStorage lives entirely in the main process and is unrelated.
      sandbox: false
    }
  });
  if (process.env.NODE_ENV === "development") {
    win.webContents.openDevTools();
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      electron.shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  return win;
}
electron.app.whenReady().then(() => {
  electron.nativeTheme.themeSource = loadSettings().theme ?? "light";
  registerIpcHandlers();
  const win = createMainWindow();
  buildAppMenu(win);
  initAutoUpdater(win);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});

"use strict";
const electron = require("electron");
const electronUpdater = require("electron-updater");
const promises = require("node:fs/promises");
const node_os = require("node:os");
const path = require("node:path");
const node_http = require("node:http");
const node_child_process = require("node:child_process");
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
const WRITE_ERROR_CODES = ["ENOSPC", "EACCES", "EPERM"];
let _updateDownloaded = false;
let _manualCheckPending = false;
let _checkForUpdatesMenuItem = null;
let _pendingUpdateVersion = null;
let _checksumFailedVersion = null;
function isChecksumError(err) {
  const msg = (err?.message ?? "").toLowerCase();
  return msg.includes("sha512") || msg.includes("sha256") || msg.includes("checksum") || msg.includes("hash") || msg.includes("signature") || msg.includes("integrity");
}
function getUpdaterCachePendingDir(platform = process.platform, env = process.env, homeDir = node_os.homedir()) {
  let cacheBase;
  if (platform === "win32") {
    cacheBase = env["LOCALAPPDATA"] ?? path.join(homeDir, "AppData", "Local");
  } else if (platform === "darwin") {
    cacheBase = path.join(homeDir, "Library", "Caches");
  } else {
    cacheBase = env["XDG_CACHE_HOME"] ?? path.join(homeDir, ".cache");
  }
  return path.join(cacheBase, `${electron.app.getName()}-updater`, "pending");
}
function isWriteError(err) {
  const msg = (err?.message ?? "") + (err?.code ?? "");
  return WRITE_ERROR_CODES.some((code) => msg.includes(code));
}
function isRunningFromAppImage() {
  return process.platform === "linux" && Boolean(process.env.APPIMAGE);
}
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
  if (process.platform === "linux" && !isRunningFromAppImage()) {
    electron.dialog.showMessageBox(win, {
      type: "info",
      title: "Updates unavailable",
      message: "This copy of NAPA Courier Admin was not launched from the AppImage.",
      detail: "To receive automatic updates, download the latest .AppImage from GitHub Releases and run that file directly."
    });
    return;
  }
  if (_updateDownloaded) {
    showRestartDialog(win);
    return;
  }
  if (_manualCheckPending) return;
  _manualCheckPending = true;
  _pendingUpdateVersion = null;
  _checksumFailedVersion = null;
  if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = false;
  electronUpdater.autoUpdater.checkForUpdates().catch((err) => {
    console.error("[auto-updater] manual check promise rejected:", err?.message ?? err);
  });
}
function initAutoUpdater(win) {
  if (!electron.app.isPackaged) return;
  if (process.platform === "linux" && !isRunningFromAppImage()) {
    console.log("[auto-updater] Linux: not running from AppImage — auto-updates skipped");
    return;
  }
  electronUpdater.autoUpdater.autoDownload = true;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
  electronUpdater.autoUpdater.on("update-available", (info) => {
    _pendingUpdateVersion = info?.version ?? null;
    _checksumFailedVersion = null;
    console.log(`[auto-updater] update available: ${_pendingUpdateVersion ?? "unknown"}`);
  });
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
  electronUpdater.autoUpdater.on("download-progress", (info) => {
    win.webContents.send("app:downloadProgress", info);
  });
  electronUpdater.autoUpdater.on("update-downloaded", (info) => {
    const incomingVersion = info?.version ?? null;
    if (_checksumFailedVersion !== null && _checksumFailedVersion === incomingVersion) {
      console.warn(
        `[auto-updater] update-downloaded for v${incomingVersion} rejected — this version previously failed a checksum check. Use "Check for Updates…" to start a fresh attempt.`
      );
      _manualCheckPending = false;
      if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
      win.webContents.send("app:updateCancelled");
      return;
    }
    _updateDownloaded = true;
    _manualCheckPending = false;
    if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
    win.webContents.send("app:updateReady");
    showRestartDialog(win);
  });
  electronUpdater.autoUpdater.on("error", (err) => {
    const wasManual = _manualCheckPending;
    _manualCheckPending = false;
    _updateDownloaded = false;
    if (isChecksumError(err)) {
      _checksumFailedVersion = _pendingUpdateVersion;
      console.warn(
        `[auto-updater] checksum failure for v${_checksumFailedVersion ?? "unknown"} — quarantined; automatic retries of this version will be rejected.`
      );
    }
    if (_checkForUpdatesMenuItem) _checkForUpdatesMenuItem.enabled = true;
    console.error("[auto-updater] error:", err?.message ?? err);
    win.webContents.send("app:updateCancelled");
    if (isWriteError(err) || isChecksumError(err)) {
      void cleanUpdaterTempDir();
    }
    if (wasManual) {
      let detail;
      if (isNetworkError(err)) {
        detail = "Could not reach the update server — check your internet connection and try again.";
      } else if (isWriteError(err)) {
        detail = "Not enough disk space or insufficient permissions to save the update. Free up disk space or check folder permissions, then try again.";
      } else {
        detail = err?.message ?? "An unexpected error occurred. Please try again later.";
      }
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
async function cleanUpdaterTempDir() {
  try {
    const pendingDir = getUpdaterCachePendingDir();
    await promises.rm(pendingDir, { recursive: true, force: true });
    console.info("[auto-updater] cleaned pending update directory:", pendingDir);
  } catch (err) {
    console.warn("[auto-updater] temp-dir cleanup failed:", err?.message ?? err);
  }
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
async function dbxDownloadBytes(dropboxPath) {
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
  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}
function sanitizeImageName(accountNumber, siteName, ext) {
  const safePart = (s) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acc = safePart(accountNumber);
  const site = safePart(siteName);
  const safeExt = (ext || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = [acc, site].filter(Boolean).join("-") || `upload-${Date.now()}`;
  return `${base}.${safeExt}`;
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
async function migrateBase64Images(folder, staging) {
  const locations = staging.locations ?? [];
  let changed = false;
  for (const loc of locations) {
    const url = loc.imageUrl ?? "";
    if (!url.startsWith("data:image/")) continue;
    const match = url.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/s);
    if (!match) continue;
    const ext = match[1].split("+")[0].toLowerCase();
    const b64data = match[2];
    const fileName = sanitizeImageName(loc.accountNumber ?? "", loc.siteName ?? "", ext === "jpeg" ? "jpg" : ext);
    const dropboxImagePath = folderPath(folder, `images/${fileName}`);
    try {
      const buf = Buffer.from(b64data, "base64");
      await dbxUpload(dropboxImagePath, buf);
      loc.imageUrl = `images/${fileName}`;
      changed = true;
      console.log(`[migrate] Uploaded ${fileName} for "${loc.siteName ?? ""}"`);
    } catch (err) {
      console.error(`[migrate] Failed to upload image for "${loc.siteName ?? ""}":`, err);
    }
  }
  return changed;
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
  const data = JSON.parse(result.content);
  let { rev } = result;
  try {
    const migrated = await migrateBase64Images(folder, data);
    if (migrated) {
      const newRev = await dbxUpload(
        folderPath(folder, "locations-staging.json"),
        JSON.stringify({ ...data, lastModified: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)
      );
      rev = newRev;
      console.log("[migrate] Staging file re-saved with image paths.");
    }
  } catch (err) {
    console.error("[migrate] Migration error (non-fatal):", err);
  }
  return { data, rev };
}
async function saveStagingFile(folder, data, rev, force = false) {
  try {
    let mode;
    if (rev) {
      mode = { update: rev };
    } else if (force) {
      mode = "overwrite";
    } else {
      const metaResp = await dbxApi("/files/get_metadata", {
        path: folderPath(folder, "locations-staging.json")
      });
      if (metaResp.ok) {
        return {
          ok: false,
          conflict: true,
          error: "Staging file already exists in Dropbox but this session has no rev for it. Reload before saving."
        };
      }
      if (metaResp.status !== 409) {
        throw new Error(`Metadata check failed: ${metaResp.status}`);
      }
      mode = "overwrite";
    }
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
async function publishToLive(folder, locations, publishedBy, liveRev = "") {
  try {
    const payload = {
      version: 1,
      publishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      publishedBy,
      locations
    };
    let mode;
    if (liveRev) {
      mode = { update: liveRev };
    } else {
      const metaResp = await dbxApi("/files/get_metadata", {
        path: folderPath(folder, "locations-live.json")
      });
      if (metaResp.ok) {
        return {
          ok: false,
          conflict: true,
          error: "The live file exists in Dropbox but this session has no rev for it. Reload before publishing."
        };
      }
      if (metaResp.status !== 409) {
        throw new Error(`Metadata check failed: ${metaResp.status}`);
      }
      mode = "overwrite";
    }
    const newRev = await dbxUpload(
      folderPath(folder, "locations-live.json"),
      JSON.stringify(payload, null, 2),
      mode
    );
    return { ok: true, newRev };
  } catch (err) {
    const e = err;
    if (e.code === "CONFLICT") return { ok: false, conflict: true, error: e.message };
    return { ok: false, error: e.message };
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
  electron.ipcMain.handle("data:saveStaging", async (_event, data, rev, force = false) => {
    const { dropboxFolderPath } = loadSettings();
    return saveStagingFile(dropboxFolderPath, data, rev, force);
  });
  electron.ipcMain.handle("data:publish", async (_event, locations, publishedBy, liveRev = "") => {
    const { dropboxFolderPath } = loadSettings();
    return publishToLive(dropboxFolderPath, locations, publishedBy, liveRev);
  });
  electron.ipcMain.handle("data:loadLive", async () => {
    const { dropboxFolderPath } = loadSettings();
    try {
      const result = await dbxDownload(folderPath(dropboxFolderPath, "locations-live.json"));
      if (!result) return { ok: true, data: null, rev: "" };
      return { ok: true, data: JSON.parse(result.content), rev: result.rev };
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
    if (getUpdateDownloaded()) {
      electron.BrowserWindow.getAllWindows()[0]?.webContents.send("app:updateCancelled");
      electronUpdater.autoUpdater.quitAndInstall();
    }
  });
  electron.ipcMain.handle("app:getPlatform", () => {
    const platform = process.platform;
    let appBundlePath = null;
    if (platform === "darwin") {
      appBundlePath = electron.app.getPath("exe").replace(/\/Contents\/MacOS\/[^/]+$/, "");
    }
    return { platform, appBundlePath };
  });
  electron.ipcMain.handle("app:uninstall", () => {
    if (process.platform === "win32") {
      const installDir = path.dirname(electron.app.getPath("exe"));
      const uninstallerPath = path.join(installDir, `Uninstall ${electron.app.getName()}.exe`);
      if (!fs.existsSync(uninstallerPath)) {
        return {
          ok: false,
          platform: "win32",
          error: `Uninstaller not found at:
${uninstallerPath}

You can remove the app manually via Windows Settings → Apps → Installed apps.`
        };
      }
      const child = node_child_process.spawn(uninstallerPath, [], { detached: true, stdio: "ignore" });
      child.unref();
      setTimeout(() => electron.app.quit(), 400);
      return { ok: true, platform: "win32" };
    }
    if (process.platform === "darwin") {
      const appBundlePath = electron.app.getPath("exe").replace(/\/Contents\/MacOS\/[^/]+$/, "");
      return { ok: true, platform: "darwin", appBundlePath };
    }
    return { ok: false, platform: process.platform, error: "Uninstall is not supported on this platform." };
  });
  electron.ipcMain.handle("dropbox:listFolder", async (_event, path2) => {
    try {
      const firstResp = await dbxApi("/files/list_folder", {
        path: path2,
        // '' = root; '/Foo/Bar' = subfolder
        include_non_downloadable_files: false
      });
      if (firstResp.status === 409) return { ok: true, folders: [] };
      if (!firstResp.ok) throw new Error(`List failed: ${firstResp.status}`);
      let page = await firstResp.json();
      const allEntries = [...page.entries];
      while (page.has_more) {
        const token = await getValidToken();
        const contResp = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ cursor: page.cursor })
        });
        if (!contResp.ok) throw new Error(`List continue failed: ${contResp.status}`);
        page = await contResp.json();
        allEntries.push(...page.entries);
      }
      const folders = allEntries.filter((e) => e[".tag"] === "folder").map((e) => ({ name: e.name, pathDisplay: e.path_display, pathLower: e.path_lower }));
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
  electron.ipcMain.handle("dropbox:testFolderPath", async (_event, testPath) => {
    try {
      const normalized = (testPath ?? "").replace(/\/$/, "");
      const napaDataPath = normalized ? `${normalized}/NAPA Admin Data` : "/NAPA Admin Data";
      const napaResp = await dbxApi("/files/get_metadata", { path: napaDataPath });
      if (napaResp.ok) {
        return { ok: true, message: "✓ Found existing data folder" };
      }
      if (napaResp.status === 409) {
        if (!normalized) {
          return { ok: true, message: "✓ Path is accessible (no data yet)" };
        }
        const parentResp = await dbxApi("/files/get_metadata", { path: normalized });
        if (parentResp.ok) {
          return { ok: true, message: "✓ Path is accessible (no data yet)" };
        }
        if (parentResp.status === 409) {
          return { ok: false, error: `Folder not found in your Dropbox: ${normalized}` };
        }
        const errText2 = await parentResp.text().catch(() => String(parentResp.status));
        return { ok: false, error: `Dropbox error ${parentResp.status}: ${errText2}` };
      }
      const errText = await napaResp.text().catch(() => String(napaResp.status));
      return { ok: false, error: `Dropbox error ${napaResp.status}: ${errText}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle(
    "dropbox:uploadImage",
    async (_event, { base64, fileName }) => {
      try {
        const folder = loadSettings().dropboxFolderPath;
        if (!folder) return { ok: false, error: "Dropbox folder path not configured" };
        const buf = Buffer.from(base64, "base64");
        const dest = folderPath(folder, `images/${fileName}`);
        await dbxUpload(dest, buf);
        return { ok: true, relativePath: `images/${fileName}` };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
  );
  electron.ipcMain.handle("dropbox:generateLinks", async (_event, folderPath2) => {
    try {
      const files = [];
      let resp = await dbxApi("/files/list_folder", { path: folderPath2, recursive: false, limit: 2e3 });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => String(resp.status));
        return { ok: false, error: `Could not list folder: ${msg}` };
      }
      let page = await resp.json();
      for (const e of page.entries) {
        if (e[".tag"] === "file") files.push({ name: e.name, path_lower: e.path_lower, path_display: e.path_display });
      }
      while (page.has_more) {
        resp = await dbxApi("/files/list_folder/continue", { cursor: page.cursor });
        if (!resp.ok) break;
        page = await resp.json();
        for (const e of page.entries) {
          if (e[".tag"] === "file") files.push({ name: e.name, path_lower: e.path_lower, path_display: e.path_display });
        }
      }
      if (files.length === 0) return { ok: true, files: 0, results: [] };
      const getOrCreate = async (file) => {
        try {
          const listResp = await dbxApi("/sharing/list_shared_links", {
            path: file.path_lower,
            direct_only: true
          });
          if (listResp.ok) {
            const listData = await listResp.json();
            if (listData.links?.length > 0) {
              return { name: file.name, path: file.path_display, url: listData.links[0].url, reused: true };
            }
          }
          const createResp = await dbxApi("/sharing/create_shared_link_with_settings", {
            path: file.path_lower,
            settings: { requested_visibility: "public" }
          });
          if (createResp.ok) {
            const cd = await createResp.json();
            return { name: file.name, path: file.path_display, url: cd.url, reused: false };
          }
          if (createResp.status === 409) {
            const ed = await createResp.json();
            if (ed?.error?.[".tag"] === "shared_link_already_exists") {
              const existingUrl = ed.error.metadata?.url;
              if (existingUrl) return { name: file.name, path: file.path_display, url: existingUrl, reused: true };
              const fl = await dbxApi("/sharing/list_shared_links", { path: file.path_lower });
              if (fl.ok) {
                const fd = await fl.json();
                const url = fd.links?.[0]?.url ?? "";
                return { name: file.name, path: file.path_display, url, reused: true };
              }
            }
          }
          const bodyText = await createResp.text().catch(() => "");
          let reason = bodyText;
          try {
            const parsed = JSON.parse(bodyText);
            reason = parsed.error_summary || parsed.error?.[".tag"] || bodyText;
          } catch {
          }
          return {
            name: file.name,
            path: file.path_display,
            url: "",
            reused: false,
            error: `HTTP ${createResp.status}: ${reason || "no details returned"}`
          };
        } catch (err) {
          return {
            name: file.name,
            path: file.path_display,
            url: "",
            reused: false,
            error: err.message
          };
        }
      };
      const results = [];
      const BATCH = 5;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(getOrCreate));
        results.push(...batchResults);
      }
      return { ok: true, files: files.length, results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  electron.ipcMain.handle("dropbox:downloadImage", async (_event, relativePath) => {
    try {
      const folder = loadSettings().dropboxFolderPath;
      if (!folder) return { ok: false, error: "Dropbox folder path not configured" };
      const src = folderPath(folder, relativePath);
      const buf = await dbxDownloadBytes(src);
      if (!buf) return { ok: false, error: "Image not found" };
      const ext = relativePath.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
      return { ok: true, dataUri: `data:${mime};base64,${buf.toString("base64")}` };
    } catch (err) {
      return { ok: false, error: err.message };
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

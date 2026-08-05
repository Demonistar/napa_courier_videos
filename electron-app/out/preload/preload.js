"use strict";
const electron = require("electron");
const api = {
  auth: {
    getStatus: () => electron.ipcRenderer.invoke("auth:status"),
    login: () => electron.ipcRenderer.invoke("auth:login"),
    logout: () => electron.ipcRenderer.invoke("auth:logout")
  },
  data: {
    loadStaging: () => electron.ipcRenderer.invoke("data:loadStaging"),
    loadLive: () => electron.ipcRenderer.invoke("data:loadLive"),
    saveStaging: (data, rev, force) => electron.ipcRenderer.invoke("data:saveStaging", data, rev, force),
    publish: (locations, publishedBy, liveRev) => electron.ipcRenderer.invoke("data:publish", locations, publishedBy, liveRev),
    listBackups: () => electron.ipcRenderer.invoke("data:listBackups"),
    loadBackup: (dropboxPath) => electron.ipcRenderer.invoke("data:loadBackup", dropboxPath),
    saveBackup: (entry) => electron.ipcRenderer.invoke("data:saveBackup", entry)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    set: (updates) => electron.ipcRenderer.invoke("settings:set", updates)
  },
  app: {
    getVersion: () => electron.ipcRenderer.invoke("app:getVersion"),
    getUpdateStatus: () => electron.ipcRenderer.invoke("app:getUpdateStatus"),
    onUpdateReady: (callback) => {
      const handler = () => callback();
      electron.ipcRenderer.on("app:updateReady", handler);
      return () => electron.ipcRenderer.removeListener("app:updateReady", handler);
    },
    /** Fired when a download that had already set the badge fails mid-session. */
    onUpdateCancelled: (callback) => {
      const handler = () => callback();
      electron.ipcRenderer.on("app:updateCancelled", handler);
      return () => electron.ipcRenderer.removeListener("app:updateCancelled", handler);
    },
    /** Fired repeatedly while an update is downloading. Percent is 0–100. */
    onDownloadProgress: (callback) => {
      const handler = (_event, info) => callback(info);
      electron.ipcRenderer.on("app:downloadProgress", handler);
      return () => electron.ipcRenderer.removeListener("app:downloadProgress", handler);
    },
    quitAndInstall: () => electron.ipcRenderer.invoke("app:quitAndInstall"),
    /** Returns the OS platform string and the .app path on macOS. */
    getPlatform: () => electron.ipcRenderer.invoke("app:getPlatform"),
    /**
     * Windows: launches the NSIS uninstaller and quits.
     * macOS:   returns the .app bundle path for manual drag-to-Trash instructions.
     * Dropbox data is NEVER touched by either path.
     */
    uninstall: () => electron.ipcRenderer.invoke("app:uninstall")
  },
  dropbox: {
    /** List immediate subfolders at a Dropbox path. Pass '' for the root. */
    listFolder: (path) => electron.ipcRenderer.invoke("dropbox:listFolder", path),
    /** Search the entire Dropbox for folders named "NAPA Admin Data". */
    findNapaAdminFolders: () => electron.ipcRenderer.invoke("dropbox:findNapaAdminFolders"),
    /**
     * Test whether a folder path is accessible in Dropbox and whether the
     * "NAPA Admin Data" subfolder already exists inside it.
     * Returns ok:true with a human-readable message on success, or
     * ok:false with the Dropbox error message on failure.
     */
    testFolderPath: (path) => electron.ipcRenderer.invoke("dropbox:testFolderPath", path),
    /**
     * Scan a Dropbox folder and return a public shareable link for every file.
     * Existing links are reused; new ones created only when none exist.
     */
    generateLinks: (folderPath) => electron.ipcRenderer.invoke("dropbox:generateLinks", folderPath),
    /**
     * Upload an image file into NAPA Admin Data/images/ and return the
     * relative path "images/<filename>" to store in the location record.
     */
    uploadImage: (payload) => electron.ipcRenderer.invoke("dropbox:uploadImage", payload),
    /**
     * Download an image from NAPA Admin Data/<relativePath> and return it as
     * a base64 data URI for display in an <img> tag.
     */
    downloadImage: (relativePath) => electron.ipcRenderer.invoke("dropbox:downloadImage", relativePath)
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", api);

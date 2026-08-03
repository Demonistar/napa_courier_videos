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
    saveStaging: (data, rev) => electron.ipcRenderer.invoke("data:saveStaging", data, rev),
    publish: (locations, publishedBy) => electron.ipcRenderer.invoke("data:publish", locations, publishedBy),
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
    quitAndInstall: () => electron.ipcRenderer.invoke("app:quitAndInstall")
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", api);

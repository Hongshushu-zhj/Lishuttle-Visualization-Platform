const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
  selectMatlab: () => ipcRenderer.invoke('desktop:select-matlab'),
  selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
  selectPreferences: () => ipcRenderer.invoke('desktop:select-preferences'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
}));

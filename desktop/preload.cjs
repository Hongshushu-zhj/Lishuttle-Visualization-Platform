const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
}));

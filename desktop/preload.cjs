const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
  selectMatlab: () => ipcRenderer.invoke('desktop:select-matlab'),
  selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
  selectPreferences: () => ipcRenderer.invoke('desktop:select-preferences'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  onDownloadResult: callback => {
    const listener = (_event, value) => { if (value && ['completed','interrupted'].includes(value.state) && typeof value.filename === 'string') callback({ state: value.state, filename: value.filename }); };
    ipcRenderer.on('desktop:download-result', listener);
    return () => ipcRenderer.removeListener('desktop:download-result', listener);
  },
}));

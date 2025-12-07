const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getImages: () => ipcRenderer.invoke('get-images'),
  isElectron: true
});

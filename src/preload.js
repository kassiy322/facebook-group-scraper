const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveCSV: (payload) => ipcRenderer.invoke('save-csv', payload),
  saveExcel: (payload) => ipcRenderer.invoke('save-excel', payload),
  saveJSON: (payload) => ipcRenderer.invoke('save-json', payload),
  getScript: (type = null) => ipcRenderer.invoke('get-script', type),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  scrapeLinks: () => ipcRenderer.invoke('scrape-links'),
  logout: () => ipcRenderer.invoke('logout'),
  onScriptReady: () => {
    // Уведомляем renderer, что скрипт готов
    window.postMessage({ type: 'SCRIPT_READY' }, '*');
  }
});

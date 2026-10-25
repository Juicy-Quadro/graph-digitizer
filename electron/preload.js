'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gd', {
  openImage: () => ipcRenderer.invoke('image:open'),
  openWorkspace: () => ipcRenderer.invoke('file:readTextOpen'),
  readText: (filePath) => ipcRenderer.invoke('file:readText', filePath),
  readBinary: (filePath) => ipcRenderer.invoke('file:readBinary', filePath),
  saveText: (payload) => ipcRenderer.invoke('file:saveText', payload),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  /** Menu commands are forwarded to the renderer. */
  onMenuAction: (handler) => {
    const listener = (_evt, payload) => handler(payload);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },

  /** Tell the main process to rebuild the native menu in a new language. */
  setMenuLanguage: (language) => ipcRenderer.send('menu:language', language),

  /** Keep the native title bar overlay in sync with the application theme. */
  setTitleBarColor: (background, symbol) => ipcRenderer.send('titlebar:color', background, symbol),

  /** Keep the native menu radio state in sync with the application theme. */
  setMenuTheme: (theme) => ipcRenderer.send('menu:theme', theme),

  /** The operating system colour scheme changed. */
  onSystemTheme: (handler) => {
    const listener = (_evt, theme) => handler(theme);
    ipcRenderer.on('system-theme', listener);
    return () => ipcRenderer.removeListener('system-theme', listener);
  }
});

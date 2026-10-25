'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gd', {
  /**
   * True only when the renderer was opened with the test hook enabled. The
   * renderer uses this to decide whether to expose its automation hook.
   */
  testHookAllowed: /[?&]testhook=1/.test(window.location.search),

  openImage: () => ipcRenderer.invoke('image:open'),
  openWorkspace: () => ipcRenderer.invoke('file:readTextOpen'),
  readBinary: (filePath) => ipcRenderer.invoke('file:readBinary', filePath),
  saveText: (payload) => ipcRenderer.invoke('file:saveText', payload),
  saveBinary: (payload) => ipcRenderer.invoke('file:saveBinary', payload),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  /** The model that answers the image requests; the key stays in main. */
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  llmSaveKey: (key) => ipcRenderer.invoke('llm:saveKey', key),
  llmForgetKey: () => ipcRenderer.invoke('llm:forgetKey'),
  llmReadColorBar: (payload) => ipcRenderer.invoke('llm:readColorBar', payload),
  llmExtractCurves: (payload) => ipcRenderer.invoke('llm:extractCurves', payload),

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

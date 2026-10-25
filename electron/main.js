'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;

let mainWindow = null;
let currentLanguage = 'en';
let currentTheme = 'auto';

/** @type {BrowserWindow|null} */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#11151c',
    title: 'Graph Digitizer',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#11151c',
      symbolColor: '#8b97a8',
      height: 44
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    pushSystemTheme(true);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  }
}

// ------------------------------------------------------------------ IPC

ipcMain.handle('image:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Image',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    dataURL: 'data:image/' + (path.extname(filePath).slice(1) || 'png').toLowerCase() + ';base64,' +
      buffer.toString('base64')
  };
});

ipcMain.handle('file:readText', async (_evt, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(String(err && err.message ? err.message : err));
  }
});

ipcMain.handle('file:readBinary', async (_evt, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath).toString('base64');
  } catch (err) {
    throw new Error(String(err && err.message ? err.message : err));
  }
});

ipcMain.handle('file:readTextOpen', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Workspace',
    properties: ['openFile'],
    filters: [{ name: 'Graph Digitizer Workspace', extensions: ['gdw', 'json'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  try {
    return { path: filePath, name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    throw new Error(String(err && err.message ? err.message : err));
  }
});

ipcMain.handle('file:saveText', async (_evt, payload) => {
  const filters = payload.filters || [{ name: 'Text', extensions: ['txt'] }];
  const result = await dialog.showSaveDialog(mainWindow, {
    title: payload.title || 'Save',
    defaultPath: payload.defaultPath,
    filters
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, payload.content, 'utf8');
  return { path: result.filePath, name: path.basename(result.filePath) };
});

ipcMain.handle('clipboard:write', (_evt, text) => {
  clipboard.writeText(String(text));
  return true;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform
}));

ipcMain.handle('shell:openExternal', async (_evt, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// ------------------------------------------------------------------ Menu

function send(action, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', { action, payload });
  }
}

function buildMenu(language, theme) {
  const lang = language === 'zh' ? 'zh' : 'en';
  const th = theme || currentTheme;
  const template = [
    {
      label: lang === 'zh' ? '文件(&F)' : 'File(&F)',
      submenu: [
        { label: lang === 'zh' ? '打开图片(&O)…' : 'Open Image(&O)…', accelerator: 'CmdOrCtrl+O', click: () => send('open-image') },
        { label: lang === 'zh' ? '打开工作区(&W)…' : 'Open Workspace(&W)…', click: () => send('open-workspace') },
        { label: lang === 'zh' ? '保存工作区(&S)…' : 'Save Workspace(&S)…', accelerator: 'CmdOrCtrl+S', click: () => send('save-workspace') },
        { type: 'separator' },
        { label: lang === 'zh' ? '导出数据(&E)…' : 'Export Data(&E)…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
        { type: 'separator' },
        { role: 'quit', label: lang === 'zh' ? '退出(&X)' : 'Exit(&X)' }
      ]
    },
    {
      label: lang === 'zh' ? '编辑(&E)' : 'Edit(&E)',
      submenu: [
        { label: lang === 'zh' ? '撤销(&U)' : 'Undo(&U)', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: lang === 'zh' ? '重做(&R)' : 'Redo(&R)', accelerator: 'CmdOrCtrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { label: lang === 'zh' ? '删除选中的点(&D)' : 'Delete Points(&D)', accelerator: 'Delete', click: () => send('delete-points') },
        { label: lang === 'zh' ? '全选(&A)' : 'Select All(&A)', accelerator: 'CmdOrCtrl+A', click: () => send('select-all') }
      ]
    },
    {
      label: lang === 'zh' ? '视图(&V)' : 'View(&V)',
      submenu: [
        { label: lang === 'zh' ? '放大(&I)' : 'Zoom In(&I)', accelerator: 'CmdOrCtrl+Plus', click: () => send('zoom-in') },
        { label: lang === 'zh' ? '缩小(&O)' : 'Zoom Out(&O)', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: lang === 'zh' ? '适应窗口(&F)' : 'Fit to Window(&F)', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-fit') },
        { label: lang === 'zh' ? '实际大小(&A)' : 'Actual Size(&A)', accelerator: 'CmdOrCtrl+1', click: () => send('zoom-actual') },
        { type: 'separator' },
        {
          label: lang === 'zh' ? '显示识别掩膜(&M)' : 'Toggle Mask Overlay(&M)',
          accelerator: 'CmdOrCtrl+M',
          click: () => send('toggle-mask')
        },
        { type: 'separator' },
        {
          label: lang === 'zh' ? '语言(&L)' : 'Language(&L)',
          submenu: [
            {
              label: 'English',
              type: 'radio',
              checked: lang === 'en',
              click: () => send('language', 'en')
            },
            {
              label: '简体中文',
              type: 'radio',
              checked: lang === 'zh',
              click: () => send('language', 'zh')
            }
          ]
        },
        {
          label: lang === 'zh' ? '主题(&T)' : 'Theme(&T)',
          submenu: [
            {
              label: lang === 'zh' ? '跟随系统' : 'Follow system',
              type: 'radio',
              checked: th === 'auto',
              click: () => send('theme', 'auto')
            },
            {
              label: lang === 'zh' ? '深色' : 'Dark',
              type: 'radio',
              checked: th === 'dark',
              click: () => send('theme', 'dark')
            },
            {
              label: lang === 'zh' ? '浅色' : 'Light',
              type: 'radio',
              checked: th === 'light',
              click: () => send('theme', 'light')
            }
          ]
        },
        { type: 'separator' },
        {
          label: lang === 'zh' ? '设置(&S)…' : 'Settings(&S)…',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('settings')
        }
      ]
    },
    {
      label: lang === 'zh' ? '帮助(&H)' : 'Help(&H)',
      submenu: [
        { label: lang === 'zh' ? '键盘快捷键(&K)' : 'Keyboard Shortcuts(&K)', accelerator: 'F1', click: () => send('shortcuts') },
        { type: 'separator' },
        { label: lang === 'zh' ? '关于(&A)' : 'About(&A)', click: () => send('about') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('menu:language', (_evt, language) => {
  currentLanguage = language;
  buildMenu(currentLanguage, currentTheme);
});

ipcMain.on('menu:theme', (_evt, theme) => {
  currentTheme = theme;
  buildMenu(currentLanguage, currentTheme);
});

ipcMain.on('titlebar:color', (_evt, background, symbol) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setTitleBarOverlay({
      color: background,
      symbolColor: symbol,
      height: 44
    });
  } catch (err) {
    // The overlay is not available on every platform; ignore silently.
  }
});

// The operating system colour scheme changed.
nativeTheme.on('updated', () => {
  pushSystemTheme();
});

/**
 * Electron does not always notify the renderer when the system colour
 * scheme changes, so the main process keeps watching it and pushes the
 * current value whenever it differs from the last one it reported.
 */
let lastReportedTheme = null;

function pushSystemTheme(force) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (!force && theme === lastReportedTheme) return;
  lastReportedTheme = theme;
  mainWindow.webContents.send('system-theme', theme);
}

setInterval(() => pushSystemTheme(false), 1000).unref();

// ------------------------------------------------------------------ Boot

app.whenReady().then(() => {
  buildMenu(currentLanguage, currentTheme);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

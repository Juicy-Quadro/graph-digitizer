'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, shell, nativeTheme, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const llm = require('./llm');

const isDev = !app.isPackaged;

/**
 * The renderer is served from a custom scheme instead of file://. Under
 * file:// the CSP source 'self' matches every local file, so the policy could
 * not keep the renderer inside the application.
 */
const APP_SCHEME = 'app';
const APP_HOST = 'gd';
const APP_ORIGIN = APP_SCHEME + '://' + APP_HOST;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function registerAppProtocol() {
  const base = path.resolve(path.join(__dirname, '..', 'src'));
  protocol.handle(APP_SCHEME, (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (!rel || rel === '/') rel = '/index.html';
    const filePath = path.resolve(path.join(base, rel));
    // Never serve anything outside the renderer directory.
    if (filePath !== base && !filePath.startsWith(base + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = fs.readFileSync(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });
}

/**
 * The renderer exposes a test hook only when this switch is present, so it
 * never ships in a normal installation.
 */
const testHookEnabled = process.env.GD_TEST_HOOK === '1';

let mainWindow = null;
let currentLanguage = 'en';
let currentTheme = 'auto';

/**
 * Folders the user has explicitly opened through a native dialog. Only files
 * below these roots may be read back by the renderer.
 */
const approvedReadRoots = new Set();

function approveRoot(filePath) {
  if (filePath) approvedReadRoots.add(path.resolve(path.dirname(filePath)));
}

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
      sandbox: false,
      additionalArguments: testHookEnabled ? ['--gd-test-hook'] : []
    }
  });

  mainWindow.loadURL(APP_ORIGIN + '/index.html' + (testHookEnabled ? '?testhook=1' : ''));

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
    // Bind to this window, not to the module level variable, so a closed
    // window cannot make the handler touch a different one.
    const own = mainWindow;
    own.webContents.on('did-finish-load', () => {
      if (!own.isDestroyed()) own.webContents.openDevTools({ mode: 'detach' });
    });
  }
}

// ------------------------------------------------------------------ IPC

ipcMain.handle('image:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Image',
    properties: ['openFile'],
    filters: [
      // Chromium has no TIFF decoder, so offering it would only produce a
      // file that silently fails to load.
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  approveRoot(filePath);
  const buffer = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    dataURL: 'data:image/' + (path.extname(filePath).slice(1) || 'png').toLowerCase() + ';base64,' +
      buffer.toString('base64')
  };
});

ipcMain.handle('file:readBinary', async (_evt, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') return null;
    const resolved = path.resolve(filePath);
    // The renderer may only read files the user has already opened through a
    // native dialog; a workspace file must not be able to point anywhere.
    const allowed = [...approvedReadRoots].some((root) => {
      const rel = path.relative(root, resolved);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
    if (!allowed) {
      throw new Error('The file is outside the folders that were opened by the user.');
    }
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved).toString('base64');
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
  approveRoot(filePath);
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

ipcMain.handle('file:saveBinary', async (_evt, payload) => {
  try {
    const data = payload || {};
    if (typeof data.dataURL !== 'string' || !data.dataURL) {
      throw new Error('The image data is missing.');
    }
    // Only an image data URL may be written, so the renderer cannot use this
    // channel to store arbitrary content.
    const match = /^data:(image\/[a-z0-9.+-]+)(;[^,]*)?;base64,([\s\S]*)$/i.exec(data.dataURL);
    if (!match) {
      throw new Error('The image data must be a base64 encoded image data URL.');
    }
    const bytes = Buffer.from(match[3], 'base64');
    if (!bytes.length) {
      throw new Error('The image data is empty.');
    }
    const filters = data.filters || [{ name: 'PNG Image', extensions: ['png'] }];
    const result = await dialog.showSaveDialog(mainWindow, {
      title: data.title || 'Save Image',
      defaultPath: data.defaultPath,
      filters: filters
    });
    if (result.canceled || !result.filePath) return null;
    // The file is written exactly where the user asked for it.
    fs.writeFileSync(result.filePath, bytes);
    return { path: result.filePath, name: path.basename(result.filePath) };
  } catch (err) {
    throw new Error(String(err && err.message ? err.message : err));
  }
});

ipcMain.handle('llm:status', () => ({
  configured: llm.isConfigured(),
  model: llm.DEFAULT_MODEL
}));

ipcMain.handle('llm:saveKey', (_evt, key) => llm.saveKey(key));

ipcMain.handle('llm:forgetKey', () => llm.forgetKey());

ipcMain.handle('llm:readColorBar', async (_evt, payload) => {
  try {
    return await llm.readColorBar(payload || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), ticks: [] };
  }
});

ipcMain.handle('llm:extractCurves', async (_evt, payload) => {
  try {
    return await llm.extractCurves(payload || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), series: [] };
  }
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
        {
          // The renderer implements Delete with a guard for text fields, so
          // the native accelerator must not swallow the key as well.
          label: lang === 'zh' ? '删除选中的点(&D)' : 'Delete Points(&D)',
          click: () => send('delete-points')
        },
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
  currentLanguage = language === 'zh' ? 'zh' : 'en';
  scheduleMenuRebuild();
});

ipcMain.on('menu:theme', (_evt, theme) => {
  currentTheme = ['auto', 'dark', 'light'].indexOf(theme) >= 0 ? theme : 'auto';
  scheduleMenuRebuild();
});

/**
 * A language change and a theme change usually arrive together, and each
 * rebuild replaces the whole menu. Coalesce them into one rebuild so the
 * menu bar does not flicker twice.
 */
let menuRebuildTimer = null;

function scheduleMenuRebuild() {
  if (menuRebuildTimer) clearTimeout(menuRebuildTimer);
  menuRebuildTimer = setTimeout(() => {
    menuRebuildTimer = null;
    buildMenu(currentLanguage, currentTheme);
  }, 40);
}

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
  registerAppProtocol();
  buildMenu(currentLanguage, currentTheme);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

'use strict';

/*
 * Smoke test of the real application: it loads electron/main.js, so the
 * custom app:// protocol, the native menu, the preload bridge and the CSP are
 * all exercised exactly as they ship.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
};

/*
 * The real main process, with its protocol registration. The test hook is
 * switched on for this run, so the window that main.js opens carries the
 * switch in its URL.
 */
process.env.GD_TEST_HOOK = '1';
require(path.join(root, 'electron', 'main.js'));

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));

  const wins = BrowserWindow.getAllWindows();
  check('the application opened a window', wins.length === 1, wins.length + ' window(s)');
  if (!wins.length) { app.exit(1); return; }
  const win = wins[0];

  const url = win.webContents.getURL();
  check('the renderer is served from the app scheme', url.indexOf('app://gd/') === 0, url);

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, details) => errors.push('render process gone: ' + details.reason));

  await new Promise((r) => setTimeout(r, 1200));

  const info = await win.webContents.executeJavaScript(`({
    title: document.title,
    panels: document.querySelectorAll('.panel').length,
    tools: document.querySelectorAll('.tool').length,
    emptyVisible: !document.getElementById('empty-state').hidden,
    quickstart: document.querySelectorAll('.quickstart-item').length,
    bridge: Object.keys(window.gd || {}),
    bridgeFlag: window.gd ? window.gd.testHookAllowed : 'no bridge',
    mainFlag: typeof window.testHookAllowed !== 'undefined' ? window.testHookAllowed : 'absent',
    search: window.location.search,
    hook: !!window.__gd,
    lang: window.__gd ? window.__gd.store.state.ui.language : null
  })`);

  check('the interface rendered', info.panels >= 5 && info.tools >= 8,
    info.panels + ' panels, ' + info.tools + ' tools');
  check('the empty state is visible before an image is loaded', info.emptyVisible === true);
  check('the quick start guide is present', info.quickstart === 3, info.quickstart + ' cards');
  check('the preload bridge is exposed', info.bridge.length >= 8, info.bridge.join(', '));
  check('the test hook is present when it is enabled', info.hook === true,
    'bridge=' + info.bridgeFlag + ' main=' + info.mainFlag + ' search=' + info.search);
  check('the debug readText channel is gone', info.bridge.indexOf('readText') < 0);

  /*
   * The hook must not be reachable without the switch. A second window that
   * loads the very same page without the query proves the gate holds.
   */
  const plain = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await plain.loadURL('app://gd/index.html');
  const gated = await plain.webContents.executeJavaScript(`({
    flag: window.gd ? window.gd.testHookAllowed : 'no bridge',
    hook: !!window.__gd
  })`);
  check('the test hook is gated off without the switch',
    gated.flag === false && gated.hook === false,
    'flag=' + gated.flag + ' hook=' + gated.hook);
  plain.destroy();

  // The page must not be able to pull in a script from the file system.
  const csp = await win.webContents.executeJavaScript(`(() => {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'file:///C:/Windows/win.ini';
      s.onload = () => resolve('LOADED');
      s.onerror = () => resolve('BLOCKED');
      document.head.appendChild(s);
    });
  })()`);
  check('a file:// script is blocked by the policy', csp === 'BLOCKED', csp);

  // The probe above is expected to log a blocked-resource error; everything
  // else must be silent.
  const unexpected = errors.filter((m) => m.indexOf('Not allowed to load local resource') < 0);
  check('no unexpected renderer errors were logged', unexpected.length === 0,
    unexpected.slice(0, 3).join(' | '));

  const shot = await win.webContents.capturePage();
  const out = path.join(root, 'tools', '_scratch', 'smoke-app-protocol.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, shot.toPNG());
  console.log('  screenshot: ' + out);

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'the real application starts clean'));
  app.exit(failures ? 1 : 0);
});

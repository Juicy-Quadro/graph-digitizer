'use strict';

/*
 * Verifies that the theme really follows the operating system.
 *
 * Electron's nativeTheme lets the test pretend that the system is in dark or
 * light mode; the renderer has to react to the change on its own.
 */

const { app, BrowserWindow, nativeTheme, session } = require('electron');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
let failures = 0;

// Use a throw away profile so a previous run cannot leave a pinned theme
// behind in local storage.
app.setPath('userData', path.join(os.tmpdir(), 'gd-theme-test-' + Date.now()));

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  const win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  await session.defaultSession.clearStorageData();
  await win.loadFile(path.join(root, 'src', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  const read = () => win.webContents.executeJavaScript(`({
    preference: window.__gd.store.state.ui.theme,
    applied: document.documentElement.getAttribute('data-theme'),
    systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    buttonMode: document.querySelector('[data-action="toggle-theme"]').getAttribute('data-theme-mode')
  })`);

  let s = await read();
  console.log('  system=dark  -> ' + JSON.stringify(s));
  check('default preference follows the system', s.preference === 'auto', s.preference);
  check('dark system applies the dark theme', s.applied === 'dark', s.applied);
  check('the renderer sees the dark system scheme', s.systemDark === true, String(s.systemDark));

  // Flip the operating system to light mode.
  await win.webContents.executeJavaScript(
    `window.__probe = [];` +
    `window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => window.__probe.push(e.matches));` +
    `'ok'`);
  nativeTheme.themeSource = 'light';
  await new Promise((r) => setTimeout(r, 1800));
  s = await read();
  const probe = await win.webContents.executeJavaScript(
    `({ probe: window.__probe, last: window.__gd.lastSystemTheme() })`);
  console.log('  system=light -> ' + JSON.stringify(s) + ' probe=' + JSON.stringify(probe) +
    ' nativeShouldUseDark=' + nativeTheme.shouldUseDarkColors);
  check('light system applies the light theme', s.applied === 'light', s.applied);
  check('the theme changed without user interaction', s.preference === 'auto', s.preference);

  // Pin the theme: the system must no longer win.
  await win.webContents.executeJavaScript(`window.__gd.setTheme('dark'); 'ok'`);
  nativeTheme.themeSource = 'light';
  await new Promise((r) => setTimeout(r, 600));
  s = await read();
  console.log('  pinned=dark, system=light -> ' + JSON.stringify(s));
  check('a pinned theme ignores the system', s.applied === 'dark', s.applied);

  // Cycle the toolbar button.
  const cycle = [];
  for (let i = 0; i < 3; i++) {
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-action="toggle-theme"]').click(); 'ok'`);
    await new Promise((r) => setTimeout(r, 150));
    const st = await read();
    cycle.push(st.preference + '=' + st.applied + '/' + st.buttonMode);
  }
  console.log('  cycle: ' + cycle.join('  '));
  check('the toolbar button cycles auto -> light -> dark',
    cycle.join(' | ').indexOf('auto=') === 0 && cycle[1].indexOf('light=') === 0 &&
    cycle[2].indexOf('dark=') === 0, cycle.join(' | '));
  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all theme checks passed'));
  app.exit(failures ? 1 : 0);
});

'use strict';

/*
 * Verifies that the theme really follows the operating system.
 *
 * The real main process is loaded, so the window is the one that ships and
 * the theme reaches the renderer over the same native notification the
 * application uses. Electron's nativeTheme lets the test pretend that the
 * system is in dark or light mode.
 */

const { app, nativeTheme, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
let failures = 0;

// Use a throw away profile so a previous run cannot leave a pinned theme
// behind in local storage.
app.setPath('userData', path.join(os.tmpdir(), 'gd-theme-test-' + Date.now()));

// The renderer only exposes its automation hook when this switch is set.
process.env.GD_TEST_HOOK = '1';
require(path.join(root, 'electron', 'main.js'));

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

app.disableHardwareAcceleration();

/** Polls until the predicate holds, so a slow machine cannot fail the test. */
async function waitFor(label, predicate, timeout) {
  const deadline = Date.now() + (timeout || 6000);
  let last = null;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('  timed out while waiting for ' + label);
  return null;
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  // The main process opens the window; the DevTools window is not part of
  // the application, so the window is picked by its address.
  const win = await waitFor('the application window', async () => {
    const all = BrowserWindow.getAllWindows();
    return all.find((w) => w.webContents.getURL().indexOf('app://gd/') === 0) || null;
  });
  if (!win) {
    console.log('  the application window never appeared');
    app.exit(1);
    return;
  }
  await new Promise((r) => setTimeout(r, 1200));

  const read = () => win.webContents.executeJavaScript(`({
    preference: window.__gd.store.state.ui.theme,
    applied: document.documentElement.getAttribute('data-theme'),
    systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches
  })`);

  let s = await waitFor('the dark theme', async () => {
    const st = await read();
    return st.applied === 'dark' ? st : null;
  });
  s = s || (await read());
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
  s = await waitFor('the light theme', async () => {
    const st = await read();
    return st.applied === 'light' ? st : null;
  });
  s = s || (await read());
  const probe = await win.webContents.executeJavaScript(
    `({ probe: window.__probe, last: window.__gd.lastSystemTheme() })`);
  console.log('  system=light -> ' + JSON.stringify(s) + ' probe=' + JSON.stringify(probe) +
    ' nativeShouldUseDark=' + nativeTheme.shouldUseDarkColors);
  check('light system applies the light theme', s.applied === 'light', s.applied);
  check('the theme changed without user interaction', s.preference === 'auto', s.preference);

  // Pin the theme: the system must no longer win.
  await win.webContents.executeJavaScript(`window.__gd.setTheme('dark'); 'ok'`);
  nativeTheme.themeSource = 'light';
  await new Promise((r) => setTimeout(r, 800));
  s = await read();
  console.log('  pinned=dark, system=light -> ' + JSON.stringify(s));
  check('a pinned theme ignores the system', s.applied === 'dark', s.applied);

  // The theme is changed in the settings, which is the one place where all
  // the settings live.
  await win.webContents.executeJavaScript(
    `document.querySelector('[data-action="settings"]').click(); 'ok'`);
  await new Promise((r) => setTimeout(r, 400));
  const dialog = await win.webContents.executeJavaScript(`({
    open: !document.getElementById('modal-backdrop').hidden,
    groups: document.querySelectorAll('#modal-body .settings-group').length,
    hasLanguage: !!document.querySelector('input[name="set-lang"]'),
    hasTheme: !!document.querySelector('input[name="set-theme"]'),
    hasKey: !!document.getElementById('llm-key')
  })`);
  check('the settings hold every setting of the application',
    dialog.open && dialog.groups === 3 && dialog.hasLanguage &&
    dialog.hasTheme && dialog.hasKey, JSON.stringify(dialog));

  await win.webContents.executeJavaScript(`(() => {
    const radio = document.querySelector('input[name="set-theme"][value="light"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  s = await read();
  console.log('  from the settings -> ' + JSON.stringify(s));
  check('the theme can be changed in the settings',
    s.preference === 'light' && s.applied === 'light', s.preference + '/' + s.applied);

  await win.webContents.executeJavaScript(
    `document.querySelector('[data-action="modal-close"]').click(); 'ok'`);
  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all theme checks passed'));
  app.exit(failures ? 1 : 0);
});

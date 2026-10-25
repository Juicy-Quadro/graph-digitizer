'use strict';

/*
 * Automated UI capture.
 *
 * Boots the real renderer, loads a sample figure, performs a calibration and
 * a trace, then writes a PNG of the window so the interface can be reviewed
 * without a human in front of the screen.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'screenshots');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const scene = arg('scene', 'trace');
const lang = arg('lang', 'en');
const theme = arg('theme', 'dark');
const width = Number(arg('width', 1440));
const height = Number(arg('height', 920));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: theme === 'light' ? '#f4f6fa' : '#11151c',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });

  await win.loadFile(path.join(root, 'src', 'index.html'));
  await new Promise((r) => setTimeout(r, 700));

  const truth = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'sample3-truth.json'), 'utf8'));
  const png = fs.readFileSync(path.join(root, 'testdata', 'sample3.png'));
  const dataURL = 'data:image/png;base64,' + png.toString('base64');

  const script = `(async () => {
    const g = window.__gd;
    ${lang === 'auto' ? '' : `g.setLanguage(${JSON.stringify(lang)});`}
    g.setTheme(${JSON.stringify(theme)});
    const truth = ${JSON.stringify(truth)};
    await g.loadImage(${JSON.stringify(dataURL)}, 'sample3.pcx');
    const line = truth.lines[truth.scaleIndex];
    g.setSampling({ method: 'color', lineColor: line.lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });
    ${scene === 'settings' ? `
    g.setCalibration(${JSON.stringify(truth.calibration.points)}, truth.calibration.xScale, truth.calibration.yScale);
    document.querySelector('[data-action="settings"]').click();
    ` : ''}
    ${scene === 'trace' ? `
    g.setCalibration(${JSON.stringify(truth.calibration.points)}, truth.calibration.xScale, truth.calibration.yScale);
    const ref = truth.lines[truth.scaleIndex].points;
    g.traceAt(ref[0][0], ref[0][1]);
    ` : ''}
    ${scene === 'area' ? `
    g.setCalibration(${JSON.stringify(truth.calibration.points)}, truth.calibration.xScale, truth.calibration.yScale);
    g.areaIn(150, 30, 880, 450, 0);
    ` : ''}
    ${scene === 'drag' ? `
    g.setCalibration(${JSON.stringify(truth.calibration.points)}, truth.calibration.xScale, truth.calibration.yScale);
    // Drive a real pointer drag across the canvas so the region tool is
    // exercised through the same code path a mouse would use.
    const canvas = document.getElementById('canvas');
    const box = canvas.getBoundingClientRect();
    const fire = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      clientX: box.left + x, clientY: box.top + y, button: 0, buttons: buttons,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true
    }));
    g.setTool('area');
    fire('pointerdown', 260, 150, 1);
    await new Promise((r) => setTimeout(r, 40));
    fire('pointermove', 560, 330, 1);
    await new Promise((r) => setTimeout(r, 40));
    fire('pointermove', 820, 430, 1);
    await new Promise((r) => setTimeout(r, 40));
    fire('pointerup', 820, 430, 0);
    ` : ''}
    return 'done';
  })()`;

  const result = await win.webContents.executeJavaScript(script);
  console.log('script:', result);

  // The window has to be on screen for the compositor to produce a fresh
  // frame; a hidden window only ever yields the very first paint.
  win.setPosition(-4000, -4000);
  win.showInactive();
  await new Promise((r) => setTimeout(r, 1800));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage();
  const file = path.join(outDir, `${scene}-${lang}-${theme}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log('wrote', file);

  // Also dump some runtime state for inspection.
  const state = await win.webContents.executeJavaScript(`(() => {
    const s = window.__gd.store.state;
    const series = s.series[s.activeSeries];
    return {
      tool: s.ui.tool,
      language: s.ui.language,
      theme: s.ui.theme,
      calibrationOk: !!(window.__gd.calibration() && window.__gd.calibration().ok),
      maskPixels: window.__gd.maskInfo() ? window.__gd.maskInfo().count : 0,
      series: s.series.length,
      points: series ? series.points.length : 0,
      firstPoints: series ? series.points.slice(0, 4) : [],
      zoom: window.__gd.view.getView().zoom
    };
  })()`);
  console.log('state:', JSON.stringify(state, null, 2));

  app.quit();
});

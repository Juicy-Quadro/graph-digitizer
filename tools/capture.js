'use strict';

/*
 * Automated UI capture.
 *
 * Boots the real renderer, loads a sample figure, performs a calibration and
 * a trace, then writes a PNG of the window so the interface can be reviewed
 * without a human in front of the screen.
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
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

  const win = createTestWindow({
    root,
    width,
    height,
    backgroundColor: theme === 'light' ? '#f4f6fa' : '#11151c'
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });

  await new Promise((r) => setTimeout(r, 900));

  const truth = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'sample3-truth.json'), 'utf8'));
  const png = fs.readFileSync(path.join(root, 'testdata', 'sample3.png'));
  const dataURL = 'data:image/png;base64,' + png.toString('base64');

  const script = `(async () => {
    const g = window.__gd;
    ${lang === 'auto' ? '' : `g.setLanguage(${JSON.stringify(lang)});`}
    g.setTheme(${JSON.stringify(theme)});
    const truth = ${JSON.stringify(truth)};
    ${scene === 'empty' ? '' : `await g.loadImage(${JSON.stringify(dataURL)}, 'sample3.pcx');`}
    const line = truth.lines[truth.scaleIndex];
    ${scene === 'empty' ? '' : `g.setSampling({ method: 'color', lineColor: line.lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });`}
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
    ${scene === 'cloud' ? `
    // A contour map with a colour bar, framed and extracted.
    const W = 520, H = 360;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    const jet = (t) => {
      t = Math.max(0, Math.min(1, t));
      if (t < 0.375) return 'rgb(0,' + Math.round(255 * (t / 0.375)) + ',255)';
      if (t < 0.75) return 'rgb(0,255,' + Math.round(255 * (1 - (t - 0.375) / 0.375)) + ')';
      return 'rgb(' + Math.round(255 * ((t - 0.75) / 0.25)) + ',' + Math.round(255 * (1 - (t - 0.75) / 0.25)) + ',0)';
    };
    for (let y = 40; y < 300; y++) {
      for (let x = 40; x < 420; x++) {
        const v = 20 + 60 * (0.5 + 0.5 * Math.sin(x / 70) * Math.cos(y / 55));
        cx.fillStyle = jet(v / 100);
        cx.fillRect(x, y, 1, 1);
      }
    }
    for (let y = 40; y < 300; y++) {
      cx.fillStyle = jet(1 - (y - 40) / 260);
      cx.fillRect(460, y, 24, 1);
    }
    cx.fillStyle = '#000';
    cx.font = '13px Arial';
    cx.textBaseline = 'middle';
    cx.fillText('80', 440, 46);
    cx.fillText('40', 440, 168);
    cx.fillText('0', 440, 292);
    await g.loadImage(c.toDataURL('image/png'), 'contour.png', 'C:/tmp/contour.png');
    g.view.fit();
    g.setLlmReadBar(() => ({
      ok: true,
      ticks: [
        { label: '80', value: 80, position: 6 },
        { label: '40', value: 40, position: 128 },
        { label: '0', value: 0, position: 258 }
      ]
    }));
    // Frame the colour bar with a real drag.
    const canvas = document.getElementById('canvas');
    const box = canvas.getBoundingClientRect();
    const view = g.view.getView();
    const at = (x, y) => ({ x: box.left + x * view.zoom + view.offsetX, y: box.top + y * view.zoom + view.offsetY });
    const fire = (type, p, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      clientX: p.x, clientY: p.y, button: 0, buttons: buttons,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true
    }));
    document.querySelector('[data-action="cloud-pick-bar"]').click();
    fire('pointerdown', at(460, 40), 1);
    await new Promise((r) => setTimeout(r, 40));
    fire('pointermove', at(484, 300), 1);
    await new Promise((r) => setTimeout(r, 40));
    fire('pointerup', at(484, 300), 0);
    await new Promise((r) => setTimeout(r, 120));
    document.querySelector('[data-action="cloud-ai-ticks"]').click();
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector('[data-action="cloud-extract"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const panel = document.querySelector('[data-panel="cloud"]');
    if (panel) panel.scrollIntoView({ block: 'start' });
    await new Promise((r) => setTimeout(r, 200));
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

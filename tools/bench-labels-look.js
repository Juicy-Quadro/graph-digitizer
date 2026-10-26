'use strict';

/*
 * Draws the tick labels that the application finds and the ones the
 * reference finds on top of the colour bar, so that the two can be compared
 * by eye.
 *
 *   electron tools/bench-labels-look.js [count]
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const benchDir = path.join(root, 'testdata', 'bench');
const figuresDir = path.join(benchDir, 'figures');
const manifestFile = path.join(benchDir, 'manifest.json');
const outDir = path.join(benchDir, 'look');

// A closed pipe must not take the whole run down.
process.stdout.on('error', (err) => { void err; });
process.stderr.on('error', (err) => { void err; });

app.disableHardwareAcceleration();

const limit = Number(process.argv[2] || 6);

app.whenReady().then(async () => {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).figures || [];
  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1200));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let drawn = 0;
  for (const entry of manifest) {
    if (drawn >= limit) break;
    if (!entry.bar) continue;
    const reference = (entry.labels || []).filter((l) => l.t >= 0 && l.t <= 1);
    if (reference.length < 2) continue;
    const file = path.join(figuresDir, entry.file);
    if (!fs.existsSync(file)) continue;
    const dataURL = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const out = await win.webContents.executeJavaScript(`(async () => {
      const CB = window.GD.ColorBar;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('cannot decode'));
        img.src = ${JSON.stringify(dataURL)};
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bar = ${JSON.stringify(entry.bar)};
      const mine = CB.findTickLabels(imageData, bar, { orientation: 'vertical' });

      // The crop shows the bar and everything beside it.
      const x0 = Math.max(0, bar.x - 30);
      const y0 = Math.max(0, bar.y - 20);
      const x1 = Math.min(canvas.width, bar.x + bar.w + 220);
      const y1 = Math.min(canvas.height, bar.y + bar.h + 20);
      const view = document.createElement('canvas');
      view.width = x1 - x0;
      view.height = y1 - y0;
      const vctx = view.getContext('2d');
      vctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
      vctx.font = '13px sans-serif';
      vctx.lineWidth = 2;
      // The labels of the application.
      vctx.strokeStyle = '#00d000';
      for (const l of mine) {
        vctx.beginPath();
        vctx.moveTo(0, l.y - y0 - 6);
        vctx.lineTo(view.width, l.y - y0 - 6);
        vctx.stroke();
        vctx.fillStyle = '#00d000';
        vctx.fillText('app', 2, l.y - y0 - 9);
      }
      // The labels of the reference.
      vctx.strokeStyle = '#ff2020';
      for (const l of ${JSON.stringify(reference)}) {
        vctx.beginPath();
        vctx.moveTo(0, l.y - y0 + 6);
        vctx.lineTo(view.width, l.y - y0 + 6);
        vctx.stroke();
        vctx.fillStyle = '#ff2020';
        vctx.fillText('ref', 2, l.y - y0 + 18);
      }
      // The bar itself.
      vctx.strokeStyle = '#2060ff';
      vctx.strokeRect(bar.x - x0, bar.y - y0, bar.w, bar.h);
      return view.toDataURL('image/png');
    })()`);
    const name = entry.file.replace(/\.jpg$/, '.png');
    fs.writeFileSync(path.join(outDir, name), Buffer.from(out.split(',')[1], 'base64'));
    console.log('wrote ' + name + '  app=' + entry.file);
    drawn++;
  }
  app.exit(0);
});

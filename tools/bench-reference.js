'use strict';

/*
 * The reference of the benchmark: what the classical algorithm finds in
 * every collected figure.
 *
 *   electron tools/bench-reference.js
 *
 * The result is written to testdata/bench/manifest.json and is the ground
 * truth the model is measured against.
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const benchDir = path.join(root, 'testdata', 'bench');
const figuresDir = path.join(benchDir, 'figures');
const papersFile = path.join(benchDir, 'papers.json');
const manifestFile = path.join(benchDir, 'manifest.json');
const logFile = path.join(benchDir, 'reference.log');
const visionFile = path.join(__dirname, 'bench-vision.js');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// A closed pipe must not take the whole run down.
process.stdout.on('error', (err) => { void err; });
process.stderr.on('error', (err) => { void err; });

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!fs.existsSync(figuresDir) || !fs.readdirSync(figuresDir).length) {
    console.log('no figures collected yet, run: python tools/bench_fetch.py');
    app.exit(1);
    return;
  }
  let papers = [];
  if (fs.existsSync(papersFile)) {
    papers = JSON.parse(fs.readFileSync(papersFile, 'utf8'));
  }
  // The collector writes its list every ten papers, so the folder can hold
  // more figures than the list knows about.
  const known = new Set(papers.map((p) => p.file));
  for (const name of fs.readdirSync(figuresDir)) {
    if (!name.endsWith('.jpg') || known.has(name)) continue;
    papers.push({ file: name, paper: name.split('__')[0], title: '', category: '' });
  }
  console.log('%d figures', papers.length);
  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1200));
  // The helpers of the benchmark live in the renderer, where the modules of
  // the application are.
  await win.webContents.executeJavaScript(fs.readFileSync(visionFile, 'utf8'));

  const manifest = [];
  let withCurve = 0;
  let withBar = 0;
  const limit = Number(arg('limit', 0));
  fs.writeFileSync(logFile, '');
  for (let i = 0; i < papers.length; i++) {
    if (limit && manifest.length >= limit) break;
    const entry = papers[i];
    const file = path.join(figuresDir, entry.file);
    if (!fs.existsSync(file)) continue;
    const dataURL = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const started = Date.now();
    // The image has to be decoded before it can be measured, so the work
    // is done in one go inside the renderer.
    const out = await win.webContents.executeJavaScript(`(async () => {
      const BV = window.BenchVision;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('the figure could not be decoded'));
        img.src = ${JSON.stringify(dataURL)};
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const curve = BV.referenceCurve(imageData);
      const bar = BV.findColourBar(imageData);
      const labels = bar ? BV.findTickLabels(imageData, bar) : [];
      // A subsample of the reference curve keeps the manifest small.
      const step = Math.max(1, Math.floor(curve.points.length / 120));
      const points = [];
      for (let k = 0; k < curve.points.length; k += step) {
        points.push([Math.round(curve.points[k].x), Math.round(curve.points[k].y)]);
      }
      return {
        width: canvas.width,
        height: canvas.height,
        curve: curve.ok ? {
          colour: curve.colour,
          length: Math.round(curve.length),
          purity: Math.round(curve.purity * 100) / 100,
          points: points
        } : null,
        curveReason: curve.ok ? null : (curve.reason || 'unknown'),
        bar: bar,
        labels: labels
      };
    })()`);
    const record = {
      file: entry.file,
      paper: entry.paper,
      title: entry.title,
      category: entry.category,
      url: entry.url,
      width: out.width,
      height: out.height,
      curve: out.curve,
      curveReason: out.curveReason,
      bar: out.bar,
      labels: out.labels
    };
    manifest.push(record);
    if (out.curve) withCurve++;
    if (out.bar) withBar++;
    const took = Date.now() - started;
    if (took > 1500 || manifest.length % 25 === 0) {
      console.log('  %d figures, %d with a curve, %d with a colour bar, last took %d ms (%s)',
        manifest.length, withCurve, withBar, took, entry.file);
    }
    // The progress also goes to a file, so it can be watched while the
    // process is running.
    fs.appendFileSync(logFile, manifest.length + '\t' + took + '\t' + entry.file + '\n');
    if (manifest.length % 25 === 0) {
      fs.writeFileSync(manifestFile, JSON.stringify({ figures: manifest }, null, 1));
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify({ figures: manifest }, null, 1));
  console.log('%d figures, %d with a curve, %d with a colour bar', manifest.length, withCurve, withBar);
  console.log('wrote ' + manifestFile);
  app.exit(0);
});

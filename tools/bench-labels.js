'use strict';

/*
 * How well does the application find the tick labels of a colour bar?
 *
 * The model benchmark measures the numbers the model reads. This one measures
 * the places: the labels of the application are compared with the labels of
 * the reference over every collected figure. Both run without the model, so
 * it is quick.
 *
 *   electron tools/bench-labels.js
 *
 * The result is written to testdata/bench/labels.json.
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const benchDir = path.join(root, 'testdata', 'bench');
const figuresDir = path.join(benchDir, 'figures');
const manifestFile = path.join(benchDir, 'manifest.json');
const outFile = path.join(benchDir, 'labels.json');

// A closed pipe must not take the whole run down.
process.stdout.on('error', (err) => { void err; });
process.stderr.on('error', (err) => { void err; });

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!fs.existsSync(manifestFile)) {
    console.log('no manifest yet, run: electron tools/bench-reference.js');
    app.exit(1);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).figures || [];
  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1200));

  const records = [];
  let withBar = 0;
  let scored = 0;
  let matched = 0;
  let found = 0;
  let sumError = 0;
  let sumCovered = 0;
  let sumLabels = 0;

  for (const entry of manifest) {
    if (!entry.bar) continue;
    withBar++;
    const file = path.join(figuresDir, entry.file);
    if (!fs.existsSync(file)) continue;
    const dataURL = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const out = await win.webContents.executeJavaScript(`(async () => {
      const CB = window.GD.ColorBar;
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
      const labels = CB.findTickLabels(imageData, ${JSON.stringify(entry.bar)}, { orientation: 'vertical' });
      return labels.map((l) => ({ y: l.y, t: l.t, height: l.height }));
    })()`);

    const reference = (entry.labels || []).filter((l) => l.t >= 0 && l.t <= 1);
    const mine = out.filter((l) => l.t >= -0.05 && l.t <= 1.05);
    const record = {
      file: entry.file,
      reference: reference.length,
      found: mine.length,
      covered: 0,
      exact: 0,
      error: null
    };
    if (reference.length >= 2) {
      scored++;
      if (mine.length) found++;
      /*
       * How many of the labels of the reference the application found, and
       * how far the worst of them is off.
       */
      let worst = 0;
      let covered = 0;
      for (const label of reference) {
        let near = Infinity;
        for (const l of mine) near = Math.min(near, Math.abs(l.y - label.y));
        if (!isFinite(near)) continue;
        if (near <= 20) covered++;
        if (near > worst) worst = near;
      }
      record.covered = covered;
      record.exact = reference.length;
      record.error = Math.round(worst * 10) / 10;
      sumError += record.error;
      sumCovered += covered;
      sumLabels += reference.length;
      if (covered === reference.length) matched++;
    }
    records.push(record);
    if (records.length % 50 === 0) {
      console.log('  %d figures with a bar, %d scored, %d within 20 px',
        records.length, scored, matched);
    }
  }

  fs.writeFileSync(outFile, JSON.stringify({ records: records }, null, 1));
  console.log('%d figures with a colour bar', withBar);
  console.log('%d of them have two or more printed labels', scored);
  console.log('%d of those the application found labels for', found);
  console.log('%s per cent of them every label of the reference was found',
    scored ? Math.round(matched * 1000 / scored) / 10 : 0);
  console.log('%s per cent of all labels of the reference were found',
    sumLabels ? Math.round(sumCovered * 1000 / sumLabels) / 10 : 0);
  console.log('the mean distance is %s px',
    scored ? Math.round(sumError / scored * 10) / 10 : '0');
  console.log('wrote ' + outFile);
  app.exit(0);
});

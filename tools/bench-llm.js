'use strict';

/*
 * The benchmark: the model against the classical algorithm on real figures
 * from arXiv.
 *
 *   set GD_LLM_KEY=...
 *   electron tools/bench-llm.js --task bar --limit 50
 *
 * Every figure is one line in testdata/bench/results.jsonl, so the run can
 * be stopped and continued. The line holds what the model answered and how
 * far it was from the reference.
 *
 * Two tasks are measured:
 *
 *   bar    The model reads the tick labels of a colour bar. The position of
 *          the labels is measured by the program, so the position error and
 *          the straightness of the read numbers are both known.
 *
 *   curve  The model reads the curves of a figure. There is no ground truth
 *          for that, so the measure is whether the returned points really
 *          sit on a drawn line and whether they form one continuous path.
 */

const { app, nativeImage } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const benchDir = path.join(root, 'testdata', 'bench');
const figuresDir = path.join(benchDir, 'figures');
const manifestFile = path.join(benchDir, 'manifest.json');
const resultsFile = path.join(benchDir, 'results.jsonl');
const visionFile = path.join(__dirname, 'bench-vision.js');
const llm = require(path.join(root, 'electron', 'llm.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const limit = Number(arg('limit', 0));
const only = arg('only', '');
const task = arg('task', 'both');
const wantCurves = task === 'both' || task === 'curve';
const wantBar = task === 'both' || task === 'bar';

/** How far the read tick values are from a straight line against the position. */
function affineResidual(pairs) {
  if (pairs.length < 3) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const n = pairs.length;
  for (const p of pairs) {
    sx += p.t;
    sy += p.value;
    sxx += p.t * p.t;
    sxy += p.t * p.value;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  let worst = 0;
  for (const p of pairs) {
    worst = Math.max(worst, Math.abs(p.value - (intercept + slope * p.t)));
  }
  const values = pairs.map((p) => p.value);
  const range = Math.max.apply(null, values) - Math.min.apply(null, values);
  return { worst: worst, range: range, relative: range ? worst / range : null };
}

/** A crop of the figure, as a data URL. */
function cropFigure(dataURL, x0, y0, x1, y1) {
  const image = nativeImage.createFromDataURL(dataURL);
  const rect = {
    x: Math.max(0, Math.round(x0)),
    y: Math.max(0, Math.round(y0)),
    width: Math.max(1, Math.round(x1 - x0)),
    height: Math.max(1, Math.round(y1 - y0))
  };
  const cropped = image.crop(rect);
  return {
    dataURL: cropped.toDataURL(),
    width: rect.width,
    height: rect.height,
    offsetX: rect.x,
    offsetY: rect.y
  };
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!fs.existsSync(manifestFile)) {
    console.log('no manifest, run: electron tools/bench-reference.js');
    app.exit(1);
    return;
  }
  const key = process.env.GD_LLM_KEY || '';
  if (!key) {
    console.log('no key, set GD_LLM_KEY');
    app.exit(1);
    return;
  }
  await llm.saveKey(key);

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).figures || [];
  const done = new Set();
  if (fs.existsSync(resultsFile)) {
    fs.readFileSync(resultsFile, 'utf8').split('\n').forEach((line) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        // A figure counts as done when the task it was measured for is done.
        if (record.curve || record.bar) done.add(record.file + ':' +
          (record.curve ? 'c' : '') + (record.bar ? 'b' : ''));
      } catch (err) {
        void err;
      }
    });
  }
  console.log('%d figures in the manifest', manifest.length);

  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1200));
  await win.webContents.executeJavaScript(fs.readFileSync(visionFile, 'utf8'));

  const out = fs.createWriteStream(resultsFile, { flags: 'a' });
  let count = 0;
  for (const entry of manifest) {
    if (limit && count >= limit) break;
    if (only && entry.file.indexOf(only) < 0 && entry.paper.indexOf(only) < 0) continue;
    const file = path.join(figuresDir, entry.file);
    if (!fs.existsSync(file)) continue;
    const dataURL = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');

    const record = {
      file: entry.file,
      paper: entry.paper,
      category: entry.category,
      width: entry.width,
      height: entry.height,
      hasBar: !!entry.bar,
      labels: (entry.labels || []).length,
      curve: null,
      bar: null
    };

    if (wantCurves) {
      const started = Date.now();
      let res = null;
      try {
        res = await llm.extractCurves({
          image: dataURL,
          width: entry.width,
          height: entry.height
        });
      } catch (err) {
        res = { ok: false, error: String(err && err.message ? err.message : err) };
      }
      record.curve = {
        ok: !!(res && res.ok),
        error: res && res.error ? res.error : null,
        ms: Date.now() - started,
        series: 0,
        points: 0
      };
      if (res && res.ok && res.series && res.series.length) {
        record.curve.series = res.series.length;
        // The points of every series on their own, so the continuity is
        // measured inside a series and not between two of them.
        const series = res.series.map((line) => (line.points || []).map((p) => [
          p.x * entry.width, p.y * entry.height
        ]));
        const points = [];
        series.forEach((s) => s.forEach((p) => points.push(p)));
        record.curve.points = points.length;
        // The measure that needs no ground truth: do the points sit on a
        // drawn line, and do they form one path?
        const measured = await win.webContents.executeJavaScript(`(async () => {
          const BV = window.BenchVision;
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('decode failed'));
            img.src = ${JSON.stringify(dataURL)};
          });
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const series = ${JSON.stringify(series)};
          let on = 0;
          let total = 0;
          const jumps = [];
          let steps = 0;
          for (const s of series) {
            const measured = BV.onStructure(imageData, s, 40);
            on += measured.on;
            total += measured.count;
            const coherent = BV.coherence(s, 10);
            if (coherent) {
              jumps.push(coherent.jumps);
              steps += s.length - 1;
            }
          }
          const jumpTotal = jumps.reduce((a, b) => a + b, 0);
          return {
            on: total ? on / total : 0,
            coherent: steps ? jumpTotal / steps : null
          };
        })()`);
        record.curve.onStructure = measured.on;
        record.curve.coherence = measured.coherent;
        // And the classic reference, where there is one.
        if (entry.curve && entry.curve.points && entry.curve.points.length > 2) {
          const reference = entry.curve.points;
          let sum = 0;
          let worst = 0;
          for (const p of points) {
            const d = distanceToPolyline(reference, p[0], p[1]);
            sum += d;
            if (d > worst) worst = d;
          }
          let covered = 0;
          for (const p of reference) {
            for (const q of points) {
              if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= 6) {
                covered++;
                break;
              }
            }
          }
          record.curve.deviation = {
            mean: points.length ? sum / points.length : null,
            worst: worst,
            covered: covered / reference.length
          };
        }
      }
    }

    if (wantBar && entry.bar) {
      // Only the figures whose colour bar really has printed labels next to
      // it can be scored, so only those are worth a call.
      const inside = (entry.labels || []).filter((l) => l.t >= 0 && l.t <= 1);
      if (inside.length < 2) {
        record.bar = { skipped: 'no_verifiable_labels' };
        out.write(JSON.stringify(record) + '\n');
        count++;
        continue;
      }
      // The window follows the labels to their end and is scaled up, the
      // same way the application does it.
      const crop = await win.webContents.executeJavaScript(`(async () => {
        const CB = window.GD.ColorBar;
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('decode failed'));
          img.src = ${JSON.stringify(dataURL)};
        });
        const source = document.createElement('canvas');
        source.width = img.naturalWidth;
        source.height = img.naturalHeight;
        const sctx = source.getContext('2d', { willReadFrequently: true });
        sctx.drawImage(img, 0, 0);
        const imageData = sctx.getImageData(0, 0, source.width, source.height);
        const window = CB.labelWindow(imageData, ${JSON.stringify(entry.bar)}, { margin: 10 });
        const turned = document.createElement('canvas');
        turned.width = Math.max(1, Math.round(window.w));
        turned.height = Math.max(1, Math.round(window.h));
        const tctx = turned.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(source, window.x, window.y, window.w, window.h, 0, 0, turned.width, turned.height);
        const size = CB.modelSize(turned.width, turned.height, 1400);
        const final = document.createElement('canvas');
        final.width = size.width;
        final.height = size.height;
        const fctx = final.getContext('2d');
        fctx.imageSmoothingQuality = 'high';
        fctx.drawImage(turned, 0, 0, final.width, final.height);
        return {
          dataURL: final.toDataURL('image/png'),
          width: final.width,
          height: final.height,
          offsetX: window.x,
          offsetY: window.y
        };
      })()`);
      const started = Date.now();
      let res = null;
      try {
        res = await llm.readColorBar({
          image: crop.dataURL,
          width: crop.width,
          height: crop.height,
          offsetX: crop.offsetX,
          offsetY: crop.offsetY,
          orientation: 'vertical'
        });
      } catch (err) {
        res = { ok: false, error: String(err && err.message ? err.message : err) };
      }
      record.bar = {
        ok: !!(res && res.ok),
        error: res && res.error ? res.error : null,
        ms: Date.now() - started,
        ticks: 0,
        positionError: null,
        residual: null
      };
      if (res && res.ok && res.ticks && res.ticks.length) {
        record.bar.ticks = res.ticks.length;
        const pairs = [];
        for (const tick of res.ticks) {
          if (!isFinite(tick.position) || !isFinite(tick.value)) continue;
          const original = crop.offsetY + tick.position;
          const t = 1 - (original - entry.bar.y) / entry.bar.h;
          pairs.push({ t: t, value: tick.value, original: original });
        }
        if (pairs.length >= 2) {
          // How far the read positions are from the printed labels.
          let worst = 0;
          let sum = 0;
          let n = 0;
          for (const p of pairs) {
            let near = Infinity;
            for (const label of (entry.labels || [])) {
              near = Math.min(near, Math.abs(label.y - p.original));
            }
            if (isFinite(near)) {
              worst = Math.max(worst, near);
              sum += near;
              n++;
            }
          }
          if (n) {
            record.bar.positionError = worst;
            record.bar.positionMean = sum / n;
          }
          record.bar.residual = affineResidual(pairs);
          record.bar.pairs = pairs.map((p) => ({
            t: Math.round(p.t * 1000) / 1000,
            value: p.value
          }));
        }
      }
    }

    out.write(JSON.stringify(record) + '\n');
    count++;
    if (count % 5 === 0) {
      console.log('  %d figures measured' % count);
    }
  }
  out.end();
  await llm.forgetKey();
  console.log('%d figures measured' % count);
  app.exit(0);
});

/** The distance of a point to a polyline, in pixels. */
function distanceToPolyline(points, x, y) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
    }
    const d = Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
    if (d < best) best = d;
  }
  return best;
}

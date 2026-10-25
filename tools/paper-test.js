'use strict';

/*
 * Regression on real figures taken from arXiv papers.
 *
 * The synthetic figures of the algorithm suite check the maths on inputs
 * that were built for it. These figures are the other kind of check: they
 * come from real papers, with real colour maps, real labels and real
 * anti-aliasing, and they were not made to suit the algorithm.
 *
 * The truth of every figure is written down in testdata/papers/truth.json:
 * where the colour bar is and which value its tick labels stand for. The
 * position of the labels is found by the program, so the truth does not
 * depend on reading pixel numbers off a screen.
 *
 * The figures come from arXiv: 2601.00342, "Solving nonlinear subsonic
 * compressible flow in infinite domain via multi-stage neural networks".
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const paperDir = path.join(root, 'testdata', 'papers');
const truthFile = path.join(paperDir, 'truth.json');

let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
};

/**
 * The value of a position on the bar, worked out here and not with the code
 * that is under test: the known values are joined by straight lines and the
 * line is continued past the outermost known value.
 */
function expectedValue(anchors, t) {
  const list = anchors.slice().sort((a, b) => a.t - b.t);
  if (list.length === 1) return list[0].value;
  let a = list[0];
  let b = list[1];
  if (t >= list[list.length - 1].t) {
    a = list[list.length - 2];
    b = list[list.length - 1];
  } else if (t > list[0].t) {
    for (let i = 0; i < list.length - 1; i++) {
      if (t >= list[i].t && t <= list[i + 1].t) {
        a = list[i];
        b = list[i + 1];
        break;
      }
    }
  }
  const span = b.t - a.t;
  const f = span === 0 ? 0 : (t - a.t) / span;
  return a.value + (b.value - a.value) * f;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!fs.existsSync(truthFile)) {
    console.log('  (skipped: the paper figures are not fetched)');
    console.log('    run: python tools/fetch_paper_figures.py');
    console.log('\nno paper figures, nothing to check');
    app.exit(0);
    return;
  }

  const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1200));

  for (const entry of truth.figures || []) {
    console.log('\n  ' + entry.file + '   ' + (entry.paper || ''));
    const file = path.join(paperDir, entry.file);
    if (!fs.existsSync(file)) {
      check('the figure is there', false, file);
      continue;
    }
    const dataURL = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

    // The figure is handed to the renderer as a data URL, so the test runs
    // the very code the application runs.
    const loaded = await win.webContents.executeJavaScript(`(async () => {
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
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return {
        width: canvas.width,
        height: canvas.height,
        data: Array.from(d.data)
      };
    })()`);

    const imageData = {
      width: loaded.width,
      height: loaded.height,
      data: Uint8ClampedArray.from(loaded.data)
    };

    const anchors = entry.anchors;
    const scan = await win.webContents.executeJavaScript(`(() => {
      const CB = window.GD.ColorBar;
      const img = { width: ${loaded.width}, height: ${loaded.height},
                    data: Uint8ClampedArray.from(${JSON.stringify(loaded.data)}) };
      const scan = CB.scanBar(img, ${JSON.stringify(entry.bar)}, {});
      if (!scan.ok) return { ok: false, reason: scan.reason, samples: scan.samples.length };
      const map = CB.buildMap({
        samples: scan.samples,
        anchors: ${JSON.stringify(anchors)},
        scale: 'linear'
      }, {});
      if (!map.ok) return { ok: false, reason: map.reason, samples: scan.samples.length };
      return {
        ok: true,
        samples: scan.samples.length,
        bands: scan.samples.map((s) => ({ t: s.t, color: s.color }))
      };
    })()`);

    check('the colour bar of the paper figure is scanned',
      scan.ok === true && scan.samples >= 100,
      scan.ok ? scan.samples + ' bands' : scan.reason);

    if (!scan.ok) continue;

    // Every band has to look up to the value its position stands for.
    let worst = 0;
    let worstAt = null;
    let outside = 0;
    // The lookup itself is done in the renderer, in one go.
    const lookup = await win.webContents.executeJavaScript(`(() => {
      const CB = window.GD.ColorBar;
      const img = { width: ${loaded.width}, height: ${loaded.height},
                    data: Uint8ClampedArray.from(${JSON.stringify(loaded.data)}) };
      const scan = CB.scanBar(img, ${JSON.stringify(entry.bar)}, {});
      const map = CB.buildMap({ samples: scan.samples, anchors: ${JSON.stringify(anchors)}, scale: 'linear' }, {});
      const out = [];
      for (const s of scan.samples) {
        const v = map.valueAt(s.color[0], s.color[1], s.color[2]);
        out.push({ t: s.t, value: v });
      }
      return out;
    })()`);

    for (const band of lookup) {
      if (band.value === null) {
        outside++;
        continue;
      }
      const want = expectedValue(anchors, band.t);
      const error = Math.abs(band.value - want);
      if (error > worst) {
        worst = error;
        worstAt = { t: band.t, got: band.value, want: want };
      }
    }

    const span = Math.abs(expectedValue(anchors, 1) - expectedValue(anchors, 0));
    check('every band of the bar looks up to its own value',
      worst <= span * 0.03,
      'worst deviation ' + worst.toExponential(2) +
      ', that is ' + (span ? (100 * worst / span).toFixed(2) : '0') + ' percent of the range' +
      (worstAt ? ' at t=' + worstAt.t.toFixed(3) : ''));
    check('no band of the bar is left without a value', outside === 0, outside + ' bands');

    // The field of the figure itself.
    const field = await win.webContents.executeJavaScript(`(() => {
      const CB = window.GD.ColorBar;
      const img = { width: ${loaded.width}, height: ${loaded.height},
                    data: Uint8ClampedArray.from(${JSON.stringify(loaded.data)}) };
      const scan = CB.scanBar(img, ${JSON.stringify(entry.bar)}, {});
      const map = CB.buildMap({ samples: scan.samples, anchors: ${JSON.stringify(anchors)}, scale: 'linear' }, {});
      const f = CB.extractField(img, map, {
        region: { x: 0, y: 0, w: img.width, h: img.height },
        exclude: [${JSON.stringify(entry.bar)}],
        step: ${entry.step || 2}
      });
      let outside = 0;
      let worstNeighbour = 0;
      let seen = 0;
      // The field is stored as single precision floats, so the range has to
      // be compared with a margin that fits the rounding.
      const margin = Math.abs(f.max - f.min) * 1e-6 + 1e-12;
      for (let gy = 0; gy < f.height; gy++) {
        for (let gx = 0; gx < f.width; gx++) {
          const v = f.values[gy * f.width + gx];
          if (!isFinite(v)) continue;
          seen++;
          if (v < f.min - margin || v > f.max + margin) outside++;
          if (gx + 1 < f.width) {
            const w = f.values[gy * f.width + gx + 1];
            if (isFinite(w)) worstNeighbour = Math.max(worstNeighbour, Math.abs(v - w));
          }
        }
      }
      return {
        count: f.count,
        cells: f.width * f.height,
        min: f.min,
        max: f.max,
        outside: outside,
        worstNeighbour: worstNeighbour
      };
    })()`);

    check('the figure is read as a field of values',
      field.count > 500, field.count + ' of ' + field.cells + ' cells');
    check('no value leaves the range of the bar', field.outside === 0,
      field.outside + ' values outside');
    check('the field of the paper figure is smooth',
      field.worstNeighbour < span * 0.25,
      'worst neighbour difference ' + field.worstNeighbour.toExponential(2) +
      ' of a range of ' + span.toExponential(2));
  }

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'the paper figures pass'));
  app.exit(failures ? 1 : 0);
});

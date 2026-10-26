'use strict';
/* Verifies the experience fixes made in the 1.1 pass. */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = 'E:/projects/graph-digitizer';
let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1200));

  const truth = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'sample3-truth.json'), 'utf8'));
  const png = fs.readFileSync(path.join(root, 'testdata', 'sample3.png'));
  const dataURL = 'data:image/png;base64,' + png.toString('base64');

  const run = (code) => win.webContents.executeJavaScript(code);

  // --- 1. loading an image resets the previous digitising state ----------
  await run(`(async () => {
    const g = window.__gd;
    const t = ${JSON.stringify(truth)};
    const url = ${JSON.stringify(dataURL)};
    await g.loadImage(url, 'a.png', 'C:/tmp/a.png');
    g.setCalibration(t.calibration.points, t.calibration.xScale, t.calibration.yScale);
    g.setSampling({ method: 'color', lineColor: t.lines[t.scaleIndex].lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });
    g.traceAt(t.lines[t.scaleIndex].points[0][0], t.lines[t.scaleIndex].points[0][1]);
    await g.loadImage(url, 'b.png', 'C:/tmp/b.png');
  })()`);
  let s = await run(`({
    series: window.__gd.store.state.series.length,
    points: window.__gd.store.state.series[0].points.length,
    calibSet: !!window.__gd.store.state.calibration.points.xmin
  })`);
  check('a new image clears the previous points', s.points === 0, 'points=' + s.points);
  check('a new image clears the previous calibration', s.calibSet === false);

  // --- 2. changing the calibration recomputes the points ---------------
  await run(`(async () => {
    const g = window.__gd;
    const t = ${JSON.stringify(truth)};
    await g.loadImage(${JSON.stringify(dataURL)}, 'a.png', 'C:/tmp/a.png');
    g.setCalibration(t.calibration.points, t.calibration.xScale, t.calibration.yScale);
    g.setSampling({ method: 'color', lineColor: t.lines[t.scaleIndex].lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });
    g.traceAt(t.lines[t.scaleIndex].points[0][0], t.lines[t.scaleIndex].points[0][1]);
  })()`);
  const before = await run(`window.__gd.store.state.series[0].points[0]`);
  // Drive the real inspector input so the user facing path is exercised.
  await run(`(() => {
    const row = document.querySelector('[data-calib="xmax"]');
    const input = row.querySelector('.calib-value');
    const value = Number(input.value) * 2;
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const after = await run(`window.__gd.store.state.series[0].points[0]`);
  check('changing a calibration value recomputes the points',
    Math.abs(after.x - before.x) > 1e-9 && Math.abs(after.px - before.px) < 1e-9,
    'x ' + before.x.toFixed(6) + ' -> ' + after.x.toFixed(6) + ', px unchanged=' + (after.px === before.px));

  // --- 3. the mask overlay switch really changes the canvas -------------
  await run(`(async () => {
    const g = window.__gd;
    const t = ${JSON.stringify(truth)};
    await g.loadImage(${JSON.stringify(dataURL)}, 'a.png', 'C:/tmp/a.png');
    g.setSampling({ method: 'color', lineColor: t.lines[t.scaleIndex].lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });
    document.querySelector('#show-mask').checked = false;
    document.querySelector('#show-mask').dispatchEvent(new Event('change'));
  })()`);
  const overlay = await run(`(() => {
    const c = document.getElementById('canvas');
    const ctx = c.getContext('2d');
    const img = window.__gd.view.getView();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let tinted = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && d[i + 2] > 150 && d[i] < 140) tinted++;
    }
    return { tinted, storeFlag: window.__gd.store.state.sampling.showMask };
  })()`);
  check('the mask overlay switch reaches the canvas',
    overlay.storeFlag === false, 'store flag=' + overlay.storeFlag);

  // --- 4. renaming a series through the in-app dialog ------------------
  const rename = await run(`(() => {
    const g = window.__gd;
    const chip = document.querySelector('.series-chip');
    chip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.getElementById('series-name-input');
    if (!input) return { opened: false };
    input.value = 'Renamed series';
    document.querySelector('[data-action="modal-confirm"]').click();
    return { opened: true, name: g.store.state.series[0].name };
  })()`);
  check('a series can be renamed through the in-app dialog',
    rename.opened && rename.name === 'Renamed series', JSON.stringify(rename));

  // --- 5. the empty state shows the quick start -------------------------
  const empty = await run(`(() => {
    const cards = document.querySelectorAll('.quickstart-item');
    return { count: cards.length, hidden: document.getElementById('empty-state').hidden };
  })()`);
  check('the empty state carries the quick start guide', empty.count === 3, empty.count + ' cards');

  // --- 6. the colours of the figure are found when it is opened ---------
  const colours = await run(`(async () => {
    const g = window.__gd;
    const url = ${JSON.stringify(dataURL)};
    // A figure that is opened gets its colours from the program, so the
    // colours that were set before are replaced.
    g.setSampling({ lineColor: [12, 34, 56] });
    await g.loadImage(url, 'a.png', 'C:/tmp/a.png');
    const found = g.store.state.sampling.lineColor;
    // A workspace brings its own colours and keeps them.
    g.setSampling({ lineColor: [12, 34, 56] });
    await g.loadImage(url, 'b.png', 'C:/tmp/b.png', true);
    return { found, kept: g.store.state.sampling.lineColor };
  })()`);
  check('the colours of a figure are found when it is opened',
    !!colours.found && (colours.found[0] !== 12 || colours.found[1] !== 34 || colours.found[2] !== 56),
    JSON.stringify(colours.found));
  check('a workspace keeps the colours it brings',
    colours.kept && colours.kept[0] === 12 && colours.kept[1] === 34 && colours.kept[2] === 56,
    JSON.stringify(colours.kept));

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all experience checks passed'));
  app.exit(failures ? 1 : 0);
});

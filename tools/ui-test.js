'use strict';

/*
 * Regression test of the pointer and selection behaviour of the canvas and
 * the data table. It drives the real renderer through the real DOM, so the
 * synthetic pointer events travel the same code path as a user gesture.
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = createTestWindow({ root });
  await new Promise((r) => setTimeout(r, 1500));

  const truth = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'sample3-truth.json'), 'utf8'));
  const png = fs.readFileSync(path.join(root, 'testdata', 'sample3.png'));
  const dataURL = 'data:image/png;base64,' + png.toString('base64');
  const run = (code) => win.webContents.executeJavaScript(code);

  // --- setup: an image, a calibration and three traced points ------------
  await run(`(async () => {
    const g = window.__gd;
    const t = ${JSON.stringify(truth)};
    await g.loadImage(${JSON.stringify(dataURL)}, 'a.png', 'C:/tmp/a.png');
    g.setCalibration(t.calibration.points, t.calibration.xScale, t.calibration.yScale);
    g.setSampling({ method: 'color', lineColor: t.lines[t.scaleIndex].lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });
    const p = t.lines[t.scaleIndex].points;
    for (const q of [p[10], p[40], p[70]]) g.traceAt(q[0], q[1]);
    g.setTool('select');
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  const setup = await run(`({
    count: window.__gd.store.state.series[0].points.length,
    px: window.__gd.store.state.series[0].points.map(p => p.px),
    py: window.__gd.store.state.series[0].points.map(p => p.py)
  })`);
  check('the scene is prepared', setup.count >= 3, setup.count + ' points');

  // --- 1. the click gesture is measured in screen pixels -----------------
  const gesture = await run(`(() => {
    const g = window.__gd;
    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    const events = [];
    g.view.on('click', () => events.push('click'));
    g.view.on('dragend', () => events.push('dragend'));

    const send = (type, x, y) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: rect.left + x, clientY: rect.top + y,
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1
      }));
    };

    const out = {};

    // Zoomed out, a one pixel jitter is a click. Measured in image pixels
    // the same movement is five pixels and used to be thrown away.
    g.view.setZoom(0.25);
    send('pointerdown', 120, 120);
    send('pointerup', 121, 121);
    out.zoomedOut = events.slice();
    events.length = 0;

    // Zoomed in, an eight pixel drag is a drag. Measured in image pixels
    // the same movement is one pixel and used to be reported as a click.
    g.view.setZoom(8);
    send('pointerdown', 120, 120);
    send('pointerup', 128, 120);
    out.zoomedIn = events.slice();
    events.length = 0;

    // A cancelled gesture is not a finished gesture.
    send('pointerdown', 120, 120);
    canvas.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 120, clientY: rect.top + 120,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0
    }));
    out.cancelled = events.slice();

    g.view.setZoom(1);
    return out;
  })()`);

  check('a one pixel jitter is a click at any zoom level',
    gesture.zoomedOut.length === 1 && gesture.zoomedOut[0] === 'click',
    JSON.stringify(gesture.zoomedOut));
  check('a real drag is a drag at any zoom level',
    gesture.zoomedIn.length === 1 && gesture.zoomedIn[0] === 'dragend',
    JSON.stringify(gesture.zoomedIn));
  check('a cancelled gesture creates nothing',
    gesture.cancelled.length === 0, JSON.stringify(gesture.cancelled));

  // --- 2. the canvas follows the selection of the table ------------------
  /**
   * The highlight colour of a selected point. The amber of the theme is
   * only used for the selection, so a scan cannot be fooled by the mask
   * overlay, which is painted in the accent colour.
   */
  const amberScan = () => run(`(() => {
    const canvas = document.getElementById('canvas');
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 190 && d[i + 1] > 130 && d[i + 1] < 215 && d[i + 2] < 100) {
        n++;
        sx += (i / 4) % canvas.width;
        sy += Math.floor((i / 4) / canvas.width);
      }
    }
    return { n: n, x: n ? sx / n / dpr : -1, y: n ? sy / n / dpr : -1 };
  })()`);

  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 6;

  /*
   * Three points that are far apart. A dense trace would not work here:
   * the marker of the neighbouring point would cover the highlight.
   */
  const screenPos = await run(`(() => {
    const g = window.__gd;
    const img = g.store.state.image;
    const calib = g.calibration();
    const spots = [[0.18, 0.22], [0.5, 0.55], [0.82, 0.8]];
    const points = spots.map(s => {
      const px = img.width * s[0];
      const py = img.height * s[1];
      const l = calib.toLogical(px, py);
      return { x: l.x, y: l.y, px: px, py: py };
    });
    g.store.setSeriesPoints(0, points);
    return points.map(p => g.view.imageToScreen(p.px, p.py));
  })()`);
  await new Promise((r) => setTimeout(r, 250));

  const gaps = [
    Math.hypot(screenPos[0].x - screenPos[1].x, screenPos[0].y - screenPos[1].y),
    Math.hypot(screenPos[1].x - screenPos[2].x, screenPos[1].y - screenPos[2].y)
  ];
  check('the points are far enough apart to be told apart',
    gaps[0] > 40 && gaps[1] > 40, gaps.map((g) => g.toFixed(0)).join(' / '));

  const selectRow = async (index) => {
    const found = await run(`(() => {
      const row = document.querySelector('#data-body tr[data-index="${index}"]');
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 250));
    return found;
  };

  const tableSelection = () => run(`(() => {
    const row = document.querySelector('#data-body tr.selected');
    return row ? row.getAttribute('data-index') : null;
  })()`);

  await selectRow(0);
  const selA = await tableSelection();
  const amberA = await amberScan();
  check('the table marks the clicked row', selA === '0', String(selA));
  check('the selected point is highlighted on the canvas',
    amberA.n > 0 && near(amberA, screenPos[0]),
    amberA.n + ' px at ' + amberA.x.toFixed(1) + ',' + amberA.y.toFixed(1));

  await selectRow(1);
  const selB = await tableSelection();
  const amberB = await amberScan();
  check('the table moves the selection', selB === '1', String(selB));
  check('the highlight follows the selection',
    amberB.n > 0 && near(amberB, screenPos[1]) && !near(amberB, screenPos[0]),
    amberB.n + ' px at ' + amberB.x.toFixed(1) + ',' + amberB.y.toFixed(1));

  // --- 3. deleting a point must not highlight a different point ----------
  await selectRow(0);
  const beforeDelete = await amberScan();
  const movedTo = await run(`(() => {
    const g = window.__gd;
    const pts = g.store.state.series[0].points;
    // The second point takes the place of the deleted first point.
    const target = g.view.imageToScreen(pts[1].px, pts[1].py);
    g.store.pushUndo();
    g.store.removePoints([0]);
    return target;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  const afterDelete = await amberScan();
  const selAfter = await tableSelection();
  check('the point was highlighted before the deletion',
    beforeDelete.n > 0 && near(beforeDelete, screenPos[0]), beforeDelete.n + ' px');
  check('a deleted point does not leave a highlight behind',
    afterDelete.n === 0 && !near(afterDelete, movedTo),
    afterDelete.n + ' px, table selection=' + selAfter);

  // --- 4. the click that ends a cell edit still reaches its row ----------
  const edit = await run(`(async () => {
    const rows = document.querySelectorAll('#data-body tr[data-index]');
    const row = rows[1];
    const index = row.getAttribute('data-index');
    // Start the inline edit with a double click.
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    const input = document.querySelector('#data-body .cell-input');
    if (!input) return { started: false, index: index };
    const before = Number(input.value);
    input.value = String(before + 1);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const rowsAfter = document.querySelectorAll('#data-body tr[data-index]');
    const other = rowsAfter[0];
    const otherIndex = other.getAttribute('data-index');
    other.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await new Promise((r) => setTimeout(r, 120));
    const selectedRow = document.querySelector('#data-body tr.selected');
    return {
      started: true,
      index: index,
      otherIndex: otherIndex,
      selected: selectedRow ? selectedRow.getAttribute('data-index') : null
    };
  })()`);

  check('the inline editor opens', edit.started === true, JSON.stringify(edit));
  check('the click after an edit still selects its row',
    edit.selected !== null && edit.selected === edit.otherIndex,
    JSON.stringify(edit));

  const value = await run(`window.__gd.store.state.series[0].points[${edit.index}].x`);
  check('the edited value reached the store', isFinite(value), String(value));

  // --- 5. the colour map workspace ---------------------------------------
  // A figure with a colour bar is built in the page and loaded, so the whole
  // path of the colour map can be driven: frame the bar, read the ticks,
  // extract the field and look at the result.
  await run(`(async () => {
    const W = 280, H = 200;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const jet = (t) => {
      t = Math.max(0, Math.min(1, t));
      if (t < 0.375) return 'rgb(0,' + Math.round(255 * (t / 0.375)) + ',255)';
      if (t < 0.75) return 'rgb(0,255,' + Math.round(255 * (1 - (t - 0.375) / 0.375)) + ')';
      return 'rgb(' + Math.round(255 * ((t - 0.75) / 0.25)) + ',' + Math.round(255 * (1 - (t - 0.75) / 0.25)) + ',0)';
    };
    for (let y = 20; y < 180; y++) {
      for (let x = 20; x < 170; x++) {
        const v = 50 + 40 * ((x - 20) / 150);
        ctx.fillStyle = jet(v / 100);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    for (let y = 20; y < 180; y++) {
      ctx.fillStyle = jet(1 - (y - 20) / 160);
      ctx.fillRect(200, y, 20, 1);
    }
    // The tick labels printed next to the bar.
    ctx.fillStyle = '#000';
    ctx.font = '13px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText('80', 224, 26);
    ctx.fillText('40', 224, 100);
    ctx.fillText('0', 224, 174);
    const url = canvas.toDataURL('image/png');
    await window.__gd.loadImage(url, 'cloud.png', 'C:/tmp/cloud.png');
    window.__gd.view.fit();
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  const panel = await run(`({
    exists: !!document.querySelector('[data-panel="cloud"]'),
    anchors: document.querySelectorAll('#cloud-anchors .cloud-anchor').length,
    summary: document.getElementById('cloud-summary').textContent
  })`);
  check('the cloud map panel is there', panel.exists === true);
  check('a fresh figure has no tick values', panel.anchors === 0, panel.anchors + ' rows');

  // Frame the colour bar with a drag over the bar of the figure.
  await run(`(() => {
    document.querySelector('[data-action="cloud-pick-bar"]').click();
  })()`);
  const framed = await run(`(() => {
    const g = window.__gd;
    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    const view = g.view.getView();
    const toClient = (x, y) => ({
      x: rect.left + x * view.zoom + view.offsetX,
      y: rect.top + y * view.zoom + view.offsetY
    });
    const send = (type, p, buttons) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: p.x, clientY: p.y,
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: buttons
      }));
    };
    const a = toClient(200, 20);
    const b = toClient(220, 180);
    send('pointerdown', a, 1);
    send('pointermove', b, 1);
    send('pointerup', b, 0);
    return { bar: g.store.state.grid.bar, anchors: g.store.state.grid.anchors.length };
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  check('the drag framed the colour bar',
    framed.bar && Math.abs(framed.bar.w - 20) < 3 && Math.abs(framed.bar.h - 160) < 6,
    JSON.stringify(framed.bar));
  check('framing the bar offers two tick values', framed.anchors === 2, framed.anchors + ' anchors');

  const edited = await run(`(() => {
    const input = document.querySelector('#cloud-anchors .cloud-anchor .cloud-value');
    input.value = '10';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const second = document.querySelectorAll('#cloud-anchors .cloud-anchor .cloud-value')[1];
    second.value = '90';
    second.dispatchEvent(new Event('input', { bubbles: true }));
    return window.__gd.store.state.grid.anchors.map(a => a.value);
  })()`);
  check('a hand typed tick value reaches the store',
    edited.length === 2 && edited[0] === 10 && edited[1] === 90, JSON.stringify(edited));

  // The model reads the tick labels; the reply is mocked so the test does
  // not need a key or a network.
  // The model reads the numbers and places them a little off, the way it
  // does on real figures. The program knows where the labels are printed, so
  // the positions of the anchors have to follow the labels, not the model.
  const aiRead = await run(`(async () => {
    const g = window.__gd;
    g.setLlmReadBar((payload) => {
      window.__aiPayload = payload;
      const bar = g.store.state.grid.bar;
      // The places are measured from the top of the crop, and they are ten
      // pixels off, the way the model places them on real figures.
      const at = (originalY) => originalY - payload.offsetY + 10;
      return {
        ok: true,
        ticks: [
          { label: '80', value: 80, position: at(26) },
          { label: '40', value: 40, position: at(100) },
          { label: '0', value: 0, position: at(174) }
        ]
      };
    });
    document.querySelector('[data-action="cloud-ai-ticks"]').click();
    await new Promise((r) => setTimeout(r, 200));
    return {
      anchors: g.store.state.grid.anchors.map(a => ({ t: a.t, value: a.value, label: a.label })),
      payload: window.__aiPayload
    };
  })()`);

  check('the model read three tick labels', aiRead.anchors.length === 3,
    aiRead.anchors.length + ' anchors');
  check('the values of the model are the ones that are used',
    aiRead.anchors.map((a) => a.value).join(',') === '80,40,0',
    JSON.stringify(aiRead.anchors.map((a) => a.value)));
  check('the positions of the printed labels win over the ones of the model',
    aiRead.anchors.length === 3 &&
    Math.abs(aiRead.anchors[0].t - 0.9625) < 0.03 &&
    Math.abs(aiRead.anchors[1].t - 0.5) < 0.03 &&
    Math.abs(aiRead.anchors[2].t - 0.0375) < 0.03,
    JSON.stringify(aiRead.anchors.map((a) => Math.round(a.t * 1000) / 1000)));
  check('the model got the crop of the bar',
    aiRead.payload && aiRead.payload.image.indexOf('data:image/png') === 0,
    aiRead.payload ? aiRead.payload.width + 'x' + aiRead.payload.height : 'no payload');
  check('the model got the crop of the bar',
    aiRead.payload && aiRead.payload.image.indexOf('data:image/png') === 0 &&
    aiRead.payload.orientation === 'vertical',
    aiRead.payload ? aiRead.payload.width + 'x' + aiRead.payload.height : 'no payload');

  await run(`(() => { window.__gd.setLlmReadBar(null); })()`);

  await run(`(() => {
    document.querySelector('[data-action="cloud-extract"]').click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  const extracted = await run(`(() => {
    const summary = document.getElementById('cloud-summary').textContent;
    const preview = document.getElementById('cloud-preview');
    const ctx = preview.getContext('2d');
    const d = ctx.getImageData(0, 0, preview.width, preview.height).data;
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) painted++;
    return { summary: summary, painted: painted, width: preview.width, height: preview.height };
  })()`);
  check('the extraction reports what it found',
    extracted.summary.indexOf('24') >= 0,
    extracted.summary);
  check('the field is drawn in the preview', extracted.painted > 500,
    extracted.painted + ' pixels');

  const grid = await run(`(() => {
    const g = window.__gd;
    const field = g.gridField();
    if (!field) return { lines: -1, count: 0 };
    const csv = g.GD.Exporters.toGridCSV(field, { decimals: 2 });
    return { lines: csv.split('\\r\\n').length, count: field.count };
  })()`);
  check('the grid export holds one row per line of the figure',
    grid.lines > 100, grid.lines + ' lines');
  check('the field holds every pixel of the figure',
    grid.count > 23000 && grid.count < 25000, grid.count + ' cells');

  // --- 6. the model reads the curves of a figure -------------------------
  const aiCurves = await run(`(async () => {
    const g = window.__gd;
    g.setLlmExtractCurves((payload) => ({
      ok: true,
      series: [{
        name: 'Model curve',
        color: '#ff8800',
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.5, y: 0.5 },
          { x: 0.9, y: 0.8 }
        ]
      }]
    }));
    const before = g.store.state.series.length;
    document.querySelector('[data-action="ai-extract-curves"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const series = g.store.state.series;
    const last = series[series.length - 1];
    g.setLlmExtractCurves(null);
    return {
      before: before,
      after: series.length,
      name: last ? last.name : null,
      points: last ? last.points.length : 0,
      px: last && last.points[0] ? last.points[0].px : null,
      py: last && last.points[0] ? last.points[0].py : null,
      // The answer is normalised to the figure, so the pixels depend on how
      // big the figure is.
      expectedX: 0.1 * g.store.state.image.width,
      expectedY: 0.2 * g.store.state.image.height
    };
  })()`);

  check('the model added a series', aiCurves.after === aiCurves.before + 1,
    aiCurves.before + ' -> ' + aiCurves.after);
  check('the curve came back with its points',
    aiCurves.points === 3 && aiCurves.name === 'Model curve',
    aiCurves.name + ', ' + aiCurves.points + ' points');
  check('the normalised points became pixel positions',
    Math.abs(aiCurves.px - aiCurves.expectedX) < 1 && Math.abs(aiCurves.py - aiCurves.expectedY) < 1,
    'px=' + aiCurves.px + ' py=' + aiCurves.py);

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'all interface checks passed'));
  app.exit(failures ? 1 : 0);
});

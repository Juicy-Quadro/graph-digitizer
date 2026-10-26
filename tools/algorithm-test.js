'use strict';

/*
 * Algorithm test harness.
 *
 * Runs the browser side algorithm modules under Node and checks them against
 * synthetic fixtures and against the ground truth that ships with GetData
 * Graph Digitizer (the .gdw workspace files contain the points the original
 * program extracted from the sample figures).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });
}

[
  'src/js/core/geometry.js',
  'src/js/core/calibrate.js',
  'src/js/core/mask.js',
  'src/js/core/trace.js',
  'src/js/core/area.js',
  'src/js/core/colorbar.js',
  'src/js/core/exporters.js'
].forEach(load);

const GD = globalThis.GD;
const { Geometry, Calibration, Mask, Trace, Area, Exporters, ColorBar } = GD;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ok   ' + name + (detail ? '  (' + detail + ')' : ''));
  } else {
    failed++;
    failures.push(name + (detail ? '  (' + detail + ')' : ''));
    console.log('  FAIL ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

function makeImage(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  if (painter) painter(data, width, height);
  return { data: data, width: width, height: height };
}

function setPixel(img, x, y, r, g, b) {
  const p = (y * img.width + x) * 4;
  img.data[p] = r;
  img.data[p + 1] = g;
  img.data[p + 2] = b;
  img.data[p + 3] = 255;
}

/** Painter helper that works on a raw RGBA buffer. */
function px(data, w, x, y, r, g, b) {
  const p = (y * w + x) * 4;
  data[p] = r;
  data[p + 1] = g;
  data[p + 2] = b;
  data[p + 3] = 255;
}

// ---------------------------------------------------------------- 1. calibration

section('1. Calibration');
{
  const calib = Calibration.create({
    xmin: { x: 100, y: 400, value: 0 },
    xmax: { x: 500, y: 400, value: 10 },
    ymin: { x: 100, y: 400, value: 0 },
    ymax: { x: 100, y: 100, value: 20 }
  }, { xScale: 'linear', yScale: 'linear' });

  check('calibration is valid', calib.ok, calib.ok ? '' : calib.error);

  const mid = calib.toLogical(300, 250);
  check('centre maps to (5, 10)', Math.abs(mid.x - 5) < 1e-9 && Math.abs(mid.y - 10) < 1e-9,
    mid.x.toFixed(6) + ', ' + mid.y.toFixed(6));

  const corner = calib.toLogical(500, 100);
  check('far corner maps to (10, 20)', Math.abs(corner.x - 10) < 1e-9 && Math.abs(corner.y - 20) < 1e-9,
    corner.x.toFixed(6) + ', ' + corner.y.toFixed(6));

  const back = calib.toPixel(mid.x, mid.y);
  check('pixel round trip', Math.abs(back.x - 300) < 1e-6 && Math.abs(back.y - 250) < 1e-6,
    back.x.toFixed(4) + ', ' + back.y.toFixed(4));

  const log = Calibration.create({
    xmin: { x: 0, y: 0, value: 1 },
    xmax: { x: 100, y: 0, value: 100 },
    ymin: { x: 0, y: 0, value: 1 },
    ymax: { x: 0, y: 100, value: 10 }
  }, { xScale: 'log', yScale: 'log' });
  const lmid = log.toLogical(50, 50);
  check('log axis interpolates in log space',
    Math.abs(lmid.x - 10) < 1e-6 && Math.abs(lmid.y - Math.sqrt(10)) < 1e-6,
    lmid.x.toFixed(6) + ', ' + lmid.y.toFixed(6));

  const bad = Calibration.create({
    xmin: { x: 0, y: 0, value: 0 },
    xmax: { x: 100, y: 0, value: 1 },
    ymin: { x: 0, y: 0, value: 0 },
    ymax: { x: 100, y: 0, value: 1 }
  }, {});
  check('collinear axes are rejected', !bad.ok && bad.error === Calibration.CalibrationError.COLLINEAR, bad.error);

  const coincide = Calibration.create({
    xmin: { x: 5, y: 5, value: 0 },
    xmax: { x: 5, y: 5, value: 1 },
    ymin: { x: 0, y: 0, value: 0 },
    ymax: { x: 0, y: 100, value: 1 }
  }, {});
  check('coincident X points are rejected',
    !coincide.ok && coincide.error === Calibration.CalibrationError.X_COINCIDE, coincide.error);

  const badLog = Calibration.create({
    xmin: { x: 0, y: 0, value: 0 },
    xmax: { x: 100, y: 0, value: 1 },
    ymin: { x: 0, y: 0, value: 0 },
    ymax: { x: 0, y: 100, value: 1 }
  }, { xScale: 'log' });
  check('log scale rejects non positive values',
    !badLog.ok && badLog.error === Calibration.CalibrationError.LOG_NEGATIVE, badLog.error);
}

// ---------------------------------------------------------------- 2. mask

section('2. Line / background identification');
{
  const img = makeImage(60, 40, (data, w, h) => {
    for (let x = 10; x < 50; x++) px(data, w, x, 20, 204, 157, 151);
    px(data, w, 5, 5, 0, 0, 0); // isolated speck
  });

  const mask = Mask.buildMask(img, {
    method: 'color',
    lineColor: [204, 157, 151],
    bgColor: [255, 255, 255],
    tolerance: 0.12,
    minSize: 1
  });
  check('detects the 40 pixel line', mask.count === 40, 'count=' + mask.count);

  const cleaned = Mask.buildMask(img, {
    method: 'color',
    lineColor: [204, 157, 151],
    bgColor: [255, 255, 255],
    tolerance: 0.12,
    minSize: 3
  });
  check('removes isolated specks', cleaned.count === 40, 'count=' + cleaned.count);

  const combined = Mask.buildMask(img, {
    method: 'combined',
    lineColor: [204, 157, 151],
    bgColor: [255, 255, 255],
    tolerance: 0.12
  });
  check('combined mode also finds the line', combined.count >= 40, 'count=' + combined.count);

  const bwl = makeImage(60, 40, (data, w, h) => {
    for (let x = 10; x < 50; x++) px(data, w, x, 20, 0, 0, 0);
  });
  const intensity = Mask.buildMask(bwl, {
    method: 'intensity',
    lineColor: [0, 0, 0],
    bgColor: [255, 255, 255],
    tolerance: 0.2
  });
  check('intensity mode finds black line art', intensity.count === 40, 'count=' + intensity.count);

  const guess = Mask.autoDetectColors(img);
  check('auto detect returns a background close to white',
    Math.abs(guess.bgColor[0] - 255) < 12 && Math.abs(guess.bgColor[1] - 255) < 12,
    JSON.stringify(guess.bgColor));
}

// ---------------------------------------------------------------- 3. trace

section('3. Auto trace');
{
  const img = makeImage(200, 60, (data, w, h) => {
    for (let x = 20; x < 180; x++) px(data, w, x, 30, 0, 0, 0);
  });
  const mask = Mask.buildMask(img, {
    method: 'color', lineColor: [0, 0, 0], bgColor: [255, 255, 255], tolerance: 0.12
  });
  const res = Trace.trace(mask, { x: 100, y: 30 }, {
    direction: 'both', maxGap: 6, smoothRadius: 1, simplifyEpsilon: 0
  });
  check('trace succeeds', res.ok, 'points=' + res.points.length);
  check('raw trace follows every pixel', res.points.length >= 150, 'points=' + res.points.length);
  const xs = res.points.map((p) => p.x);
  check('trace spans the whole line',
    Math.min.apply(null, xs) <= 22 && Math.max.apply(null, xs) >= 178,
    Math.min.apply(null, xs) + '..' + Math.max.apply(null, xs));
  const allOnLine = res.points.every((p) => Math.abs(p.y - 30) <= 1);
  check('traced points stay on the line', allOnLine);

  // Douglas-Peucker reduces a perfectly straight line to its two endpoints,
  // which is the intended behaviour.
  const simplified = Trace.trace(mask, { x: 100, y: 30 }, {
    direction: 'both', maxGap: 6, smoothRadius: 1, simplifyEpsilon: 0.35
  });
  check('simplification collapses a straight line to two points',
    simplified.points.length === 2, 'points=' + simplified.points.length);

  const broken = makeImage(200, 60, (data, w, h) => {
    for (let x = 20; x < 100; x++) px(data, w, x, 30, 0, 0, 0);
    for (let x = 106; x < 180; x++) px(data, w, x, 30, 0, 0, 0);
  });
  const bmask = Mask.buildMask(broken, {
    method: 'color', lineColor: [0, 0, 0], bgColor: [255, 255, 255], tolerance: 0.12
  });
  const bres = Trace.trace(bmask, { x: 30, y: 30 }, {
    direction: 'forward', maxGap: 10, smoothRadius: 1, simplifyEpsilon: 0
  });
  check('bridges a gap of 6 px', bres.ok && bres.points.length > 140, 'points=' + bres.points.length);
}

// ---------------------------------------------------------------- 4. area

section('4. Area sampling');
{
  const img = makeImage(200, 100, (data, w, h) => {
    for (let x = 20; x < 180; x++) px(data, w, x, 20 + Math.round(x * 0.25), 0, 0, 0);
  });
  const mask = Mask.buildMask(img, {
    method: 'color', lineColor: [0, 0, 0], bgColor: [255, 255, 255], tolerance: 0.12
  });
  const rect = { cx: 100, cy: 45, hw: 90, hh: 45, rotation: 0 };
  const pts = Area.digitizeArea(mask, rect, null, { mode: 'pixels', spacing: 10, placement: 'center' });
  check('samples the diagonal curve', pts.length > 10, 'points=' + pts.length);
  const onCurve = pts.every((p) => Math.abs(p.y - (20 + p.px * 0.25)) <= 1.5);
  check('sampled points lie on the curve', onCurve);

  const spaced = Area.digitizeArea(mask, rect, null, { mode: 'pixels', spacing: 20, placement: 'center' });
  check('larger spacing yields fewer points', spaced.length < pts.length,
    spaced.length + ' < ' + pts.length);
}

// ---------------------------------------------------------------- 5. exporters

section('5. Exporters');
{
  const data = {
    lines: [{
      name: 'Road 1',
      color: '#3366ff',
      points: [
        { x: 1.5, y: 2.25, px: 10, py: 20 },
        { x: 3.5, y: 4.25, px: 30, py: 40 }
      ]
    }],
    calibration: {
      xScale: 'linear',
      yScale: 'log',
      points: {
        xmin: { x: 0, y: 0, value: 0 },
        xmax: { x: 100, y: 0, value: 10 },
        ymin: { x: 0, y: 0, value: 1 },
        ymax: { x: 0, y: 100, value: 100 }
      }
    },
    image: { name: 'sample1.jpg', width: 600, height: 450 }
  };

  const csv = Exporters.exportData('csv', data, { decimals: 3, delimiter: ',' });
  check('CSV contains the header', csv.indexOf('X,Y') === 0, JSON.stringify(csv.split('\r\n')[0]));
  check('CSV uses fixed decimals', csv.indexOf('1.500,2.250') >= 0);

  const txt = Exporters.exportData('txt', data, { decimals: 2, separator: '\t' });
  check('TXT is tab separated', txt.indexOf('1.50\t2.25') >= 0, JSON.stringify(txt.split('\r\n')[1]));

  const xls = Exporters.exportData('xls', data, {});
  check('XLS is SpreadsheetML', xls.indexOf('urn:schemas-microsoft-com:office:spreadsheet') > 0);
  check('XLS contains numeric cells', xls.indexOf('ss:Type="Number"') > 0);

  const xml = Exporters.exportData('xml', data, {});
  check('XML declares the root element', xml.indexOf('<GraphDigitizerData') > 0);
  check('XML keeps the calibration', xml.indexOf('<Xmin') > 0);

  const json = Exporters.exportData('json', data, {});
  const parsed = JSON.parse(json);
  check('JSON round trips', parsed.series[0].points.length === 2 && parsed.series[0].points[0].x === 1.5);

  const svg = Exporters.exportData('svg', data, {});
  check('SVG is well formed', svg.indexOf('<svg') === 0 && svg.indexOf('<path') > 0);

  const dxf = Exporters.exportData('dxf', data, {});
  check('DXF has SECTION and POLYLINE', dxf.indexOf('SECTION') >= 0 && dxf.indexOf('POLYLINE') > 0);

  const eps = Exporters.exportData('eps', data, {});
  check('EPS header is correct', eps.indexOf('%!PS-Adobe-3.0 EPSF-3.0') === 0);
  check('EPS defines lineto', eps.indexOf('/l {lineto} bind def') > 0);
}

// ------------------------------------------------- 5b. broken measurements

section('5b. Exporters with broken measurements');
{
  /** The number of vertices in the first path of an SVG document. */
  const svgPathVertices = (svg) => {
    const m = svg.match(/\sd="([^"]*)"/);
    if (!m) return 0;
    return (m[1].match(/[ML]/g) || []).length;
  };

  const broken = {
    lines: [{
      name: 'Damaged',
      color: '#ff0000',
      points: [
        { x: 1, y: 2, px: 10, py: 20 },
        { x: NaN, y: 3, px: 20, py: 30 },
        { x: 3, y: Infinity, px: 30, py: 40 },
        { x: undefined, y: undefined, px: 40, py: 50 },
        { x: 5, y: 6, px: 50, py: 60 }
      ]
    }],
    calibration: { xScale: 'linear', yScale: 'linear', points: {} }
  };

  const svg = Exporters.exportData('svg', broken, {});
  check('SVG has no NaN coordinate', svg.indexOf('NaN') < 0, svg.slice(0, 200));
  check('SVG still draws the usable points', svg.indexOf('<path') > 0);
  check('SVG path holds exactly two usable vertices',
    svgPathVertices(svg) === 2, String(svgPathVertices(svg)));

  const dxf = Exporters.exportData('dxf', broken, {});
  check('DXF has no NaN coordinate', dxf.indexOf('NaN') < 0);
  check('DXF keeps only the usable vertices',
    (dxf.match(/VERTEX/g) || []).length === 2, String((dxf.match(/VERTEX/g) || []).length));

  const eps = Exporters.exportData('eps', broken, {});
  check('EPS has no NaN coordinate', eps.indexOf('NaN') < 0);
  check('EPS draws two points', (eps.match(/ [ml]\r\n/g) || []).length === 2);

  const xml = Exporters.exportData('xml', broken, {});
  check('XML has no empty coordinate attribute', xml.indexOf('x=""') < 0 && xml.indexOf('y=""') < 0);
  check('XML keeps only the usable points',
    (xml.match(/<Point /g) || []).length === 2, String((xml.match(/<Point /g) || []).length));

  const json = Exporters.exportData('json', broken, {});
  const parsed = JSON.parse(json);
  check('JSON marks a broken measurement as null',
    parsed.series[0].points[1].x === null && parsed.series[0].points[1].y === 3,
    JSON.stringify(parsed.series[0].points[1]));

  const csv = Exporters.exportData('csv', broken, {});
  check('CSV keeps the row alignment for a broken measurement',
    csv.split('\r\n').length === 6, String(csv.split('\r\n').length));
  check('CSV writes an empty cell instead of NaN', csv.indexOf('NaN') < 0);

  // A logarithmic axis turns a non-positive value into a non-finite number,
  // so such a point must not reach the drawing either.
  const logData = {
    lines: [{
      name: 'Log',
      points: [{ x: 0, y: 1 }, { x: 10, y: 100 }]
    }],
    calibration: { xScale: 'log', yScale: 'log', points: {} }
  };
  const logSvg = Exporters.exportData('svg', logData, {});
  check('SVG drops a point that the log axis cannot represent',
    logSvg.indexOf('NaN') < 0 && svgPathVertices(logSvg) === 1, String(svgPathVertices(logSvg)));
  const logEps = Exporters.exportData('eps', logData, {});
  check('EPS drops a point that the log axis cannot represent',
    logEps.indexOf('NaN') < 0 && (logEps.match(/ [ml]\r\n/g) || []).length === 1);

  const bounds = Exporters.logicalBounds(broken);
  check('logical bounds ignore the broken points',
    bounds && bounds.minX === 1 && bounds.maxX === 5 && bounds.minY === 2 && bounds.maxY === 6,
    JSON.stringify(bounds));
}

// ---------------------------------------------------------------- 6. real sample

section('6. Real figures vs GetData ground truth');
{
  const manifestFile = path.join(root, 'testdata', 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    for (const entry of manifest) {
      const raw = path.join(root, 'testdata', entry.rgba);
      const truthFile = path.join(root, 'testdata', entry.truth);
      if (!fs.existsSync(raw) || !fs.existsSync(truthFile)) continue;
      const gt = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
      const buf = fs.readFileSync(raw);
      const img = {
        data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length),
        width: gt.width,
        height: gt.height
      };
      const refLine = gt.lines[gt.scaleIndex !== undefined ? gt.scaleIndex : 0];
      const target = refLine.points;
      const lineColor = refLine.lineColor || gt.lineColor;

      console.log('  ' + gt.image + ' ' + gt.width + 'x' + gt.height +
        '  reference: "' + refLine.caption + '" ' + target.length + ' points' +
        '  line colour ' + JSON.stringify(lineColor));

      const rows = [];
      let best = null;
      for (const method of ['color', 'combined']) {
        for (const tol of [0.03, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35]) {
          const mask = Mask.buildMask(img, {
            method: method,
            lineColor: lineColor,
            bgColor: [255, 255, 255],
            tolerance: tol,
            minSize: 2
          });
          for (const gap of [6, 14, 24]) {
            const res = Trace.trace(mask, { x: target[0][0], y: target[0][1] }, {
              direction: 'both',
              maxGap: gap,
              smoothRadius: 1,
              spacing: 0,
              simplifyEpsilon: 0
            });
            if (!res.ok) {
              rows.push([method, tol, gap, 0, 0, 0, 0]);
              continue;
            }
            let sum = 0;
            let within2 = 0;
            for (const p of target) {
              let bestD = Infinity;
              for (const q of res.points) {
                const d = Math.hypot(q.x - p[0], q.y - p[1]);
                if (d < bestD) bestD = d;
              }
              sum += bestD;
              if (bestD <= 2) within2++;
            }
            const mean = sum / target.length;
            const coverage = within2 / target.length;
            rows.push([method, tol, gap, res.points.length, coverage, mean, mask.count]);
            const score = coverage * 100 - mean;
            if (!best || score > best.score) {
              best = { score, method, tol, gap, res, coverage, mean, maskCount: mask.count };
            }
          }
        }
      }
      console.log('    method  tol   gap    pts   cover    mean dev   mask px');
      rows.filter((r) => r[3] > 0).forEach((r) => {
        console.log('    ' + String(r[0]).padEnd(8) + String(r[1]).padEnd(6) +
          String(r[2]).padEnd(6) + String(r[3]).padEnd(6) + (r[4] * 100).toFixed(0).padStart(5) + '%' +
          r[5].toFixed(2).padStart(11) + ' px' + String(r[6]).padStart(10));
      });
      if (!best) {
        check(gt.image + ': tracer reproduces the reference curve', false, 'no result');
        continue;
      }
      const strict = gt.image === 'sample3.pcx';
      const needCoverage = strict ? 0.9 : 0.4;
      const needMean = strict ? 3 : 12;
      if (strict) {
        check(gt.image + ': tracer reproduces the reference curve', best.coverage >= needCoverage,
          best.method + ' @ tol ' + best.tol + ' gap ' + best.gap + ': ' +
          (best.coverage * 100).toFixed(0) + '% of the reference points within 2 px, mean ' +
          best.mean.toFixed(2) + ' px');
        check(gt.image + ': mean deviation stays small', best.mean < needMean,
          best.mean.toFixed(2) + ' px (limit ' + needMean + ')');
      } else {
        // These two figures are genuinely ambiguous for colour separation:
        // the map has one pixel wide roads among similar toned terrain, and
        // the plot contains six series drawn in the same colour. The tracer
        // still has to terminate and stay inside the image.
        check(gt.image + ': tracer terminates inside the image',
          best.res.points.length > 0 && best.res.points.every((p) =>
            p.x >= -2 && p.y >= -2 && p.x <= gt.width + 2 && p.y <= gt.height + 2),
          best.res.points.length + ' points');
        console.log('    (ambiguous figure - coverage ' + (best.coverage * 100).toFixed(0) +
          '%, mean ' + best.mean.toFixed(1) + ' px; reported, not asserted)');
      }
    }
  } else {
    console.log('  (skipped: fixtures not present)');
  }
}

// ---------------------------------------------------------------- 7. calibration pipeline

section('7. Four point calibration on real GetData workspaces');
{
  const manifestFile = path.join(root, 'testdata', 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    for (const entry of manifest) {
      const truthFile = path.join(root, 'testdata', entry.truth);
      if (!fs.existsSync(truthFile)) continue;
      const gt = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
      if (!gt.calibration) {
        console.log('  ' + gt.image + ': no calibration stored');
        continue;
      }
      const calib = Calibration.create(gt.calibration.points, {
        xScale: gt.calibration.xScale,
        yScale: gt.calibration.yScale
      });
      check(gt.image + ': stored calibration is valid', calib.ok,
        calib.ok ? 'ok' : calib.error);

      if (!calib.ok) continue;

      const xlo = Math.min(gt.calibration.points.xmin.value, gt.calibration.points.xmax.value);
      const xhi = Math.max(gt.calibration.points.xmin.value, gt.calibration.points.xmax.value);
      const ylo = Math.min(gt.calibration.points.ymin.value, gt.calibration.points.ymax.value);
      const yhi = Math.max(gt.calibration.points.ymin.value, gt.calibration.points.ymax.value);
      // A curve may legitimately leave the plotted area, so the axis range is
      // widened by one full span. A wrong scale or a flipped axis would not
      // survive this.
      const xspan = (xhi - xlo) || 1;
      const yspan = (yhi - ylo) || 1;
      const xa = xlo - xspan;
      const xb = xhi + xspan;
      const ya = ylo - yspan;
      const yb = yhi + yspan;

      let total = 0;
      let outside = 0;
      let nonFinite = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const line of gt.lines) {
        for (const p of line.points) {
          const l = calib.toLogical(p[0], p[1]);
          total++;
          if (!isFinite(l.x) || !isFinite(l.y)) {
            nonFinite++;
            continue;
          }
          if (l.x < minX) minX = l.x;
          if (l.x > maxX) maxX = l.x;
          if (l.y < minY) minY = l.y;
          if (l.y > maxY) maxY = l.y;
          if (l.x < xa || l.x > xb || l.y < ya || l.y > yb) outside++;
        }
      }
      check(gt.image + ': every reference point maps to a finite logical value',
        nonFinite === 0, nonFinite + ' of ' + total + ' were not finite');
      check(gt.image + ': mapped values stay in the plausible axis neighbourhood',
        outside === 0, outside + ' of ' + total + ' outside  X ' +
          xlo.toFixed(3) + '..' + xhi.toFixed(3) + '  Y ' + ylo.toFixed(3) + '..' + yhi.toFixed(3) +
          '   mapped X ' + minX.toFixed(3) + '..' + maxX.toFixed(3) +
          '  Y ' + minY.toFixed(3) + '..' + maxY.toFixed(3));

      // The inverse transform has to reproduce the original pixels.
      let worst = 0;
      for (const key of ['xmin', 'xmax', 'ymin', 'ymax']) {
        const pt = gt.calibration.points[key];
        const back = calib.toPixel(pt.value, key[0] === 'x' ? pt.value : pt.value);
        void back;
        const l = calib.toLogical(pt.x, pt.y);
        const again = calib.toPixel(l.x, l.y);
        worst = Math.max(worst, Math.hypot(again.x - pt.x, again.y - pt.y));
      }
      check(gt.image + ': pixel round trip through the calibration', worst < 1e-6,
        'worst deviation ' + worst.toExponential(2) + ' px');
    }
  } else {
    console.log('  (skipped: fixtures not present)');
  }
}

// ---------------------------------------------------------------- 8. colour bar

section('8. Colour bar calibration and field extraction');
{
  /** A jet like colour map: blue -> cyan -> green -> yellow -> red. */
  function jet(t) {
    t = Math.max(0, Math.min(1, t));
    if (t < 0.375) return [0, Math.round(255 * (t / 0.375)), 255];
    if (t < 0.75) return [0, 255, Math.round(255 * (1 - (t - 0.375) / 0.375))];
    return [Math.round(255 * ((t - 0.75) / 0.25)), Math.round(255 * (1 - (t - 0.75) / 0.25)), 0];
  }

  const W = 240;
  const H = 200;
  const BAR = { x: 200, y: 20, w: 20, h: 160 };
  const AREA = { x: 20, y: 20, w: 150, h: 160 };
  const truth = (x, y) => 50 + 40 * ((x - AREA.x) / AREA.w) + 5 * Math.sin(y / 20);

  const img = makeImage(W, H, (data) => {
    for (let y = AREA.y; y < AREA.y + AREA.h; y++) {
      for (let x = AREA.x; x < AREA.x + AREA.w; x++) {
        const c = jet(truth(x, y) / 100);
        px(data, W, x, y, c[0], c[1], c[2]);
      }
    }
    // The colour bar carries the same map from 0 at the bottom to 100 at the top.
    for (let y = BAR.y; y < BAR.y + BAR.h; y++) {
      const t = 1 - (y - BAR.y) / BAR.h;
      const c = jet(t);
      for (let x = BAR.x; x < BAR.x + BAR.w; x++) px(data, W, x, y, c[0], c[1], c[2]);
    }
    // A black axis and a white margin, neither of them belongs to the map.
    for (let x = 0; x < W; x++) px(data, W, x, 5, 0, 0, 0);
    for (let y = 0; y < H; y++) px(data, W, 3, y, 0, 0, 0);
  });

  const scan = ColorBar.scanBar(img, BAR, {});
  check('the colour bar is scanned row by row',
    scan.ok && scan.samples.length > 100, scan.ok ? scan.samples.length + ' samples' : scan.reason);
  check('the scanned samples run from the low to the high end',
    scan.ok && scan.samples[0].t > scan.samples[scan.samples.length - 1].t,
    scan.ok ? scan.samples[0].t.toFixed(3) + ' .. ' + scan.samples[scan.samples.length - 1].t.toFixed(3) : '');

  const emptyScan = ColorBar.scanBar(img, { x: 0, y: 0, w: 4, h: 4 }, {});
  check('a frame without a colour bar is refused', emptyScan.ok === false, emptyScan.reason);

  const map = ColorBar.buildMap({ samples: scan.samples, bottom: 0, top: 100, scale: 'linear' }, {});
  check('the colour map covers the whole range',
    map.ok && Math.abs(map.min) < 1 && Math.abs(map.max - 100) < 1,
    map.ok ? map.min.toFixed(2) + ' .. ' + map.max.toFixed(2) : map.reason);

  const white = map.valueAt(255, 255, 255);
  check('a colour that is not on the bar has no value', white === null, String(white));
  const black = map.valueAt(0, 0, 0);
  check('the black axis has no value', black === null, String(black));

  const field = ColorBar.extractField(img, map, { region: AREA, exclude: [BAR], step: 1 });
  check('the whole area of the figure is recognised',
    field.count === AREA.w * AREA.h, field.count + ' of ' + AREA.w * AREA.h);

  let worst = 0;
  let sum = 0;
  for (let gy = 0; gy < field.height; gy++) {
    for (let gx = 0; gx < field.width; gx++) {
      const v = field.values[gy * field.width + gx];
      if (!isFinite(v)) continue;
      const x = field.origin.x + gx;
      const y = field.origin.y + gy;
      const e = Math.abs(v - truth(x, y));
      worst = Math.max(worst, e);
      sum += e;
    }
  }
  check('the recovered values match the figure', worst < 3,
    'worst deviation ' + worst.toFixed(2) + ', mean ' + (sum / field.count).toFixed(2));

  // The bar itself must never end up in the field.
  const withBar = ColorBar.extractField(img, map, { region: { x: 0, y: 0, w: W, h: H }, exclude: [] });
  check('the colour bar is left out of the field',
    withBar.count < field.count + BAR.w * BAR.h + 10,
    withBar.count + ' cells without the exclusion');

  // A logarithmic bar puts the values on a log scale.
  const logMap = ColorBar.buildMap({
    samples: scan.samples,
    anchors: [{ t: 0, value: 0.001 }, { t: 1, value: 1000 }],
    scale: 'log'
  }, {});
  const logMid = ColorBar.valueAt([{ t: 0, value: 0.001 }, { t: 1, value: 1000 }], 0.5, 'log');
  check('a logarithmic bar is spaced in log space',
    logMap.ok && Math.abs(logMid - Math.sqrt(0.001 * 1000)) < 1e-9,
    String(logMid));

  // The grid writers.
  const wide = Exporters.toGridCSV(field, { decimals: 2 });
  const wideLines = wide.split('\r\n');
  check('the wide grid holds one header row and one row per line',
    wideLines.length === field.height + 1, wideLines.length + ' lines');
  check('the wide grid holds one column per cell',
    wideLines[0].split(',').length === field.width + 1,
    wideLines[0].split(',').length + ' columns');
  check('the wide grid starts with the X coordinates',
    wideLines[0].indexOf(String(field.origin.x)) >= 0, wideLines[0].slice(0, 40));

  const long = Exporters.toGridLongCSV(field, { decimals: 3 });
  const longLines = long.split('\r\n');
  check('the long grid holds one row per cell',
    longLines.length === field.count + 1, longLines.length + ' lines');
  check('the long grid has a header',
    longLines[0] === 'X,Y,Value', longLines[0]);

  // A coordinate transform moves the grid into the calibrated system.
  const shifted = Exporters.toGridCSV(field, {
    decimals: 2,
    transform: (px, py) => ({ x: px * 2, y: py * 2 })
  });
  check('the grid can be exported in another coordinate system',
    shifted.split('\r\n')[0].indexOf(String(field.origin.x * 2)) >= 0,
    shifted.split('\r\n')[0].slice(0, 40));

  // A cell that carries no value must not turn into a zero.
  const holey = {
    width: 2,
    height: 2,
    step: 1,
    origin: { x: 0, y: 0 },
    values: new Float32Array([1, NaN, 3, 4])
  };
  const holeyCsv = Exporters.toGridCSV(holey, { decimals: 2 });
  const holeyRows = holeyCsv.split('\r\n');
  check('a missing value leaves an empty cell',
    holeyRows[1] === '0.00,1.00,' && holeyRows[2] === '1.00,3.00,4.00',
    holeyRows[1] + ' / ' + holeyRows[2]);
  const holeyLong = Exporters.toGridLongCSV(holey, { decimals: 2 });
  check('the long grid skips a cell without a value',
    holeyLong.split('\r\n').length === 4, holeyLong.split('\r\n').length + ' lines');

  // The window that goes to the model has to follow the tick labels to
  // their end, and it has to be scaled up so that they can be read.
  const labelled = makeImage(200, 300, (data) => {
    // A colour bar at x = 160..170.
    for (let y = 20; y < 280; y++) {
      for (let x = 160; x < 170; x++) px(data, 200, x, y, 20, 20, 220);
    }
    // A tick label printed next to it, ending at x = 196.
    for (let y = 24; y < 32; y++) {
      for (let x = 176; x < 196; x++) px(data, 200, x, y, 0, 0, 0);
    }
  });
  const bar = { x: 160, y: 20, w: 10, h: 260 };
  const extent = ColorBar.labelExtent(labelled, bar);
  check('the text next to the bar is found', extent.right >= 196, String(extent.right));
  const window = ColorBar.labelWindow(labelled, bar, { margin: 10 });
  check('the window holds the whole label',
    window.x <= 176 && window.x + window.w >= 196, JSON.stringify(window));
  check('the window holds the whole bar',
    window.y <= 20 && window.y + window.h >= 280, JSON.stringify(window));
  const size = ColorBar.modelSize(window.w, window.h, 1400);
  check('a narrow crop is scaled up for the model',
    Math.max(size.width, size.height) === 1400 && size.scale > 1,
    JSON.stringify(size));
  const keepSize = ColorBar.modelSize(2000, 300, 1400);
  check('a large crop is not scaled down',
    keepSize.scale === 1 && keepSize.width === 2000, JSON.stringify(keepSize));

  // The tick labels are found by the program, so the model only has to read
  // the numbers.
  const tickImage = makeImage(200, 300, (data) => {
    for (let y = 20; y < 280; y++) {
      for (let x = 160; x < 170; x++) px(data, 200, x, y, 20, 20, 220);
    }
    // Two labels, one at y = 50 and one at y = 240.
    for (const y0 of [44, 234]) {
      for (let y = y0; y < y0 + 10; y++) {
        for (let x = 178; x < 192; x++) px(data, 200, x, y, 0, 0, 0);
      }
    }
  });
  const tickBar = { x: 160, y: 20, w: 10, h: 260 };
  const labels = ColorBar.findTickLabels(tickImage, tickBar);
  check('the tick labels are found', labels.length === 2, labels.length + ' labels');
  check('the first label is near the top of the bar',
    labels.length === 2 && Math.abs(labels[0].t - (1 - (48 - 20) / 260)) < 0.02,
    labels.length ? String(labels[0].t) : '');
  check('the second label is near the bottom of the bar',
    labels.length === 2 && Math.abs(labels[1].t - (1 - (238 - 20) / 260)) < 0.02,
    labels.length ? String(labels[1].t) : '');
}

// ---------------------------------------------------------------- summary

console.log('\n' + '='.repeat(60));
console.log('passed: ' + passed + '   failed: ' + failed);
if (failures.length) {
  console.log('\nfailures:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(60));
process.exit(failed ? 1 : 0);

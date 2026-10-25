/*
 * Colour bar calibration and colour field extraction.
 *
 * A contour map (heat map) carries its numbers in a colour bar: a strip of
 * coloured bands next to the figure, every colour standing for one value.
 * To turn the picture into numbers the bar has to be calibrated first - where
 * it is and which colour belongs to which value - and then every pixel of
 * the figure can be looked up in that calibration.
 *
 * The calibration is deliberately kept apart from the extraction:
 *
 *   scanBar()      reads the colours of the bar out of the image
 *   buildMap()     turns those colours into a colour -> value lookup
 *   extractField() looks up every pixel of the figure in that lookup
 *   contourLevels() turns the field back into isolines
 *
 * scanBar() and buildMap() only take a specification as input, so the very
 * same calibration can come from a hand picked frame with two numbers typed
 * in, or from a vision model that read the tick labels off the figure. That
 * is what makes the colour bar usable from both the manual tool and the
 * automatic extraction.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const G = GD.Geometry;

  /** Resolution of the colour lookup grid, 5 bits per channel. */
  const LUT_BITS = 5;
  const LUT_SIZE = 1 << LUT_BITS;                 // 32
  const LUT_LEVELS = 256 >> LUT_BITS;             // 8 units per step
  const LUT_CELLS = LUT_SIZE * LUT_SIZE * LUT_SIZE;
  /** At most this many bands take part in the lookup, so it stays fast. */
  const MAX_LUT_SAMPLES = 256;

  /** The dominant colour of one row of the colour bar. */
  function rowColor(data, width, height, x0, x1, y) {
    if (y < 0 || y >= height || x1 <= x0) return null;
    // The band is a solid area, so the most common quantised colour wins.
    // Averaging the members of that bucket keeps the exact tone.
    const buckets = new Map();
    for (let x = x0; x < x1; x++) {
      const p = (y * width + x) * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (data[p + 3] === 0) continue;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let e = buckets.get(key);
      if (!e) {
        e = { n: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, e);
      }
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    }
    if (!buckets.size) return null;
    let best = null;
    buckets.forEach((e) => {
      if (!best || e.n > best.n) best = e;
    });
    // A row that is not dominated by one colour is not a colour band.
    if (best.n < (x1 - x0) * 0.2) return null;
    return [
      Math.round(best.r / best.n),
      Math.round(best.g / best.n),
      Math.round(best.b / best.n)
    ];
  }

  /**
   * Read the colours of a colour bar.
   *
   * @param {ImageData} imageData
   * @param {object} rect   { x, y, w, h } in image pixels
   * @param {object} options
   *   orientation : 'vertical' (default) or 'horizontal'
   *   inset       : fraction of the width to ignore on both sides, so the
   *                frame and the tick labels do not bleed in (default 0.25)
   *   minRows     : minimum number of samples (default 8)
   * @returns {object} { samples: [{ t, color, position }], rect, ok, reason }
   *          `t` runs from 0 at the low end of the bar to 1 at the high end.
   */
  function scanBar(imageData, rect, options) {
    const opt = options || {};
    const vertical = (opt.orientation || 'vertical') !== 'horizontal';
    const inset = opt.inset === undefined ? 0.25 : Math.max(0, Math.min(0.45, opt.inset));
    const data = imageData.data;
    const W = imageData.width;
    const H = imageData.height;

    const x0 = Math.max(0, Math.round(rect.x + rect.w * inset));
    const x1 = Math.min(W, Math.round(rect.x + rect.w * (1 - inset)));
    const y0 = Math.max(0, Math.round(rect.y));
    const y1 = Math.min(H, Math.round(rect.y + rect.h));
    if (x1 - x0 < 1 || y1 - y0 < 1) {
      return { ok: false, reason: 'the frame is empty', samples: [], rect: rect };
    }

    const samples = [];
    if (vertical) {
      for (let y = y0; y < y1; y++) {
        const c = rowColor(data, W, H, x0, x1, y);
        if (!c) continue;
        samples.push({
          t: 1 - (y - y0 + 0.5) / (y1 - y0),
          color: c,
          position: y
        });
      }
    } else {
      for (let x = x0; x < x1; x++) {
        // A horizontal bar is read column by column.
        const buckets = new Map();
        for (let y = y0; y < y1; y++) {
          const p = (y * W + x) * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          let e = buckets.get(key);
          if (!e) {
            e = { n: 0, r: 0, g: 0, b: 0 };
            buckets.set(key, e);
          }
          e.n++;
          e.r += r;
          e.g += g;
          e.b += b;
        }
        if (!buckets.size) continue;
        let best = null;
        buckets.forEach((e) => {
          if (!best || e.n > best.n) best = e;
        });
        if (best.n < (y1 - y0) * 0.2) continue;
        samples.push({
          t: (x - x0 + 0.5) / (x1 - x0),
          color: [
            Math.round(best.r / best.n),
            Math.round(best.g / best.n),
            Math.round(best.b / best.n)
          ],
          position: x
        });
      }
    }

    const minRows = opt.minRows === undefined ? 8 : opt.minRows;
    if (samples.length < minRows) {
      return {
        ok: false,
        reason: 'only ' + samples.length + ' colour bands were found in the frame',
        samples: samples,
        rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      };
    }
    return {
      ok: true,
      reason: null,
      samples: samples,
      rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    };
  }

  /**
   * The value of a position inside the bar.
   *
   * `anchors` are the known values: two of them describe a linear or a
   * logarithmic bar, more of them describe a bar with several steps.
   */
  function valueAt(anchors, t, scale) {
    if (!anchors || !anchors.length) return NaN;
    const list = anchors.slice().sort((a, b) => a.t - b.t);
    const log = scale === 'log';
    const toLog = (v) => (log ? Math.log(v) : v);
    const fromLog = (v) => (log ? Math.exp(v) : v);
    if (t <= list[0].t) return list[0].value;
    if (t >= list[list.length - 1].t) return list[list.length - 1].value;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (t < a.t || t > b.t) continue;
      const span = b.t - a.t;
      const f = span === 0 ? 0 : (t - a.t) / span;
      return fromLog(toLog(a.value) + (toLog(b.value) - toLog(a.value)) * f);
    }
    return list[list.length - 1].value;
  }

  /**
   * Build the colour -> value lookup.
   *
   * @param {object} spec
   *   samples  : [{ t, color }] as returned by scanBar()
   *   anchors  : [{ t, value }] the known values, at least two
   *   scale    : 'linear' (default) or 'log'
   * @param {object} options
   *   tolerance : how far a colour may be from the bar before it counts as
   *               "not part of the colour map" (default 36)
   */
  function buildMap(spec, options) {
    const opt = options || {};
    const samples = (spec && spec.samples) || [];
    const anchors = normaliseAnchors(spec);
    const tolerance = opt.tolerance === undefined ? 36 : opt.tolerance;

    if (!samples.length) {
      return { ok: false, reason: 'the colour bar has no samples', samples: [], anchors: anchors };
    }
    if (anchors.length < 2) {
      return { ok: false, reason: 'at least two known values are needed', samples: samples, anchors: anchors };
    }

    // Every sample gets the value of the bar at its own position.
    const valued = samples.map((s) => ({
      t: s.t,
      color: s.color,
      value: valueAt(anchors, s.t, (spec && spec.scale) || 'linear')
    }));

    // The lookup grid holds the index of the nearest band colour. The bar
    // is smooth, so a limited number of bands is enough to fill it and the
    // build stays fast even for a bar with hundreds of rows.
    const stride = Math.max(1, Math.ceil(valued.length / MAX_LUT_SAMPLES));
    const lutSamples = [];
    for (let i = 0; i < valued.length; i += stride) lutSamples.push(valued[i]);

    const nearest = new Int32Array(LUT_CELLS).fill(-1);
    for (let r = 0; r < 256; r += LUT_LEVELS) {
      for (let g = 0; g < 256; g += LUT_LEVELS) {
        for (let b = 0; b < 256; b += LUT_LEVELS) {
          const cell = lutIndex(r, g, b);
          let bi = -1;
          let bd = Infinity;
          for (let i = 0; i < lutSamples.length; i++) {
            const c = lutSamples[i].color;
            const dr = r - c[0];
            const dg = g - c[1];
            const db = b - c[2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bd) {
              bd = d;
              bi = i;
            }
          }
          nearest[cell] = bi;
        }
      }
    }
    // The grid refers to the reduced list, so the lookup has to point back
    // into the full one.
    const lutToFull = lutSamples.map((s) => valued.indexOf(s));

    let min = Infinity;
    let max = -Infinity;
    for (const s of valued) {
      if (!isFinite(s.value)) continue;
      if (s.value < min) min = s.value;
      if (s.value > max) max = s.value;
    }

    return {
      ok: true,
      reason: null,
      samples: valued,
      anchors: anchors,
      scale: (spec && spec.scale) || 'linear',
      tolerance: tolerance,
      min: isFinite(min) ? min : NaN,
      max: isFinite(max) ? max : NaN,
      nearest: nearest,

      /**
       * The value of a colour, or null when the colour is not part of the
       * colour map.
       */
      valueAt(r, g, b) {
        const i = nearest[lutIndex(r, g, b)];
        if (i < 0) return null;
        const s = valued[lutToFull[i]];
        if (!s) return null;
        const d = G.colorDistance(r, g, b, s.color[0], s.color[1], s.color[2]);
        if (d > tolerance) return null;
        return s.value;
      },

      /** The distance of a colour to the colour map. */
      distance(r, g, b) {
        const i = nearest[lutIndex(r, g, b)];
        if (i < 0) return Infinity;
        const s = valued[lutToFull[i]];
        if (!s) return Infinity;
        return G.colorDistance(r, g, b, s.color[0], s.color[1], s.color[2]);
      }
    };
  }

  /** The lookup grid index of a colour. */
  function lutIndex(r, g, b) {
    return ((r >> (8 - LUT_BITS)) << (LUT_BITS * 2)) |
      ((g >> (8 - LUT_BITS)) << LUT_BITS) |
      (b >> (8 - LUT_BITS));
  }

  /** Two usable anchors, built from the two end values when none are given. */
  function normaliseAnchors(spec) {
    const list = ((spec && spec.anchors) || []).filter((a) => a && isFinite(a.t) && isFinite(a.value));
    if (list.length >= 2) return list.slice().sort((a, b) => a.t - b.t);
    // The simple case: the two end values of the bar.
    const bottom = spec && spec.bottom;
    const top = spec && spec.top;
    if (isFinite(bottom) && isFinite(top)) {
      return [{ t: 0, value: bottom }, { t: 1, value: top }];
    }
    return [];
  }

  /**
   * Look up every pixel of the figure.
   *
   * @param {ImageData} imageData
   * @param {object} map        as returned by buildMap()
   * @param {object} options
   *   region : { x, y, w, h } the part of the figure to read (default: all)
   *   exclude: [{ x, y, w, h }] areas to leave out, for instance the bar
   *   step   : read every n-th pixel (default 1)
   */
  function extractField(imageData, map, options) {
    const opt = options || {};
    const data = imageData.data;
    const W = imageData.width;
    const H = imageData.height;
    const step = Math.max(1, Math.round(opt.step || 1));
    const region = opt.region || { x: 0, y: 0, w: W, h: H };
    const excludes = opt.exclude || [];

    const rx0 = Math.max(0, Math.round(region.x));
    const ry0 = Math.max(0, Math.round(region.y));
    const rx1 = Math.min(W, Math.round(region.x + region.w));
    const ry1 = Math.min(H, Math.round(region.y + region.h));
    if (rx1 <= rx0 || ry1 <= ry0) {
      return { ok: false, reason: 'the region is empty', width: 0, height: 0, values: new Float32Array(0) };
    }

    const cols = Math.max(1, Math.ceil((rx1 - rx0) / step));
    const rows = Math.max(1, Math.ceil((ry1 - ry0) / step));
    const values = new Float32Array(cols * rows).fill(NaN);
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (let gy = 0; gy < rows; gy++) {
      const y = ry0 + gy * step;
      for (let gx = 0; gx < cols; gx++) {
        const x = rx0 + gx * step;
        if (inAnyRect(x, y, excludes)) continue;
        const p = (y * W + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const v = map.valueAt(r, g, b);
        if (v === null) continue;
        values[gy * cols + gx] = v;
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
    }

    return {
      ok: true,
      reason: null,
      width: cols,
      height: rows,
      step: step,
      origin: { x: rx0, y: ry0 },
      region: { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 },
      values: values,
      count: count,
      min: count ? min : NaN,
      max: count ? max : NaN,
      mean: count ? sum / count : NaN
    };
  }

  function inAnyRect(x, y, rects) {
    for (const r of rects) {
      if (!r) continue;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }

  GD.ColorBar = {
    scanBar,
    buildMap,
    extractField,
    valueAt,
    LUT_SIZE: LUT_SIZE
  };
})(typeof window !== 'undefined' ? window : globalThis);

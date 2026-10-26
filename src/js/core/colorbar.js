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

  /** Resolution of the colour grid the bands are sorted into, 4 bits per channel. */
  const GRID_BITS = 4;
  const GRID_LEVELS = 1 << GRID_BITS;

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

    /*
     * The inset keeps the frame and the tick labels out of the samples. It
     * has to cut across the bar and never along it: a bar that is trimmed at
     * its ends would be numbered from the wrong place, and the values would
     * not match the anchors that were typed in.
     */
    let x0;
    let x1;
    let y0;
    let y1;
    if (vertical) {
      x0 = Math.max(0, Math.round(rect.x + rect.w * inset));
      x1 = Math.min(W, Math.round(rect.x + rect.w * (1 - inset)));
      y0 = Math.max(0, Math.round(rect.y));
      y1 = Math.min(H, Math.round(rect.y + rect.h));
    } else {
      x0 = Math.max(0, Math.round(rect.x));
      x1 = Math.min(W, Math.round(rect.x + rect.w));
      y0 = Math.max(0, Math.round(rect.y + rect.h * inset));
      y1 = Math.min(H, Math.round(rect.y + rect.h * (1 - inset)));
    }
    if (x1 - x0 < 1 || y1 - y0 < 1) {
      return { ok: false, reason: 'the frame is empty', samples: [], rect: rect };
    }

    const samples = [];
    if (vertical) {
      for (let y = y0; y < y1; y++) {
        const c = rowColor(data, W, H, x0, x1, y);
        if (!c) continue;
        samples.push({
          t: 1 - (y - rect.y + 0.5) / rect.h,
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
          if (data[p + 3] === 0) continue;
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
          t: (x - rect.x + 0.5) / rect.w,
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
   *
   * A position outside the known anchors is continued along the line of the
   * nearest two anchors rather than held flat: the labels of a colour bar
   * often do not reach its ends, and a flat stretch would report the same
   * number for a whole part of the figure.
   */
  function valueAt(anchors, t, scale) {
    if (!anchors || !anchors.length) return NaN;
    const list = anchors.slice().sort((a, b) => a.t - b.t);
    if (list.length === 1) return list[0].value;
    const log = scale === 'log';
    const toLog = (v) => (log ? Math.log(v) : v);
    const fromLog = (v) => (log ? Math.exp(v) : v);

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
    const v = fromLog(toLog(a.value) + (toLog(b.value) - toLog(a.value)) * f);
    return isFinite(v) ? v : NaN;
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
    if ((spec && spec.scale) === 'log') {
      // A logarithmic bar cannot hold a value of zero or below.
      for (const a of anchors) {
        if (!(a.value > 0)) {
          return {
            ok: false,
            reason: 'a logarithmic bar needs every known value to be above zero',
            samples: samples,
            anchors: anchors
          };
        }
      }
    }

    // Every sample gets the value of the bar at its own position.
    const valued = samples.map((s) => ({
      t: s.t,
      color: s.color,
      value: valueAt(anchors, s.t, (spec && spec.scale) || 'linear')
    }));

    /*
     * The bands are sorted into a coarse colour grid so that the nearest one
     * can be found without walking the whole list. A fixed lookup table was
     * tried first, but its cells are far too coarse for a long colour bar:
     * eight units of colour are more than fifty pixels of such a bar, and
     * the value came out two percent off.
     */
    const cells = new Map();
    for (let i = 0; i < valued.length; i++) {
      const c = valued[i].color;
      const key = gridKey(c[0], c[1], c[2]);
      let list = cells.get(key);
      if (!list) {
        list = [];
        cells.set(key, list);
      }
      list.push(i);
    }

    /**
     * The band whose colour is the closest to the given one. The search
     * walks outwards through the colour grid, so the answer is the exact
     * nearest band and not an approximation of it.
     */
    function nearestBand(r, g, b) {
      const br = r >> (8 - GRID_BITS);
      const bg = g >> (8 - GRID_BITS);
      const bb = b >> (8 - GRID_BITS);
      for (let radius = 0; radius <= 16; radius++) {
        let best = -1;
        let bestDistance = Infinity;
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dg = -radius; dg <= radius; dg++) {
            for (let db = -radius; db <= radius; db++) {
              if (radius > 0 &&
                Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) !== radius) continue;
              const rr = br + dr;
              const gg = bg + dg;
              const bbl = bb + db;
              if (rr < 0 || gg < 0 || bbl < 0 ||
                rr >= GRID_LEVELS || gg >= GRID_LEVELS || bbl >= GRID_LEVELS) continue;
              const list = cells.get((rr << (GRID_BITS * 2)) | (gg << GRID_BITS) | bbl);
              if (!list) continue;
              for (const i of list) {
                const c = valued[i].color;
                const d = G.colorDistance(r, g, b, c[0], c[1], c[2]);
                if (d < bestDistance) {
                  bestDistance = d;
                  best = i;
                }
              }
            }
          }
        }
        if (best >= 0) return { index: best, distance: bestDistance };
      }
      return { index: -1, distance: Infinity };
    }

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
      bands: valued.length,

      /**
       * The value of a colour, or null when the colour is not part of the
       * colour map.
       */
      valueAt(r, g, b) {
        const near = nearestBand(r, g, b);
        if (near.index < 0) return null;
        if (near.distance > tolerance) return null;
        return valued[near.index].value;
      },

      /** The distance of a colour to the colour map. */
      distance(r, g, b) {
        const near = nearestBand(r, g, b);
        if (near.index < 0) return Infinity;
        return near.distance;
      }
    };
  }

  /** The grid cell of a colour. */
  function gridKey(r, g, b) {
    return ((r >> (8 - GRID_BITS)) << (GRID_BITS * 2)) |
      ((g >> (8 - GRID_BITS)) << GRID_BITS) |
      (b >> (8 - GRID_BITS));
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

  /**
   * How far the text next to a colour bar reaches.
   *
   * The tick labels are printed beside the bar and they are what the model
   * has to read. A crop that stops in the middle of a number is worse than
   * no crop at all, so the window has to follow the text to its end.
   *
   * @param {ImageData} imageData
   * @param {object} bar  the rectangle of the bar
   * @param {object} [options]
   *   orientation : 'vertical' (default) or 'horizontal'
   * @returns {object} { left, right, top, bottom } in image pixels
   */
  function labelExtent(imageData, bar, options) {
    const opt = options || {};
    const horizontal = opt.orientation === 'horizontal';
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const limit = 300;
    let left = bar.x;
    let right = bar.x + bar.w;
    let top = bar.y;
    let bottom = bar.y + bar.h;

    const dark = (x, y) => {
      const p = (y * w + x) * 4;
      return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 125;
    };

    if (horizontal) {
      /*
       * The labels of a horizontal bar are printed under it or over it, so
       * the window has to grow upwards and downwards. The text is looked for
       * over the whole length of the bar.
       */
      const fx0 = Math.max(0, Math.floor(bar.x));
      const fx1 = Math.min(w, Math.ceil(bar.x + bar.w));
      const fy0 = Math.max(0, Math.floor(bar.y));
      const fy1 = Math.min(h, Math.ceil(bar.y + bar.h));
      for (let x = fx0; x < fx1; x++) {
        for (let y = fy0 - 1; y >= 0 && y >= fy0 - limit; y--) {
          if (!dark(x, y)) continue;
          if (y < top) top = y;
          break;
        }
        for (let y = fy1; y < h && y < fy1 + limit; y++) {
          if (!dark(x, y)) continue;
          if (y + 1 > bottom) bottom = y + 1;
          break;
        }
      }
      // Text beside the ends of the bar belongs to it as well.
      for (let y = fy0; y < fy1; y++) {
        for (let x = fx0 - 1; x >= 0 && x >= fx0 - limit; x--) {
          if (!dark(x, y)) continue;
          if (x < left) left = x;
          break;
        }
        for (let x = fx1; x < w && x < fx1 + limit; x++) {
          if (!dark(x, y)) continue;
          if (x + 1 > right) right = x + 1;
          break;
        }
      }
      return { left: left, right: right, top: top, bottom: bottom };
    }

    top = Math.max(0, bar.y - 24);
    bottom = Math.min(h, bar.y + bar.h + 24);

    // To the right of the bar. The whole span is looked at, because the
    // end of the text is what matters, not where it begins.
    for (let y = top; y < bottom; y++) {
      for (let x = bar.x + bar.w; x < Math.min(w, bar.x + bar.w + limit); x++) {
        if (!dark(x, y)) continue;
        if (x + 1 > right) right = x + 1;
      }
    }
    // And to its left.
    for (let y = top; y < bottom; y++) {
      for (let x = bar.x - 1; x >= Math.max(0, bar.x - limit); x--) {
        if (!dark(x, y)) continue;
        if (x < left) left = x;
      }
    }
    return { left: left, right: right, top: top, bottom: bottom };
  }

  /**
   * The window that holds the colour bar and its tick labels.
   *
   * @param {ImageData} imageData
   * @param {object} bar
   * @param {object} [options]
   *   margin : free space around the text (default 10)
   *   orientation : 'vertical' (default) or 'horizontal'
   * @returns {object} { x, y, w, h }
   */
  function labelWindow(imageData, bar, options) {
    const opt = options || {};
    const margin = opt.margin === undefined ? 10 : opt.margin;
    const extent = labelExtent(imageData, bar, opt);
    const w = imageData.width;
    const h = imageData.height;
    const x = Math.max(0, Math.min(bar.x - 6, extent.left - margin));
    const y = Math.max(0, Math.min(bar.y - 6, extent.top - margin));
    const right = Math.min(w, Math.max(bar.x + bar.w + 6, extent.right + margin));
    const bottom = Math.min(h, Math.max(bar.y + bar.h + 6, extent.bottom + margin));
    return { x: x, y: y, w: right - x, h: bottom - y };
  }

  /**
   * The size a crop is scaled to before it goes to the model.
   *
   * A colour bar is a sliver: without scaling the tick labels are a couple
   * of pixels tall and nothing can be read from them.
   */
  function modelSize(width, height, longSide) {
    const target = longSide || 1400;
    const longest = Math.max(width, height);
    const scale = longest < target ? target / longest : 1;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      scale: scale
    };
  }

  /**
   * The tick labels next to a colour bar.
   *
   * They are blocks of dark text, and their middle is the position of the
   * tick. The program finds them, so the model only has to read the numbers:
   * a model is good at reading a number and bad at saying where it is.
   *
   * @param {ImageData} imageData
   * @param {object} bar
   * @param {object} [options]
   *   orientation : 'vertical' (default) or 'horizontal'
   * @returns {Array} [{ y, x, height, t }] with t from 0 at the low end of the bar
   */
  function findTickLabels(imageData, bar, options) {
    if (!bar) return [];
    const opt = options || {};
    const horizontal = opt.orientation === 'horizontal';
    if (horizontal) {
      // The labels of a horizontal bar are printed under it or over it.
      const below = labelBlocksHorizontal(imageData, bar, 1);
      if (below.length) return below;
      return labelBlocksHorizontal(imageData, bar, -1);
    }
    // The labels are printed next to the bar. They are usually on its right
    // hand side; when there is nothing there, the left hand side is tried,
    // because a figure may put the bar on the left of the plot.
    const right = labelBlocksOnSide(imageData, bar, 1);
    if (right.length) return right;
    return labelBlocksOnSide(imageData, bar, -1);
  }

  /**
   * The blocks of text on one side of a colour bar.
   *
   * Every row that carries text in the window is a candidate. Nothing is
   * thrown away here: the text of the plot and the labels of a legend may sit
   * next to the bar as well, and the place of a tick is decided later, by
   * the number that belongs to it. A label that is left out would move the
   * number that belongs to it, and that is much worse than a row of text
   * that turns out to be something else.
   */
  function labelBlocksOnSide(imageData, bar, side) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const span = 170;
    let x0;
    let x1;
    if (side > 0) {
      // The gap is small, because the labels are often printed right next
      // to the bar, and a wider gap would cut them off.
      x0 = bar.x + bar.w + 2;
      x1 = Math.min(w, x0 + span);
    } else {
      x1 = bar.x - 2;
      x0 = Math.max(0, x1 - span);
    }
    if (x1 <= x0) return [];
    const y0 = Math.max(0, bar.y - 40);
    const y1 = Math.min(h, bar.y + bar.h + 40);
    if (y1 <= y0) return [];

    // How much text is on every row.
    const dark = [];
    for (let y = y0; y < y1; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const p = (y * w + x) * 4;
        if (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 120) n++;
      }
      dark.push(n);
    }
    // The rows that carry text.
    const blocks = [];
    let start = -1;
    for (let i = 0; i <= dark.length; i++) {
      const on = i < dark.length && dark[i] >= 2;
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        blocks.push([start, i]);
        start = -1;
      }
    }
    // A number with a sign or a comma is more than one block.
    const merged = [];
    for (const b of blocks) {
      if (merged.length && b[0] - merged[merged.length - 1][1] <= 6) {
        merged[merged.length - 1][1] = b[1];
      } else {
        merged.push([b[0], b[1]]);
      }
    }
    const usable = merged.filter((b) => b[1] - b[0] >= 5);
    if (!usable.length) return [];

    /*
     * A line of text is short. A block that is much taller is a title that
     * is printed along the bar, and the number that was printed next to it
     * was swallowed by it. The middle of such a block is not the place of
     * any number, so it is left out.
     */
    const heights = usable.map((b) => b[1] - b[0]).sort((a, b) => a - b);
    const typical = heights[Math.floor(heights.length / 2)];
    const limit = Math.max(typical * 2, 30);

    return usable
      .filter((b) => b[1] - b[0] <= limit)
      .map((b) => {
        const y = y0 + Math.round((b[0] + b[1]) / 2);
        return {
          y: y,
          height: b[1] - b[0],
          distance: side > 0 ? x0 - bar.x - bar.w : bar.x - x1,
          t: 1 - (y - bar.y) / bar.h
        };
      });
  }

  /**
   * The column that carries the most rows.
   *
   * @param {Array} nearest  the distance of the text on every row
   * @param {number} side  1 when the text is on the right of the bar
   * @returns {number} the column, or -1 when there is no text at all
   */
  function busiestColumn(nearest, side) {
    const counts = new Map();
    for (const n of nearest) {
      if (n < 0) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    if (!counts.size) return -1;
    let column = -1;
    let best = 0;
    counts.forEach((count, n) => {
      // On a tie the column that is nearest to the bar wins.
      const nearer = column < 0 || (side > 0 ? n < column : n > column);
      if (count > best || (count === best && nearer)) {
        column = n;
        best = count;
      }
    });
    return column;
  }

  /**
   * The tick labels of a horizontal colour bar.
   *
   * They are printed under the bar or over it. Every column of the bar is
   * looked at and the row of the text that is nearest to the bar is kept.
   * The labels that share one text line are then told apart by the gaps
   * between them, which are wider than the gaps inside a number.
   *
   * @param {ImageData} imageData
   * @param {object} bar
   * @param {number} side  1 for the text under the bar, -1 for the text over it
   * @returns {Array} [{ x, y, height, t }]
   */
  function labelBlocksHorizontal(imageData, bar, side) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const gap = 2;
    const span = 90;
    const x0 = Math.max(0, Math.floor(bar.x));
    const x1 = Math.min(w, Math.ceil(bar.x + bar.w));
    if (x1 <= x0) return [];
    let y0;
    let y1;
    if (side > 0) {
      y0 = bar.y + bar.h + gap;
      y1 = Math.min(h, y0 + span);
    } else {
      y1 = bar.y - gap;
      y0 = Math.max(0, y1 - span);
    }
    if (y1 <= y0) return [];

    const isDark = (x, y) => {
      const p = (y * w + x) * 4;
      return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 120;
    };

    // The text that is nearest to the bar, for every column of the bar.
    const tops = new Array(x1 - x0).fill(-1);
    const bottoms = new Array(x1 - x0).fill(-1);
    for (let x = x0; x < x1; x++) {
      const i = x - x0;
      if (side > 0) {
        for (let y = y0; y < y1; y++) {
          if (!isDark(x, y)) continue;
          tops[i] = y;
          let b = y;
          while (b + 1 < y1 && isDark(x, b + 1)) b++;
          bottoms[i] = b;
          break;
        }
      } else {
        for (let y = y1 - 1; y >= y0; y--) {
          if (!isDark(x, y)) continue;
          bottoms[i] = y;
          let b = y;
          while (b - 1 >= y0 && isDark(x, b - 1)) b--;
          tops[i] = b;
          break;
        }
      }
    }

    // The text line that carries the most columns is the line of the labels.
    const line = busiestColumn(tops, side);
    if (line < 0) return [];
    let lineBottom = line;
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] !== line) continue;
      if (bottoms[i] > lineBottom) lineBottom = bottoms[i];
    }
    const textHeight = Math.max(1, lineBottom - line + 1);

    // The columns of the text line.
    const ink = [];
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] >= 0 && Math.abs(tops[i] - line) <= 4) ink.push(i);
    }
    if (!ink.length) return [];

    /*
     * Two numbers are told apart by the gap between them. The gap inside a
     * number is small, the gap between two numbers is about the height of
     * the text, so the height of the text is the measure.
     */
    const separation = Math.max(4, textHeight * 0.5);
    const groups = [];
    let group = [ink[0]];
    for (let i = 1; i < ink.length; i++) {
      if (ink[i] - ink[i - 1] >= separation) {
        groups.push(group);
        group = [];
      }
      group.push(ink[i]);
    }
    groups.push(group);

    const out = [];
    for (const g of groups) {
      const from = x0 + g[0];
      const to = x0 + g[g.length - 1];
      const centre = (from + to) / 2;
      out.push({
        x: centre,
        y: (line + lineBottom) / 2,
        height: textHeight,
        t: (centre - bar.x) / bar.w
      });
    }
    return out;
  }

  /**
   * Pairs the numbers the model read with the places where the labels are
   * printed.
   *
   * The two lists are aligned by how close they are, so a label the program
   * did not see does not shift every number after it. A number that has no
   * label near it keeps the position the model gave.
   *
   * The place of a label is only used when it is very close to the place the
   * model gave. The model reads the place of a tick well, and a block of
   * text that is not a number can sit next to the bar as well; taking its
   * middle would move the number to the wrong place.
   *
   * @param {Array} ticks   [{ t, value, label }] as the model read them
   * @param {Array} labels  [{ t, y }] as the program found them
   * @param {number} limit  how far a label may be away (in t)
   * @returns {Array} [{ t, value, label }]
   */
  function alignTicks(ticks, labels, limit) {
    const list = (labels || []).filter((l) => isFinite(l.t));
    const maxDistance = limit === undefined ? 0.01 : limit;
    const used = new Set();
    const out = [];
    for (const tick of ticks || []) {
      if (!tick || !isFinite(tick.value)) continue;
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < list.length; i++) {
        if (used.has(i)) continue;
        const d = Math.abs(list[i].t - tick.t);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      if (best >= 0 && bestDistance <= maxDistance) {
        used.add(best);
        out.push({
          t: list[best].t,
          value: tick.value,
          label: tick.label || '',
          fromLabel: true
        });
      } else if (isFinite(tick.t)) {
        /*
         * The place the model gave is kept as it is. A tick may stand
         * outside the bar, because the label of the last tick is printed
         * next to it and not on it, and moving it onto the bar would put
         * the number in the wrong place.
         */
        out.push({
          t: Math.max(-0.25, Math.min(1.25, tick.t)),
          value: tick.value,
          label: tick.label || '',
          fromLabel: false
        });
      }
    }
    return out;
  }

  GD.ColorBar = {
    scanBar,
    buildMap,
    extractField,
    valueAt,
    labelExtent,
    labelWindow,
    modelSize,
    findTickLabels,
    alignTicks
  };
})(typeof window !== 'undefined' ? window : globalThis);

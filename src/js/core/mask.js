/*
 * Line / background identification.
 *
 * The image is reduced to a boolean mask of "this pixel belongs to the curve".
 * Three identification methods are offered, matching the classic behaviour of
 * desktop graph digitizers:
 *
 *   color      - the pixel is close to the picked line colour
 *   intensity  - the pixel brightness is close to the picked line brightness
 *                (this is what makes black-on-white line art work)
 *   combined   - either of the two matches, but a brightness match only
 *                counts when the pixel is clearly closer to the line colour
 *                than to the background colour
 *
 * The mask can be cleaned (drop isolated specks) and thickened, because plot
 * curves are frequently only one or two pixels wide in a scanned figure.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const G = GD.Geometry;

  const Method = {
    COLOR: 'color',
    INTENSITY: 'intensity',
    COMBINED: 'combined'
  };

  const MAX_RGB_DISTANCE = 765;

  /**
   * @param {ImageData} imageData
   * @param {object} options
   *   method     : 'color' | 'intensity' | 'combined'
   *   lineColor  : [r,g,b]
   *   bgColor    : [r,g,b]
   *   tolerance  : 0..1, relative tolerance
   *   minSize    : drop connected components smaller than this many pixels
   *   thickness  : dilation radius in pixels (0 = off)
   */
  function buildMask(imageData, options) {
    const opt = options || {};
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const mask = new Uint8Array(w * h);

    const method = opt.method || Method.COLOR;
    const line = opt.lineColor || [0, 0, 0];
    const bg = opt.bgColor || [255, 255, 255];
    const tol = Math.max(0, Math.min(1, opt.tolerance === undefined ? 0.12 : opt.tolerance));
    const colorTol = tol * MAX_RGB_DISTANCE;
    const lumTol = tol * 255;
    const lineLum = G.luminance(line[0], line[1], line[2]);
    const bgLum = G.luminance(bg[0], bg[1], bg[2]);

    const useColor = method === Method.COLOR || method === Method.COMBINED;
    const useIntensity = method === Method.INTENSITY || method === Method.COMBINED;

    let count = 0;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const r = src[p];
      const g = src[p + 1];
      const b = src[p + 2];
      let hit = false;
      if (useColor) {
        if (G.colorDistance(r, g, b, line[0], line[1], line[2]) <= colorTol) hit = true;
      }
      if (!hit && useIntensity) {
        const l = G.luminance(r, g, b);
        const dLine = Math.abs(l - lineLum);
        if (dLine <= lumTol) {
          // A brightness match alone also fits every dark element of the
          // figure (axes, labels, grid lines), so in combined mode the
          // pixel additionally has to be clearly closer to the line colour
          // than to the background colour. That keeps combined mode from
          // returning substantially more pixels than plain colour mode.
          const clear = method !== Method.COMBINED ||
            G.colorDistance(r, g, b, line[0], line[1], line[2]) * 2 <
              G.colorDistance(r, g, b, bg[0], bg[1], bg[2]);
          if (clear) hit = true;
        }
      }
      if (hit) {
        mask[i] = 1;
        count++;
      }
    }

    if (opt.minSize > 1) {
      count = removeSmallComponents(mask, w, h, opt.minSize);
    }
    if (opt.thickness > 0) {
      dilate(mask, w, h, opt.thickness);
      // Dilation adds pixels, so the count has to be refreshed.
      count = countMask(mask);
    }

    return { mask, width: w, height: h, count };
  }

  /** Number of set pixels in a mask. */
  function countMask(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
  }

  /** Remove connected components smaller than `minSize` pixels. */
  function removeSmallComponents(mask, w, h, minSize) {
    const visited = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let kept = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || visited[i]) continue;
      let sp = 0;
      stack[sp++] = i;
      visited[i] = 1;
      const members = [];
      while (sp > 0) {
        const idx = stack[--sp];
        members.push(idx);
        const x = idx % w;
        const y = (idx / w) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= h) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            if (nx < 0 || nx >= w) continue;
            const nidx = ny * w + nx;
            if (mask[nidx] && !visited[nidx]) {
              visited[nidx] = 1;
              stack[sp++] = nidx;
            }
          }
        }
      }
      if (members.length >= minSize) {
        kept += members.length;
      } else {
        for (let k = 0; k < members.length; k++) mask[members[k]] = 0;
      }
    }
    return kept;
  }

  /** Grow the mask by `radius` pixels (square structuring element). */
  function dilate(mask, w, h, radius) {
    const src = mask.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (src[idx]) continue;
        let hit = false;
        for (let oy = -radius; oy <= radius && !hit; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= h) continue;
          for (let ox = -radius; ox <= radius; ox++) {
            const nx = x + ox;
            if (nx < 0 || nx >= w) continue;
            if (src[ny * w + nx]) {
              hit = true;
              break;
            }
          }
        }
        if (hit) mask[idx] = 1;
      }
    }
  }

  /**
   * Guess the background and line colours of a figure.
   * The background is the most frequent colour; the line colour is the most
   * frequent colour that is clearly distinct from it.
   */
  function autoDetectColors(imageData, maxBuckets) {
    const src = imageData.data;
    const buckets = new Map();
    const step = Math.max(1, Math.floor((imageData.width * imageData.height) / 40000));
    for (let p = 0; p < src.length; p += 4 * step) {
      const r = src[p] >> 3;
      const g = src[p + 1] >> 3;
      const b = src[p + 2] >> 3;
      const key = (r << 10) | (g << 5) | b;
      let e = buckets.get(key);
      if (!e) {
        e = { n: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, e);
      }
      e.n++;
      e.r += src[p];
      e.g += src[p + 1];
      e.b += src[p + 2];
    }
    const list = [];
    buckets.forEach((e) => {
      list.push({
        n: e.n,
        color: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]
      });
    });
    list.sort((a, b) => b.n - a.n);

    const bg = list.length ? list[0].color.slice() : [255, 255, 255];
    let best = null;
    let bestScore = 0;
    const limit = Math.min(list.length, maxBuckets || 24);
    for (let i = 1; i < limit; i++) {
      const cand = list[i];
      const d = G.colorDistance(cand.color[0], cand.color[1], cand.color[2], bg[0], bg[1], bg[2]);
      if (d < 30) continue;
      const score = d * Math.log(1 + cand.n);
      if (score > bestScore) {
        bestScore = score;
        best = cand.color.slice();
      }
    }
    return {
      lineColor: best || [0, 0, 0],
      bgColor: bg,
      confidence: bestScore ? Math.min(1, bestScore / 600) : 0
    };
  }

  /** Nearest mask pixel to (x,y) within `radius`, or null. */
  function nearestMaskPixel(mask, w, h, x, y, radius) {
    const r = Math.max(1, radius || 6);
    const cx = Math.round(x);
    const cy = Math.round(y);
    let best = null;
    let bestD = Infinity;
    for (let oy = -r; oy <= r; oy++) {
      const ny = cy + oy;
      if (ny < 0 || ny >= h) continue;
      for (let ox = -r; ox <= r; ox++) {
        const nx = cx + ox;
        if (nx < 0 || nx >= w) continue;
        if (!mask[ny * w + nx]) continue;
        const d = ox * ox + oy * oy;
        if (d < bestD) {
          bestD = d;
          best = { x: nx, y: ny };
        }
      }
    }
    return best;
  }

  GD.Mask = {
    Method,
    buildMask,
    removeSmallComponents,
    dilate,
    autoDetectColors,
    nearestMaskPixel
  };
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';

/*
 * The classical part of the benchmark: what the ordinary algorithm finds in
 * a figure. It is the reference the model is measured against, so it runs on
 * the same modules the application uses.
 *
 * The file is loaded into the renderer of the benchmark, where the modules
 * of the application live.
 */

(function (root) {
  'use strict';

  const GD = root.GD;
  const G = GD.Geometry;

  /** The colour bar of a figure: a narrow block of vivid columns. */
  function findColourBar(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    if (w < 120 || h < 120) return null;
    const minChroma = 50;
    const limit = Math.max(4, Math.floor(h * 0.25));

    // How many vivid pixels every column holds.
    const vividCols = new Int32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        if (chroma > minChroma) vividCols[x]++;
      }
    }
    // The blocks of vivid columns.
    const blocks = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && vividCols[x] > limit;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        blocks.push([start, x - 1]);
        start = -1;
      }
    }
    if (!blocks.length) return null;

    // A colour bar is narrow; a field of a contour map is wide.
    const narrow = blocks.filter((b) => (b[1] - b[0]) < w * 0.12);
    if (!narrow.length) return null;
    let best = null;
    for (const b of narrow) {
      const width = b[1] - b[0] + 1;
      // The rows that carry the band.
      const medians = [];
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < h; y++) {
        let vivid = 0;
        const rows = [];
        for (let x = b[0]; x <= b[1]; x++) {
          const p = (y * w + x) * 4;
          const r = data[p];
          const g = data[p + 1];
          const bl = data[p + 2];
          const chroma = Math.max(r, g, bl) - Math.min(r, g, bl);
          if (chroma > minChroma) vivid++;
          rows.push([r, g, bl]);
        }
        if (vivid > width * 0.5) {
          if (top < 0) top = y;
          bottom = y;
          rows.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]));
          const mid = rows[Math.floor(rows.length / 2)];
          medians.push(mid);
        }
      }
      if (top < 0 || bottom - top < h * 0.2) continue;
      const barHeight = bottom - top + 1;
      // A colour bar is much taller than it is wide.
      if (barHeight < width * 2.2) continue;
      // The colour has to move in small steps. A legend with a few swatches
      // jumps from one colour to the next and is not a colour bar. The
      // comparison uses the typical step, so the noise of a jpeg does not
      // throw a real bar away.
      const steps = [];
      for (let i = 1; i < medians.length; i++) {
        const a = medians[i - 1];
        const c = medians[i];
        steps.push(Math.max(
          Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]), Math.abs(a[2] - c[2])));
      }
      steps.sort((a, b) => a - b);
      const typical = steps.length ? steps[Math.floor(steps.length * 0.9)] : 255;
      if (typical > 20) continue;
      // And it has to hold many colours: a smooth ramp, not two swatches.
      const distinct = new Set(medians.map((m) =>
        (m[0] >> 3) + ',' + (m[1] >> 3) + ',' + (m[2] >> 3))).size;
      if (distinct < 12) continue;
      const candidate = { x: b[0], y: top, w: width, h: barHeight };
      if (!best || candidate.h > best.h) best = candidate;
    }
    return best;
  }

  /** The tick labels next to a colour bar: the blocks of dark text. */
  function findTickLabels(imageData, bar) {
    if (!bar) return [];
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const x0 = bar.x + bar.w + 20;
    const x1 = Math.min(w, x0 + 160);
    const y0 = Math.max(0, bar.y - 40);
    const y1 = Math.min(h, bar.y + bar.h + 40);
    if (x1 <= x0 || y1 <= y0) return [];

    const dark = [];
    for (let y = y0; y < y1; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const p = (y * w + x) * 4;
        if (Math.max(data[p], data[p + 1], data[p + 2]) < 120) n++;
      }
      dark.push(n);
    }
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
    // Merge the blocks that belong to one number.
    const merged = [];
    for (const b of blocks) {
      if (merged.length && b[0] - merged[merged.length - 1][1] <= 6) {
        merged[merged.length - 1][1] = b[1];
      } else {
        merged.push([b[0], b[1]]);
      }
    }
    return merged
      .filter((b) => b[1] - b[0] >= 8)
      .map((b) => ({
        y: y0 + Math.round((b[0] + b[1]) / 2),
        height: b[1] - b[0],
        t: 1 - (y0 + (b[0] + b[1]) / 2 - bar.y) / bar.h
      }));
  }

  /** The pixels of the biggest connected component of a mask. */
  function largestComponent(mask, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let best = null;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      let sp = 0;
      stack[sp++] = i;
      seen[i] = 1;
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
            if (mask[nidx] && !seen[nidx]) {
              seen[nidx] = 1;
              stack[sp++] = nidx;
            }
          }
        }
      }
      if (!best || members.length > best.length) best = members;
    }
    return best;
  }

  /**
   * The curve of a figure, found the classical way: the colour that stands
   * out, the pixels of that colour, and a walk along them.
   */
  function referenceCurve(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const detected = GD.Mask.autoDetectColors(imageData);
    if (!detected || !detected.confidence) {
      return { ok: false, reason: 'no_colour', points: [] };
    }
    const mask = GD.Mask.buildMask(imageData, {
      method: 'color',
      lineColor: detected.lineColor,
      bgColor: detected.bgColor,
      tolerance: 0.08,
      minSize: 2
    });
    const component = largestComponent(mask.mask, w, h);
    if (!component || component.length < 40) {
      return { ok: false, reason: 'no_structure', points: [] };
    }
    // A structure that fills a third of the figure is a field, not a curve.
    if (component.length > w * h * 0.33) {
      return { ok: false, reason: 'too_broad', points: [] };
    }
    // The left end of the structure is the start of the walk.
    let start = component[0];
    for (const idx of component) {
      if (idx % w < start % w) start = idx;
    }
    const traced = GD.Trace.trace(mask, { x: start % w, y: (start / w) | 0 }, {
      direction: 'both',
      maxGap: 8,
      smooth: 1,
      spacing: 0
    });
    if (!traced.ok || traced.points.length < 20) {
      return { ok: false, reason: 'no_trace', points: [] };
    }
    // How much of the structure the walk actually followed. The trace is put
    // into a set first, otherwise every pixel of the structure is compared
    // with every point of the walk.
    const onTraceSet = new Set();
    for (const p of traced.points) {
      onTraceSet.add(p.x + ',' + p.y);
    }
    let onTrace = 0;
    for (const idx of component) {
      const x = idx % w;
      const y = (idx / w) | 0;
      let hit = false;
      for (let oy = -2; oy <= 2 && !hit; oy++) {
        for (let ox = -2; ox <= 2 && !hit; ox++) {
          if (onTraceSet.has((x + ox) + ',' + (y + oy))) hit = true;
        }
      }
      if (hit) onTrace++;
    }
    const purity = onTrace / component.length;
    if (purity < 0.5) {
      return { ok: false, reason: 'not_a_curve', purity: purity, points: [] };
    }
    // The walk has to be long enough to be a curve and not a blob.
    let length = 0;
    for (let i = 1; i < traced.points.length; i++) {
      length += G.dist(traced.points[i - 1], traced.points[i]);
    }
    const diagonal = Math.hypot(w, h);
    if (length < diagonal * 0.15) {
      return { ok: false, reason: 'too_short', length: length, points: [] };
    }
    return {
      ok: true,
      colour: detected.lineColor,
      background: detected.bgColor,
      confidence: detected.confidence,
      length: length,
      purity: purity,
      points: traced.points
    };
  }

  /** The distance of a point to a polyline. */
  function distanceToPolyline(points, x, y) {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) {
        t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
      }
      const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * How close the points of the model are to the reference curve, and how
   * much of the reference curve the model covered.
   */
  function compareToCurve(reference, points) {
    if (!points || !points.length) {
      return { count: 0, mean: null, worst: null, covered: 0 };
    }
    let sum = 0;
    let worst = 0;
    for (const p of points) {
      const d = distanceToPolyline(reference, p.x, p.y);
      sum += d;
      if (d > worst) worst = d;
    }
    // The share of the reference that the model came close to.
    let covered = 0;
    for (const p of reference) {
      let near = false;
      for (const q of points) {
        if (Math.hypot(p.x - q.x, p.y - q.y) <= 6) {
          near = true;
          break;
        }
      }
      if (near) covered++;
    }
    return {
      count: points.length,
      mean: sum / points.length,
      worst: worst,
      covered: covered / reference.length
    };
  }

  /**
   * How much the colour varies around a point. A point that sits on a drawn
   * line sees an edge, a point in an empty area does not. It is the measure
   * that says whether the model really looked at the figure, and it needs
   * no ground truth.
   */
  function structureScore(imageData, x, y) {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const r = 3;
    let min = [255, 255, 255];
    let max = [0, 0, 0];
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const p = (ny * w + nx) * 4;
        for (let c = 0; c < 3; c++) {
          const v = data[p + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
        n++;
      }
    }
    if (!n) return 0;
    return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  }

  /** How many of the points of the model sit on a drawn structure. */
  function onStructure(imageData, points, threshold) {
    if (!points || !points.length) return { count: 0, on: 0, ratio: 0 };
    let on = 0;
    for (const p of points) {
      if (structureScore(imageData, Math.round(p[0]), Math.round(p[1])) >= threshold) on++;
    }
    return { count: points.length, on: on, ratio: on / points.length };
  }

  /**
   * Whether the points of the model form one continuous path.
   *
   * The model does not return every pixel of a curve, so the distance
   * between two points can be large. What breaks a path is a step that is
   * much longer than the others, so the median decides what counts.
   */
  function coherence(points, floor) {
    if (!points || points.length < 2) return null;
    const steps = [];
    for (let i = 1; i < points.length; i++) {
      steps.push(Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const sorted = steps.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const threshold = Math.max(floor || 0, median * 3);
    let jumps = 0;
    for (const s of steps) if (s > threshold) jumps++;
    return {
      jumps: jumps,
      ratio: jumps / steps.length,
      median: median,
      threshold: threshold
    };
  }

  root.BenchVision = {
    findColourBar,
    findTickLabels,
    largestComponent,
    referenceCurve,
    distanceToPolyline,
    compareToCurve,
    structureScore,
    onStructure,
    coherence
  };
})(typeof window !== 'undefined' ? window : globalThis);

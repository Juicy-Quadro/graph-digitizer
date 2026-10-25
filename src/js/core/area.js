/*
 * Area digitizing.
 *
 * The user drags a rectangular window over the figure. Inside that window a
 * set of parallel sampling lines is generated, and every crossing of a
 * sampling line with the curve is recorded as a data point.
 *
 * Three kinds of sampling grids are supported:
 *
 *   pixels    - lines spaced evenly in image space, aligned with the window
 *   logicalX - lines of constant logical X (uses the calibration, so they
 *               stay perpendicular to a tilted X axis)
 *   logicalY - lines of constant logical Y
 *
 * The window may be rotated, which is what makes it possible to digitize a
 * tilted curve with a regular spacing.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const G = GD.Geometry;

  const GridMode = {
    PIXELS: 'pixels',
    LOGICAL_X: 'logicalX',
    LOGICAL_Y: 'logicalY'
  };

  const Placement = {
    CENTER: 'center',
    EDGE: 'edge'
  };

  const DEFAULTS = {
    mode: GridMode.PIXELS,
    spacing: 10,
    offset: 0,
    placement: Placement.CENTER,
    step: 0.4,
    minRun: 0.6
  };

  // The sampling line is probed at most this far apart, so that a curve
  // which is only one pixel wide cannot be stepped over.
  const MAX_PROBE = 0.25;

  /**
   * Clip an infinite world-space line to a (possibly rotated) rectangle.
   * Uses the slab method so the line is clipped in both directions.
   */
  function clipToRect(origin, dir, rect) {
    const th = (rect.rotation * Math.PI) / 180;
    const c = Math.cos(-th);
    const s = Math.sin(-th);
    const dx0 = origin.x - rect.cx;
    const dy0 = origin.y - rect.cy;
    const lx = dx0 * c - dy0 * s;
    const ly = dx0 * s + dy0 * c;
    const ldx = dir.x * c - dir.y * s;
    const ldy = dir.x * s + dir.y * c;

    let tmin = -Infinity;
    let tmax = Infinity;
    const p = [-ldx, ldx, -ldy, ldy];
    const q = [lx + rect.hw, rect.hw - lx, ly + rect.hh, rect.hh - ly];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > tmin) tmin = t;
        } else {
          if (t < tmax) tmax = t;
        }
      }
    }
    if (tmax < tmin) return null;

    // Back to world space.
    const cw = Math.cos(th);
    const sw = Math.sin(th);
    return {
      t0: tmin,
      t1: tmax,
      origin: { x: rect.cx + lx * cw - ly * sw, y: rect.cy + lx * sw + ly * cw },
      dir: { x: ldx * cw - ldy * sw, y: ldx * sw + ldy * cw }
    };
  }

  /** Build the list of sampling lines for the requested grid mode. */
  function buildGridLines(rect, calib, options) {
    const opt = options || {};
    const lines = [];
    const spacing = Math.max(0.5, opt.spacing || 10);
    const offset = opt.offset || 0;

    if (opt.mode === GridMode.LOGICAL_X || opt.mode === GridMode.LOGICAL_Y) {
      if (!calib || !calib.ok) return lines;
      const isX = opt.mode === GridMode.LOGICAL_X;
      // Logical extent covered by the rectangle.
      const corners = [
        { x: rect.cx - rect.hw, y: rect.cy - rect.hh },
        { x: rect.cx + rect.hw, y: rect.cy - rect.hh },
        { x: rect.cx + rect.hw, y: rect.cy + rect.hh },
        { x: rect.cx - rect.hw, y: rect.cy + rect.hh }
      ].map((p) => G.rotate(p.x, p.y, rect.cx, rect.cy, rect.rotation));
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of corners) {
        const l = calib.toLogical(p.x, p.y);
        const v = isX ? l.x : l.y;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const first = Math.ceil((lo - offset) / spacing) * spacing + offset;
      const count = Math.floor((hi - first) / spacing) + 1;
      for (let k = 0; k < count; k++) {
        const value = first + k * spacing;
        const line = isX ? calib.lineOfConstantX(value) : calib.lineOfConstantY(value);
        lines.push({ origin: line.origin, dir: line.dir, value });
      }
      return lines;
    }

    // Pixel grid: lines perpendicular to one of the window axes.
    const vertical = opt.mode !== GridMode.LOGICAL_Y;
    const half = vertical ? rect.hw : rect.hh;
    const span = 2 * half;
    // The grid is centred on the window so that the whole span is covered:
    // anchoring it at the left edge would leave the rest of the window
    // unsampled as soon as the spacing grows beyond the window width.
    const count = Math.max(1, Math.floor(span / spacing) + 1);
    const phase = offset % spacing;
    for (let k = 0; k < count; k++) {
      const local = (k - (count - 1) / 2) * spacing + phase;
      if (Math.abs(local) > half + 0.001) continue;
      const th = (rect.rotation * Math.PI) / 180;
      const localOrigin = vertical ? { x: local, y: 0 } : { x: 0, y: local };
      const localDir = vertical ? { x: 0, y: 1 } : { x: 1, y: 0 };
      const origin = {
        x: rect.cx + localOrigin.x * Math.cos(th) - localOrigin.y * Math.sin(th),
        y: rect.cy + localOrigin.x * Math.sin(th) + localOrigin.y * Math.cos(th)
      };
      const dir = {
        x: localDir.x * Math.cos(th) - localDir.y * Math.sin(th),
        y: localDir.x * Math.sin(th) + localDir.y * Math.cos(th)
      };
      lines.push({ origin, dir, value: null });
    }
    return lines;
  }

  /**
   * @param {object} maskInfo { mask, width, height }
   * @param {object} rect     { cx, cy, hw, hh, rotation }
   * @param {object} calib    calibration (may be null for pixel mode)
   * @param {object} options
   */
  function digitizeArea(maskInfo, rect, calib, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const mask = maskInfo.mask;
    const w = maskInfo.width;
    const h = maskInfo.height;

    const gridLines = buildGridLines(rect, calib, opt);
    const results = [];

    for (let li = 0; li < gridLines.length; li++) {
      const g = gridLines[li];
      const seg = clipToRect(g.origin, g.dir, rect);
      if (!seg) continue;
      const length = seg.t1 - seg.t0;
      if (length <= 0) continue;

      const step = Math.max(0.15, opt.step);
      // A probe never steps further than MAX_PROBE, otherwise a coarse
      // step would jump over the curve and the crossing would be lost.
      const probe = Math.min(step, MAX_PROBE);
      const count = Math.max(1, Math.ceil(length / probe));
      const at = (t) => ({
        x: seg.origin.x + seg.dir.x * t,
        y: seg.origin.y + seg.dir.y * t
      });

      /** Does the pixel the sampling line passes at t belong to the curve? */
      const hitAt = (t) => {
        const p = at(t);
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        if (px < 0 || py < 0 || px >= w || py >= h) return false;
        return !!mask[py * w + px];
      };

      /**
       * Position where the sampling line enters the curve: interpolated
       * between the last miss and the first hit instead of taken from the
       * rounded sample.
       */
      const boundary = (miss, hit) => {
        let lo = miss;
        let hi = hit;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (hitAt(mid)) hi = mid; else lo = mid;
        }
        return hi;
      };

      /**
       * Record one intersection. A run is valid when it covers at least one
       * distinct mask pixel; the geometric length is only used for reporting,
       * because a thin curve can be crossed within a fraction of a pixel.
       */
      const emitRun = (t0, t1, pixels) => {
        if (pixels < Math.max(1, opt.minRun)) return;
        const p0 = at(t0);
        const p1 = at(t1);
        const chosen = opt.placement === Placement.EDGE ? p0 : {
          x: (p0.x + p1.x) / 2,
          y: (p0.y + p1.y) / 2
        };
        const logical = calib && calib.ok
          ? calib.toLogical(chosen.x, chosen.y)
          : { x: chosen.x, y: chosen.y };
        results.push({
          px: chosen.x,
          py: chosen.y,
          x: logical.x,
          y: logical.y,
          gridIndex: li,
          gridValue: g.value,
          runLength: Math.hypot(p1.x - p0.x, p1.y - p0.y),
          // Position along the sampling line, so that the crossings of a
          // single line can be ordered by their projection.
          along: (chosen.x - seg.origin.x) * seg.dir.x + (chosen.y - seg.origin.y) * seg.dir.y
        });
      };

      let runStart = null;
      let runEnd = null;
      let runPixels = 0;
      const seenPixels = new Set();
      let prevT = null;
      for (let i = 0; i <= count; i++) {
        const t = seg.t0 + (length * i) / count;
        const hit = hitAt(t);
        if (hit) {
          if (runStart === null) {
            runStart = prevT === null ? t : boundary(prevT, t);
            runEnd = t;
            runPixels = 0;
            seenPixels.clear();
          }
          const p = at(t);
          const key = Math.round(p.y) * w + Math.round(p.x);
          if (!seenPixels.has(key)) {
            seenPixels.add(key);
            runPixels++;
          }
          runEnd = t;
        } else if (runStart !== null) {
          emitRun(runStart, boundary(t, prevT), runPixels);
          runStart = null;
          runEnd = null;
          runPixels = 0;
          seenPixels.clear();
        }
        prevT = t;
      }
      if (runStart !== null) {
        emitRun(runStart, runEnd, runPixels);
      }
    }

    results.sort((a, b) => (a.gridIndex - b.gridIndex) || (a.along - b.along));
    return results;
  }

  /** The grid lines as world-space segments, for drawing the preview overlay. */
  function previewSegments(rect, calib, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const lines = buildGridLines(rect, calib, opt);
    const out = [];
    for (const g of lines) {
      const seg = clipToRect(g.origin, g.dir, rect);
      if (!seg) continue;
      const p0 = {
        x: seg.origin.x + seg.dir.x * seg.t0,
        y: seg.origin.y + seg.dir.y * seg.t0
      };
      const p1 = {
        x: seg.origin.x + seg.dir.x * seg.t1,
        y: seg.origin.y + seg.dir.y * seg.t1
      };
      out.push({ p0, p1, value: g.value });
    }
    return out;
  }

  GD.Area = {
    GridMode,
    Placement,
    DEFAULTS,
    digitizeArea,
    buildGridLines,
    previewSegments,
    clipToRect
  };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Four-point calibration.
 *
 * The user marks four points on the figure and assigns each a logical value:
 *   Xmin / Xmax  the two ends of the horizontal (X) axis
 *   Ymin / Ymax  the two ends of the vertical (Y) axis
 *
 * The mapping is an affine decomposition of the image plane onto the two axis
 * directions:
 *
 *       p = origin + s * ax + t * ay
 *
 * where ax = Xmax - Xmin and ay = Ymax - Ymin. The logical X is the
 * interpolation of the two X values over the range of s that Xmin and Xmax
 * cover, and the logical Y is the same for the Y axis.
 *
 * Using the basis decomposition (rather than projecting a pixel onto each
 * axis) is what makes tilted and non-orthogonal axes behave: the projection
 * and the basis disagree as soon as the axes are not perpendicular, and the
 * basis is the one that reproduces the reference data.
 *
 * Because both axes are decomposed against the SAME origin, the choice of
 * origin cancels out of the final logical values.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});

  const CalibrationError = {
    INCOMPLETE: 'incomplete',
    X_COINCIDE: 'x_coincide',
    Y_COINCIDE: 'y_coincide',
    COLLINEAR: 'collinear',
    LOG_NEGATIVE: 'log_negative',
    LOG_ZERO_SPAN: 'log_zero_span'
  };

  /**
   * A 1-D scale that maps a parameter range onto a value range.
   *
   * @param {string} kind   'linear' or 'log'
   * @param {number} v0     value at the low end of the parameter range
   * @param {number} v1     value at the high end
   * @param {number} [p0]   parameter at the low end (default 0)
   * @param {number} [p1]   parameter at the high end (default 1)
   */
  function makeScale(kind, v0, v1, p0, p1) {
    const lo = p0 === undefined ? 0 : p0;
    const hi = p1 === undefined ? 1 : p1;
    const span = hi - lo;
    const norm = (x) => (span === 0 ? 0 : (x - lo) / span);

    if (kind === 'log') {
      const l0 = Math.log(v0);
      const l1 = Math.log(v1);
      return {
        kind: 'log',
        v0: v0,
        v1: v1,
        toValue: (x) => Math.exp(l0 + norm(x) * (l1 - l0)),
        toParam: (value) => lo + ((Math.log(value) - l0) / (l1 - l0)) * span
      };
    }
    return {
      kind: 'linear',
      v0: v0,
      v1: v1,
      toValue: (x) => v0 + norm(x) * (v1 - v0),
      toParam: (value) => lo + ((v1 === v0 ? 0 : (value - v0) / (v1 - v0))) * span
    };
  }

  /**
   * @param {object} points  { xmin:{x,y,value}, xmax, ymin, ymax }
   * @param {object} options { xScale:'linear'|'log', yScale:'linear'|'log' }
   */
  function create(points, options) {
    const opt = options || {};
    const p = points || {};
    const need = ['xmin', 'xmax', 'ymin', 'ymax'];
    for (let i = 0; i < need.length; i++) {
      const key = need[i];
      const pt = p[key];
      if (!pt || !isFinite(pt.x) || !isFinite(pt.y) || !isFinite(pt.value)) {
        return { ok: false, error: CalibrationError.INCOMPLETE, missing: key };
      }
    }

    const xScaleKind = opt.xScale === 'log' ? 'log' : 'linear';
    const yScaleKind = opt.yScale === 'log' ? 'log' : 'linear';

    if (xScaleKind === 'log' && (p.xmin.value <= 0 || p.xmax.value <= 0)) {
      return { ok: false, error: CalibrationError.LOG_NEGATIVE, axis: 'x' };
    }
    if (yScaleKind === 'log' && (p.ymin.value <= 0 || p.ymax.value <= 0)) {
      return { ok: false, error: CalibrationError.LOG_NEGATIVE, axis: 'y' };
    }
    if (xScaleKind === 'log' && p.xmin.value === p.xmax.value) {
      return { ok: false, error: CalibrationError.LOG_ZERO_SPAN, axis: 'x' };
    }
    if (yScaleKind === 'log' && p.ymin.value === p.ymax.value) {
      return { ok: false, error: CalibrationError.LOG_ZERO_SPAN, axis: 'y' };
    }

    const ax = { x: p.xmax.x - p.xmin.x, y: p.xmax.y - p.xmin.y };
    const ay = { x: p.ymax.x - p.ymin.x, y: p.ymax.y - p.ymin.y };
    const axLenSq = ax.x * ax.x + ax.y * ax.y;
    const ayLenSq = ay.x * ay.x + ay.y * ay.y;

    if (axLenSq < 1e-6) return { ok: false, error: CalibrationError.X_COINCIDE };
    if (ayLenSq < 1e-6) return { ok: false, error: CalibrationError.Y_COINCIDE };

    const det = ax.x * ay.y - ay.x * ax.y;
    if (Math.abs(det) < 1e-9) {
      const sinAngle = Math.abs(det) / Math.sqrt(axLenSq * ayLenSq);
      if (sinAngle < 1e-6) return { ok: false, error: CalibrationError.COLLINEAR };
    }

    // Shared origin of the affine decomposition. Any point works, because the
    // shift cancels out of the interpolated values.
    const origin = { x: p.xmin.x, y: p.xmin.y };

    /** Coefficient of `pt` along ax. */
    const sOf = (pt) => ((pt.x - origin.x) * ay.y - (pt.y - origin.y) * ay.x) / det;
    /** Coefficient of `pt` along ay. */
    const tOf = (pt) => (ax.x * (pt.y - origin.y) - ax.y * (pt.x - origin.x)) / det;

    const sXmin = sOf(p.xmin);
    const sXmax = sOf(p.xmax);
    const tYmin = tOf(p.ymin);
    const tYmax = tOf(p.ymax);

    const xScale = makeScale(xScaleKind, p.xmin.value, p.xmax.value, sXmin, sXmax);
    const yScale = makeScale(yScaleKind, p.ymin.value, p.ymax.value, tYmin, tYmax);

    const calib = {
      ok: true,
      error: null,
      points: p,
      xScale: xScale,
      yScale: yScale,
      origin: origin,
      axisX: { origin: { x: p.xmin.x, y: p.xmin.y }, vector: ax, length: Math.sqrt(axLenSq) },
      axisY: { origin: { x: p.ymin.x, y: p.ymin.y }, vector: ay, length: Math.sqrt(ayLenSq) },

      /** Image pixel -> logical coordinates. */
      toLogical(px, py) {
        const s = sOf({ x: px, y: py });
        const t = tOf({ x: px, y: py });
        return { x: xScale.toValue(s), y: yScale.toValue(t) };
      },

      /** Logical coordinates -> image pixel (the inverse affine map). */
      toPixel(lx, ly) {
        const s = xScale.toParam(lx);
        const t = yScale.toParam(ly);
        return {
          x: origin.x + ax.x * s + ay.x * t,
          y: origin.y + ax.y * s + ay.y * t
        };
      },

      /**
       * The image-space line on which the logical X value is constant.
       * It runs parallel to the Y axis, through the X axis at the matching
       * position.
       */
      lineOfConstantX(lx) {
        const s = xScale.toParam(lx);
        const anchor = {
          x: origin.x + ax.x * s,
          y: origin.y + ax.y * s
        };
        const len = Math.sqrt(ayLenSq);
        return { origin: anchor, dir: { x: ay.x / len, y: ay.y / len } };
      },

      /** The image-space line on which the logical Y value is constant. */
      lineOfConstantY(ly) {
        const t = yScale.toParam(ly);
        const anchor = {
          x: origin.x + ay.x * t,
          y: origin.y + ay.y * t
        };
        const len = Math.sqrt(axLenSq);
        return { origin: anchor, dir: { x: ax.x / len, y: ax.y / len } };
      },

      /** Logical rectangle that maps onto an image-space rectangle. */
      logicalBoundsOfRect(x0, y0, x1, y1) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < 4; i++) {
          const px = i === 0 || i === 3 ? x0 : x1;
          const py = i < 2 ? y0 : y1;
          const l = calib.toLogical(px, py);
          if (l.x < minX) minX = l.x;
          if (l.x > maxX) maxX = l.x;
          if (l.y < minY) minY = l.y;
          if (l.y > maxY) maxY = l.y;
        }
        return { minX, maxX, minY, maxY };
      }
    };

    return calib;
  }

  /** Calibration where one image pixel equals one logical unit. */
  function identityCalibration(width, height) {
    return create(
      {
        xmin: { x: 0, y: 0, value: 0 },
        xmax: { x: width, y: 0, value: width },
        ymin: { x: 0, y: 0, value: 0 },
        ymax: { x: 0, y: height, value: height }
      },
      { xScale: 'linear', yScale: 'linear' }
    );
  }

  GD.Calibration = {
    create,
    identityCalibration,
    CalibrationError,
    makeScale
  };
})(typeof window !== 'undefined' ? window : globalThis);

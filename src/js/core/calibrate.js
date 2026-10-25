/*
 * Four-point calibration.
 *
 * The user marks four image points and assigns each a logical value:
 *   Xmin / Xmax  -> the two ends of the horizontal (X) axis
 *   Ymin / Ymax  -> the two ends of the vertical (Y) axis
 *
 * The two axes do not have to be perpendicular and do not have to be
 * axis-aligned in image space, so the mapping is built as a general affine
 * transform derived from the two axis vectors:
 *
 *   u = ((p - Xmin) . ax) / (ax . ax)      -> normalised position along X
 *   v = ((p - Ymin) . ay) / (ay . ay)      -> normalised position along Y
 *
 * and the logical value is the interpolation of the two axis values at that
 * normalised position. Logarithmic axes are handled by interpolating in log
 * space, which keeps the transform affine in the linearised domain.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});

  const CalibrationError = {
    INCOMPLETE: 'incomplete',
    X_COINCIDE: 'x_coincide',
    Y_COINCIDE: 'y_coincide',
    COLLINEAR: 'collinear',
    LOG_NEGATIVE: 'log_negative'
  };

  /** A 1-D scale mapping a normalised parameter to a logical value. */
  function makeScale(kind, v0, v1) {
    if (kind === 'log') {
      const l0 = Math.log(v0);
      const l1 = Math.log(v1);
      return {
        kind: 'log',
        v0: v0,
        v1: v1,
        toValue: (t) => Math.exp(l0 + t * (l1 - l0)),
        toParam: (value) => (Math.log(value) - l0) / (l1 - l0)
      };
    }
    return {
      kind: 'linear',
      v0: v0,
      v1: v1,
      toValue: (t) => v0 + t * (v1 - v0),
      toParam: (value) => (v1 === v0 ? 0 : (value - v0) / (v1 - v0))
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

    const ax = { x: p.xmax.x - p.xmin.x, y: p.xmax.y - p.xmin.y };
    const ay = { x: p.ymax.x - p.ymin.x, y: p.ymax.y - p.ymin.y };
    const axLenSq = ax.x * ax.x + ax.y * ax.y;
    const ayLenSq = ay.x * ay.x + ay.y * ay.y;

    if (axLenSq < 1e-6) return { ok: false, error: CalibrationError.X_COINCIDE };
    if (ayLenSq < 1e-6) return { ok: false, error: CalibrationError.Y_COINCIDE };

    const sinAngle = Math.abs(ax.x * ay.y - ax.y * ay.x) / Math.sqrt(axLenSq * ayLenSq);
    if (sinAngle < 1e-6) return { ok: false, error: CalibrationError.COLLINEAR };

    const xScale = makeScale(xScaleKind, p.xmin.value, p.xmax.value);
    const yScale = makeScale(yScaleKind, p.ymin.value, p.ymax.value);

    const rhsX = p.xmin.x * ax.x + p.xmin.y * ax.y;
    const rhsY = p.ymin.x * ay.x + p.ymin.y * ay.y;

    const calib = {
      ok: true,
      error: null,
      points: p,
      xScale: xScale,
      yScale: yScale,
      axisX: { origin: { x: p.xmin.x, y: p.xmin.y }, vector: ax, length: Math.sqrt(axLenSq) },
      axisY: { origin: { x: p.ymin.x, y: p.ymin.y }, vector: ay, length: Math.sqrt(ayLenSq) },

      /** Image pixel -> logical coordinates. */
      toLogical(px, py) {
        const u = ((px * ax.x + py * ax.y) - rhsX) / axLenSq;
        const v = ((px * ay.x + py * ay.y) - rhsY) / ayLenSq;
        return { x: xScale.toValue(u), y: yScale.toValue(v) };
      },

      /** Logical coordinates -> image pixel (inverse affine). */
      toPixel(lx, ly) {
        const u = xScale.toParam(lx);
        const v = yScale.toParam(ly);
        const det = ax.x * ay.y - ay.x * ax.y;
        const b1 = u * axLenSq + rhsX;
        const b2 = v * ayLenSq + rhsY;
        return {
          x: (b1 * ay.y - b2 * ax.y) / det,
          y: (ax.x * b2 - ay.x * b1) / det
        };
      },

      /**
       * The image-space line on which the logical X value is constant.
       * It is parallel to the Y axis and anchored on the X axis.
       */
      lineOfConstantX(lx) {
        const u = xScale.toParam(lx);
        const anchor = {
          x: p.xmin.x + ax.x * u,
          y: p.xmin.y + ax.y * u
        };
        const len = Math.sqrt(ayLenSq);
        return { origin: anchor, dir: { x: ay.x / len, y: ay.y / len } };
      },

      /** The image-space line on which the logical Y value is constant. */
      lineOfConstantY(ly) {
        const v = yScale.toParam(ly);
        const anchor = {
          x: p.ymin.x + ay.x * v,
          y: p.ymin.y + ay.y * v
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

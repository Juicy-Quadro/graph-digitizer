/*
 * Automatic line tracing.
 *
 * The algorithm walks along the curve inside the mask. At every step the
 * neighbourhood around the current position is examined and the candidate
 * that continues the current direction most smoothly is chosen, so that a
 * crossing is resolved by going straight through rather than turning.
 *
 * Small interruptions in the curve (dashed lines, anti-aliasing, a broken
 * scan) are bridged by looking ahead along the current direction up to a
 * configurable distance.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const G = GD.Geometry;

  const DEFAULTS = {
    maxGap: 6,
    minTurnCos: 0.35,
    searchRadius: 2,
    smoothRadius: 1,
    simplifyEpsilon: 0.35,
    spacing: 0,
    maxPoints: 50000
  };

  /**
   * Trace a single direction.
   * @returns {Array<{x,y}>} polyline in image pixel coordinates
   */
  function traceDirection(mask, w, h, start, dirX, dirY, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const pts = [];
    let px = start.x;
    let py = start.y;
    let dx = dirX;
    let dy = dirY;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return pts;
    dx /= len;
    dy /= len;

    pts.push({ x: px, y: py });
    const maxSteps = Math.min(w * h, 400000);
    const maxPoints = Math.max(16, opt.maxPoints || DEFAULTS.maxPoints);
    const R = Math.max(1, opt.searchRadius);

    for (let step = 0; step < maxSteps; step++) {
      if (pts.length >= maxPoints) break;
      let best = null;
      let bestScore = -Infinity;
      for (let oy = -R; oy <= R; oy++) {
        const ny = py + oy;
        if (ny < 0 || ny >= h) continue;
        for (let ox = -R; ox <= R; ox++) {
          if (!ox && !oy) continue;
          const nx = px + ox;
          if (nx < 0 || nx >= w) continue;
          if (!mask[ny * w + nx]) continue;
          const d = Math.hypot(ox, oy);
          const dot = (ox * dx + oy * dy) / d;
          if (dot < opt.minTurnCos) continue;
          // Prefer straight continuation, then short hops.
          const score = dot * 100 - d * 0.9;
          if (score > bestScore) {
            bestScore = score;
            best = { x: nx, y: ny, dot };
          }
        }
      }

      if (best) {
        const ndx = best.x - px;
        const ndy = best.y - py;
        const nl = Math.hypot(ndx, ndy) || 1;
        dx = ndx / nl;
        dy = ndy / nl;
        px = best.x;
        py = best.y;
        pts.push({ x: px, y: py });
        continue;
      }

      // Nothing adjacent: try to bridge a gap along the current direction.
      // The neighbourhood is searched at every step so that a slightly
      // sloped curve is still found - marching on a single pixel line would
      // drift away from it. The candidate must stay in front of the current
      // position and close to the direction, otherwise the tracer would jump
      // onto unrelated structures or oscillate.
      let bridged = null;
      const gap = Math.max(1, Math.round(opt.maxGap));
      for (let g = 1; g <= gap && !bridged; g++) {
        const bx = px + dx * g;
        const by = py + dy * g;
        for (let oy = -2; oy <= 2 && !bridged; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const nx = Math.round(bx) + ox;
            const ny = Math.round(by) + oy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (!mask[ny * w + nx]) continue;
            const rx = nx - px;
            const ry = ny - py;
            const forward = rx * dx + ry * dy;
            if (forward <= 0) continue;
            const lateral = Math.abs(rx * -dy + ry * dx);
            if (lateral > 3) continue;
            bridged = { x: nx, y: ny };
            break;
          }
        }
      }
      if (!bridged) break;
      px = bridged.x;
      py = bridged.y;
      pts.push({ x: px, y: py });
    }
    return pts;
  }

  /**
   * Trace a curve from a start point.
   *
   * @param {object} maskInfo { mask, width, height }
   * @param {object} start    { x, y } in image pixels
   * @param {object} options
   *   direction : 'both' | 'forward'
   *   hint      : { x, y } optional second point that defines the forward direction
   */
  function trace(maskInfo, start, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const mask = maskInfo.mask;
    const w = maskInfo.width;
    const h = maskInfo.height;

    const snapRadius = Math.max(4, opt.snapRadius || Math.max(8, opt.searchRadius + 6));
    const snapped = GD.Mask.nearestMaskPixel(mask, w, h, start.x, start.y, snapRadius);
    if (!snapped) return { ok: false, reason: 'no_curve', points: [] };
    const origin = snapped;

    let dirX = 1;
    let dirY = 0;
    let both = true;
    if (opt.direction === 'forward' && opt.hint) {
      const vx = opt.hint.x - origin.x;
      const vy = opt.hint.y - origin.y;
      const l = Math.hypot(vx, vy);
      if (l > 1e-6) {
        dirX = vx / l;
        dirY = vy / l;
        both = false;
      }
    }

    const forward = traceDirection(mask, w, h, origin, dirX, dirY, opt);
    let combined;
    if (both) {
      const backward = traceDirection(mask, w, h, origin, -dirX, -dirY, opt);
      combined = backward.slice(0, -1).reverse().concat(forward);
    } else {
      combined = forward;
    }

    const processed = postProcess(combined, opt);
    return {
      ok: processed.length > 1,
      reason: processed.length > 1 ? null : 'too_short',
      points: processed,
      rawLength: combined.length
    };
  }

  function postProcess(points, opt) {
    if (!points.length) return points;
    let out = points;
    if (opt.smoothRadius > 0) out = G.smooth(out, opt.smoothRadius);
    if (opt.spacing > 0) out = G.resample(out, opt.spacing);
    else if (opt.simplifyEpsilon > 0) out = G.simplify(out, opt.simplifyEpsilon);
    return out;
  }

  GD.Trace = {
    trace,
    traceDirection,
    DEFAULTS
  };
})(typeof window !== 'undefined' ? window : globalThis);

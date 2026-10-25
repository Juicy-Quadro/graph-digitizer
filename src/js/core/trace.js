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

  // A bridge may only continue the curve: the candidate has to stay within
  // about one pixel of the marched point and has to keep the heading.
  const BRIDGE_LATERAL = 1.5;
  const BRIDGE_MAX_TURN = 1;
  // A single step may not leave the corridor of the curve either.
  const SEARCH_LATERAL = 1.5;

  /**
   * Trace a single direction.
   * @returns {Array<{x,y}>} polyline in image pixel coordinates
   */
  function traceDirection(mask, w, h, start, dirX, dirY, options) {
    return traceDirectionInfo(mask, w, h, start, dirX, dirY, options).points;
  }

  /**
   * Trace a single direction and report whether a limit cut the walk short.
   * @returns {{ points: Array<{x,y}>, truncated: boolean, limitReached: ?string }}
   */
  function traceDirectionInfo(mask, w, h, start, dirX, dirY, options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const pts = [];
    let px = start.x;
    let py = start.y;
    let dx = dirX;
    let dy = dirY;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { points: pts, truncated: false, limitReached: null };
    dx /= len;
    dy /= len;

    pts.push({ x: px, y: py });
    const maxSteps = Math.min(w * h, 400000);
    const maxPoints = Math.max(16, opt.maxPoints || DEFAULTS.maxPoints);
    const R = Math.max(1, opt.searchRadius);

    let limit = null;
    let finished = false;
    let step = 0;
    while (step < maxSteps) {
      step++;
      if (pts.length >= maxPoints) {
        limit = 'maxPoints';
        break;
      }
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
          // The step has to stay in the corridor of the curve: a candidate
          // that is more than a pixel off the heading belongs to another
          // structure, not to a continuation of the curve.
          const lateral = ox * -dy + oy * dx;
          if (Math.abs(lateral) > SEARCH_LATERAL) continue;
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
      // drift away from it. The candidate has to continue the curve: it must
      // lie in front of the current position, stay within a pixel of the
      // marched point and keep the heading. Otherwise the tracer would jump
      // onto unrelated structures and keep tracing them.
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
            // Lateral deviation is measured from the marched point, not from
            // the current position, so a candidate far off the heading can
            // never be reached.
            const lateral = (nx - bx) * -dy + (ny - by) * dx;
            if (Math.abs(lateral) > BRIDGE_LATERAL) continue;
            const rx = nx - px;
            const ry = ny - py;
            const forward = rx * dx + ry * dy;
            if (forward <= 0) continue;
            // Angular bound: the candidate may not leave the cone around
            // the heading (45 degrees) as seen from the current position.
            const offAxis = Math.abs(rx * -dy + ry * dx);
            if (offAxis > forward * BRIDGE_MAX_TURN) continue;
            bridged = { x: nx, y: ny };
            break;
          }
        }
      }
      if (!bridged) {
        finished = true;
        break;
      }
      // The heading has to follow the bridge, otherwise the tracer keeps
      // the old direction from the new position.
      const bdx = bridged.x - px;
      const bdy = bridged.y - py;
      const bl = Math.hypot(bdx, bdy) || 1;
      dx = bdx / bl;
      dy = bdy / bl;
      px = bridged.x;
      py = bridged.y;
      pts.push({ x: px, y: py });
    }
    if (!finished && limit === null) limit = 'maxSteps';
    return { points: pts, truncated: limit !== null, limitReached: limit };
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

    const forwardInfo = traceDirectionInfo(mask, w, h, origin, dirX, dirY, opt);
    const forward = forwardInfo.points;
    let combined;
    let truncated = forwardInfo.truncated;
    let limitReached = forwardInfo.limitReached;
    if (both) {
      const backwardInfo = traceDirectionInfo(mask, w, h, origin, -dirX, -dirY, opt);
      const backward = backwardInfo.points;
      // The first element of the backward walk is the shared origin, so it
      // is the one to drop; its far endpoint has to be kept.
      combined = backward.slice(1).reverse().concat(forward);
      truncated = truncated || backwardInfo.truncated;
      if (!limitReached) limitReached = backwardInfo.limitReached;
    } else {
      combined = forward;
    }

    const processed = postProcess(combined, opt);
    return {
      ok: processed.length > 1,
      reason: processed.length > 1 ? null : 'too_short',
      points: processed,
      rawLength: combined.length,
      truncated: truncated,
      limitReached: limitReached
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
    traceDirectionInfo,
    DEFAULTS
  };
})(typeof window !== 'undefined' ? window : globalThis);

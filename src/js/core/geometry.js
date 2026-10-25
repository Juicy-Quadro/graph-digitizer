/* Geometry helpers shared by the digitizing algorithms. */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});

  const Geometry = {
    clamp(v, lo, hi) {
      return v < lo ? lo : (v > hi ? hi : v);
    },

    dist(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.hypot(dx, dy);
    },

    /** Cross product magnitude; zero when the vectors are parallel. */
    cross(ax, ay, bx, by) {
      return ax * by - ay * bx;
    },

    dot(ax, ay, bx, by) {
      return ax * bx + ay * by;
    },

    /** Perceptual-ish RGB distance (the "redmean" approximation), 0..~765. */
    colorDistance(r1, g1, b1, r2, g2, b2) {
      const rm = (r1 + r2) / 2;
      const dr = r1 - r2;
      const dg = g1 - g2;
      const db = b1 - b2;
      return Math.sqrt(
        (2 + rm / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rm) / 256) * db * db
      );
    },

    luminance(r, g, b) {
      return 0.299 * r + 0.587 * g + 0.114 * b;
    },

    /** Rec.709 relative luminance, used for SVG/EPS output colour. */
    relativeLuminance(r, g, b) {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    },

    /**
     * Liang-Barsky clip of a parametric ray against an axis aligned box
     * expressed in the box's own (already rotated) local frame.
     */
    clipRayToBox(px, py, dx, dy, minX, minY, maxX, maxY) {
      let t0 = 0;
      let t1 = Infinity;
      const p = [-dx, dx, -dy, dy];
      const q = [px - minX, maxX - px, py - minY, maxY - py];
      for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
          if (q[i] < 0) return null;
        } else {
          const t = q[i] / p[i];
          if (p[i] < 0) {
            if (t > t1) return null;
            if (t > t0) t0 = t;
          } else {
            if (t < t0) return null;
            if (t < t1) t1 = t;
          }
        }
      }
      if (t1 < t0) return null;
      return { t0, t1 };
    },

    /** Rotate a point around an origin by `deg` degrees. */
    rotate(px, py, ox, oy, deg) {
      const r = (deg * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      const dx = px - ox;
      const dy = py - oy;
      return { x: ox + dx * c - dy * s, y: oy + dx * s + dy * c };
    },

    /** Douglas-Peucker polyline simplification. */
    simplify(points, epsilon) {
      if (points.length < 3) return points.slice();
      const keep = new Uint8Array(points.length);
      keep[0] = 1;
      keep[points.length - 1] = 1;
      const stack = [[0, points.length - 1]];
      while (stack.length) {
        const [first, last] = stack.pop();
        let maxDist = 0;
        let index = -1;
        const a = points[first];
        const b = points[last];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        for (let i = first + 1; i < last; i++) {
          const p = points[i];
          let d;
          if (len === 0) {
            d = Geometry.dist(p, a);
          } else {
            d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
          }
          if (d > maxDist) {
            maxDist = d;
            index = i;
          }
        }
        if (maxDist > epsilon && index > 0) {
          keep[index] = 1;
          stack.push([first, index], [index, last]);
        }
      }
      const out = [];
      for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
      return out;
    },

    /** Moving average smoothing of a polyline. */
    smooth(points, radius) {
      if (radius < 1 || points.length < 3) return points.slice();
      const out = new Array(points.length);
      for (let i = 0; i < points.length; i++) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let j = i - radius; j <= i + radius; j++) {
          if (j < 0 || j >= points.length) continue;
          sx += points[j].x;
          sy += points[j].y;
          n++;
        }
        out[i] = { x: sx / n, y: sy / n };
      }
      return out;
    },

    /** Resample a polyline at a fixed arc-length spacing. */
    resample(points, spacing) {
      if (points.length < 2) return points.slice();
      if (!spacing || spacing <= 0) return points.slice();
      const out = [points[0]];
      let carry = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        let seg = Geometry.dist(a, b);
        if (seg === 0) continue;
        let t0 = carry / seg;
        while (t0 <= 1) {
          out.push({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
          t0 += spacing / seg;
        }
        carry = (carry + seg) % spacing;
      }
      const last = points[points.length - 1];
      const tail = out[out.length - 1];
      if (Geometry.dist(tail, last) > spacing * 0.35) out.push(last);
      return out;
    },

    /** Round to a fixed number of significant decimals without exponent noise. */
    num(v, decimals) {
      if (!isFinite(v)) return '0';
      const s = v.toFixed(decimals);
      return s.replace(/\.?0+$/, '') || '0';
    }
  };

  GD.Geometry = Geometry;
})(typeof window !== 'undefined' ? window : globalThis);

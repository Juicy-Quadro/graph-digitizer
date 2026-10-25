#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Pick the correct four-point calibration model empirically.

Candidate models for mapping a pixel to logical coordinates:

  M1 projection : u = (p-Xmin).ax/|ax|^2 , v = (p-Ymin).ay/|ay|^2
  M2 affine-xmin: p = Xmin + s*ax + t*ay          (origin at Xmin)
  M3 affine-ymin: p = Ymin + s*ax + t*ay          (origin at Ymin)
  M4 intersect  : origin = intersection of the two axis lines, parameters
                  measured from the origin along each axis direction

Judged against the reference points GetData itself produced:

  * monotonicity  - a function plot must have a monotone logical X
  * coverage      - the logical values should stay inside the axis range
  * smoothness    - the true parametric curve is smooth in logical space, so
                    the correct model gives the lowest total curvature
"""

import json
import os
import sys

import numpy as np

ROOT = r'E:\projects\graph-digitizer\testdata'


def load(name):
    with open(os.path.join(ROOT, name + '-truth.json'), encoding='utf-8') as fh:
        return json.load(fh)


def axes(cal):
    p = cal['points']
    ax = np.array([p['xmax']['x'] - p['xmin']['x'], p['xmax']['y'] - p['xmin']['y']], float)
    ay = np.array([p['ymax']['x'] - p['ymin']['x'], p['ymax']['y'] - p['ymin']['y']], float)
    return p, ax, ay


def m1_projection(px, py, p, ax, ay):
    u = ((px - p['xmin']['x']) * ax[0] + (py - p['xmin']['y']) * ax[1]) / (ax @ ax)
    v = ((px - p['ymin']['x']) * ay[0] + (py - p['ymin']['y']) * ay[1]) / (ay @ ay)
    return u, v


def m2_affine_xmin(px, py, p, ax, ay):
    d = ax[0] * ay[1] - ay[0] * ax[1]
    rx, ry = px - p['xmin']['x'], py - p['xmin']['y']
    s = (rx * ay[1] - ry * ay[0]) / d
    t = (ax[0] * ry - ax[1] * rx) / d
    return s, t


def m3_affine_ymin(px, py, p, ax, ay):
    d = ax[0] * ay[1] - ay[0] * ax[1]
    rx, ry = px - p['ymin']['x'], py - p['ymin']['y']
    s = (rx * ay[1] - ry * ay[0]) / d
    t = (ax[0] * ry - ax[1] * rx) / d
    return s, t


def _intersect(p, ax, ay):
    a = np.array([p['xmin']['x'], p['xmin']['y']], float)
    b = np.array([p['ymin']['x'], p['ymin']['y']], float)
    d = ax[0] * ay[1] - ay[0] * ax[1]
    if abs(d) < 1e-9:
        return a
    t = ((b[0] - a[0]) * ay[1] - (b[1] - a[1]) * ay[0]) / d
    return a + t * ax


def m4_intersect(px, py, p, ax, ay):
    o = _intersect(p, ax, ay)
    ex = ax / np.linalg.norm(ax)
    ey = ay / np.linalg.norm(ay)
    r = np.array([px, py], float) - o
    return float(r @ ex), float(r @ ey)


MODELS = {
    'M1 projection': m1_projection,
    'M2 affine@Xmin': m2_affine_xmin,
    'M3 affine@Ymin': m3_affine_ymin,
    'M4 intersect': m4_intersect,
}


def value_of(param, lo_param, hi_param, lo_val, hi_val):
    span = hi_param - lo_param
    if abs(span) < 1e-12:
        return lo_val
    t = (param - lo_param) / span
    return lo_val + t * (hi_val - lo_val)


def evaluate(name):
    gt = load(name)
    cal = gt['calibration']
    p, ax, ay = axes(cal)
    target = gt['lines'][gt['scaleIndex']]['points']
    pts = np.array(target, float)

    xlo = min(p['xmin']['value'], p['xmax']['value'])
    xhi = max(p['xmin']['value'], p['xmax']['value'])
    ylo = min(p['ymin']['value'], p['ymax']['value'])
    yhi = max(p['ymin']['value'], p['ymax']['value'])

    print('\n=== %s  "%s"  %d reference points ===' % (name, gt['lines'][gt['scaleIndex']]['caption'], len(pts)))
    angle = np.degrees(np.arccos(abs(ax @ ay) / (np.linalg.norm(ax) * np.linalg.norm(ay))))
    print('  axis angle %.2f deg   axis ranges X %.4g..%.4g  Y %.4g..%.4g'
          % (angle, xlo, xhi, ylo, yhi))

    rows = []
    for label, fn in MODELS.items():
        uv = np.array([fn(px, py, p, ax, ay) for px, py in pts])
        # Normalise the parameters so that the stored axis values apply.
        su = fn(p['xmin']['x'], p['xmin']['y'], p, ax, ay)[0]
        eu = fn(p['xmax']['x'], p['xmax']['y'], p, ax, ay)[0]
        sv = fn(p['ymin']['x'], p['ymin']['y'], p, ax, ay)[1]
        ev = fn(p['ymax']['x'], p['ymax']['y'], p, ax, ay)[1]
        X = np.array([value_of(u, su, eu, p['xmin']['value'], p['xmax']['value']) for u in uv[:, 0]])
        Y = np.array([value_of(v, sv, ev, p['ymin']['value'], p['ymax']['value']) for v in uv[:, 1]])

        inside = np.mean((X >= xlo - 0.05 * (xhi - xlo)) & (X <= xhi + 0.05 * (xhi - xlo)) &
                         (Y >= ylo - 0.05 * (yhi - ylo)) & (Y <= yhi + 0.05 * (yhi - ylo)))
        order = np.argsort(X)
        Xs, Ys = X[order], Y[order]
        back = np.mean(np.diff(Xs) < -1e-9)
        rough = np.mean(np.abs(np.diff(Ys, 2))) if len(Ys) > 2 else 0.0
        rows.append((label, inside, back, rough, X.min(), X.max()))
        print('  %-16s inside %5.0f%%   X backtracks %5.1f%%   curvature %10.4g   X span %.4g..%.4g'
              % (label, inside * 100, back * 100, rough, X.min(), X.max()))
    return rows


for sample in ('sample1', 'sample2', 'sample3'):
    evaluate(sample)

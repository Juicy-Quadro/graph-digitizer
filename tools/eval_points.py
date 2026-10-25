#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Evaluate the LLM-extracted points against the real curve pixels."""

import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = r'E:\projects\graph-digitizer'
img = Image.open(os.path.join(ROOT, 'testdata', 'sample3.png')).convert('RGB')
W, H = img.size
arr = np.asarray(img).astype(int)

# The plotted curve is the saturated blue of the matplotlib default.
r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
blue = (b > 140) & (b - r > 60) & (b - g > 30)
ys, xs = np.nonzero(blue)
print('image %dx%d, blue curve pixels: %d' % (W, H, blue.sum()))

if len(sys.argv) < 2:
    sys.exit('usage: eval_points.py <extracted.json>')

data = json.load(open(sys.argv[1], encoding='utf-8'))
pts = data['points'] if isinstance(data, dict) else data
# PowerShell's pipeline turns nested arrays into {"value":[...],"Count":n}
pts = [p['value'] if isinstance(p, dict) and 'value' in p else p for p in pts]
print('extracted points: %d' % len(pts))

# Distance from each returned point to the nearest real curve pixel.
dists = []
for p in pts:
    x = p[0] * W
    y = p[1] * H
    d = np.hypot(xs - x, ys - y)
    dists.append(float(d.min()))
dists = np.array(dists)

print('distance to the real curve (px):')
print('  median %.2f   mean %.2f   p90 %.2f   max %.2f' % (
    np.median(dists), dists.mean(), np.percentile(dists, 90), dists.max()))
print('  within 2 px : %d/%d (%.0f%%)' % (
    (dists <= 2).sum(), len(dists), 100 * (dists <= 2).mean()))
print('  within 5 px : %d/%d (%.0f%%)' % (
    (dists <= 5).sum(), len(dists), 100 * (dists <= 5).mean()))
print('  within 12 px: %d/%d (%.0f%%)' % (
    (dists <= 12).sum(), len(dists), 100 * (dists <= 12).mean()))

# Monotonicity of the parameter along the curve: the sample is a closed-ish
# polyline, so a good extraction should not double back in normalised x.
xsn = [p[0] for p in pts]
back = sum(1 for i in range(1, len(xsn)) if xsn[i] < xsn[i - 1] - 0.02)
print('  normalised x backtracks: %d of %d steps' % (back, len(xsn) - 1))

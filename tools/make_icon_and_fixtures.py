#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Generate the application icon and export the GetData sample figures as raw
RGBA so the JavaScript algorithms can be exercised against real data."""

import json
import os
import sys

from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
SAMPLES = r'C:\Program Files (x86)\GetData\graphs'


def rounded_rect(draw, box, radius, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = box
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.ellipse([x0, y0, x0 + 2 * radius, y0 + 2 * radius], fill=fill)
    draw.ellipse([x1 - 2 * radius, y0, x1, y0 + 2 * radius], fill=fill)
    draw.ellipse([x0, y1 - 2 * radius, x0 + 2 * radius, y1], fill=fill)
    draw.ellipse([x1 - 2 * radius, y1 - 2 * radius, x1, y1], fill=fill)
    if outline:
        draw.ellipse([x0, y0, x0 + 2 * radius, y0 + 2 * radius], outline=outline, width=width)
        draw.ellipse([x1 - 2 * radius, y0, x1, y0 + 2 * radius], outline=outline, width=width)
        draw.ellipse([x0, y1 - 2 * radius, x0 + 2 * radius, y1], outline=outline, width=width)
        draw.ellipse([x1 - 2 * radius, y1 - 2 * radius, x1, y1], outline=outline, width=width)
        draw.rectangle([x0 + radius, y0, x1 - radius, y0 + width], fill=outline)
        draw.rectangle([x0 + radius, y1 - width, x1 - radius, y1], fill=outline)
        draw.rectangle([x0, y0 + radius, x0 + width, y1 - radius], fill=outline)
        draw.rectangle([x1 - width, y0 + radius, x1, y1 - radius], fill=outline)


def build_icon(size):
    S = size
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    bg = (17, 21, 28, 255)
    accent = (76, 141, 255, 255)
    dim = (154, 167, 184, 255)

    pad = max(2, int(S * 0.06))
    rounded_rect(d, [pad, pad, S - pad, S - pad], max(3, int(S * 0.17)), fill=bg)

    # axes
    ax0 = int(S * 0.22)
    ax1 = int(S * 0.80)
    ay0 = int(S * 0.76)
    ay1 = int(S * 0.22)
    lw = max(1, int(S * 0.028))
    d.line([(ax0, ay0), (ax0, ay1)], fill=dim, width=lw)
    d.line([(ax0, ay0), (ax1, ay0)], fill=dim, width=lw)

    # curve
    curve = [
        (0.26, 0.66), (0.36, 0.58), (0.44, 0.42), (0.52, 0.47),
        (0.60, 0.31), (0.68, 0.36), (0.78, 0.28)
    ]
    pts = [(int(S * x), int(S * y)) for x, y in curve]
    d.line(pts, fill=accent, width=max(2, int(S * 0.05)))

    # sample dots
    r = max(2, int(S * 0.032))
    for x, y in curve[1:-1:2]:
        cx, cy = int(S * x), int(S * y)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=accent)

    return img


def main():
    build_dir = os.path.join(OUT, 'build')
    os.makedirs(build_dir, exist_ok=True)

    icon = build_icon(256)
    icon.save(os.path.join(build_dir, 'icon.png'))
    icon.save(os.path.join(build_dir, 'icon.ico'),
              sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('icon written to', build_dir)

    raw_dir = os.path.join(OUT, 'testdata')
    os.makedirs(raw_dir, exist_ok=True)
    manifest = []
    for name in ('sample1.jpg', 'sample2.tif', 'sample3.pcx', 'sample4.bmp', 'sample5.bmp'):
        path = os.path.join(SAMPLES, name)
        if not os.path.exists(path):
            continue
        im = Image.open(path).convert('RGBA')
        w, h = im.size
        data = im.tobytes()
        out = os.path.join(raw_dir, name + '.rgba')
        with open(out, 'wb') as fh:
            fh.write(data)
        manifest.append({'name': name, 'width': w, 'height': h, 'file': out})
        print('exported %-14s %dx%d' % (name, w, h))

    with open(os.path.join(raw_dir, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2)


if __name__ == '__main__':
    main()

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Fetch the real paper figures used by the regression suite.

The figures come from the source package of an arXiv paper, so the original
files are used rather than a rasterised copy of the paper. The paper is
published under a licence that allows redistribution and its address is
recorded with every figure.

    python tools/fetch_paper_figures.py

The figures land in testdata/papers/ and testdata/papers/truth.json
describes them: where the colour bar is and which value its tick labels
stand for.

The position of the bar and of its labels is measured by the program. The
numbers the labels stand for are read by a human and listed in PANELS
below, because reading them is the one step that needs a pair of eyes.
"""

import io
import json
import os
import sys
import tarfile
import zipfile
import requests
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'testdata', 'papers')
UA = {'User-Agent': 'graph-digitizer-regression/1.0'}

PAPER = '2601.00342'
PAPER_TITLE = ('Solving nonlinear subsonic compressible flow in infinite '
               'domain via multi-stage neural networks')
PAPER_URL = 'https://arxiv.org/abs/' + PAPER
FIGURE = 'uv_result.jpg'

# The panels of the figure, with the window that is cut out of it and the
# values of the tick labels of its colour bar, from the top down.
PANELS = [
    {
        'name': 'uv_a1',
        'crop': (3300, 500, 4100, 2500),
        'values': [0.5, 0.0, -0.5],
        'note': 'jet map, tick labels 5, 0, -5 with the factor 1e-1'
    },
    {
        'name': 'uv_a2',
        'crop': (6550, 500, 7300, 2500),
        'values': [0.5, 0.0, -0.5],
        'note': 'jet map, tick labels 5, 0, -5 with the factor 1e-1'
    },
    {
        'name': 'uv_a3',
        'crop': (9800, 500, 10700, 2500),
        'values': [1e-6, 0.0],
        'note': 'diverging map, tick labels 1 and 0 with the factor 1e-6'
    },
    {
        'name': 'uv_b1',
        'crop': (3300, 2900, 4100, 5050),
        'values': [-0.06, -0.07],
        'note': 'jet map, tick labels -6 and -7 with the factor 1e-2'
    }
]


def source_files(arxiv_id):
    """The files of the source package of a paper."""
    r = requests.get('https://arxiv.org/e-print/' + arxiv_id, timeout=300, headers=UA)
    r.raise_for_status()
    raw = r.content
    out = []
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as tf:
            for m in tf.getmembers():
                if m.isfile():
                    out.append((m.name, tf.extractfile(m).read()))
        return out
    except tarfile.ReadError:
        pass
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for name in zf.namelist():
                out.append((name, zf.read(name)))
        return out
    except Exception:
        return []


def find_figure(files, wanted):
    for name, data in files:
        if os.path.basename(name) == wanted:
            return data
    return None


def measure_bar(img, near_x, min_chroma=50):
    """The rectangle of the colour bar closest to `near_x`."""
    rgb = np.asarray(img.convert('RGB')).astype(np.int16)
    h, w = rgb.shape[:2]
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    limit = max(4, int(h * 0.25))
    vivid_cols = (chroma > min_chroma).sum(axis=0)
    columns = np.where(vivid_cols > limit)[0]
    if not len(columns):
        return None
    blocks = []
    start = last = columns[0]
    for c in columns[1:]:
        if c - last > 4:
            blocks.append((start, last))
            start = c
        last = c
    blocks.append((start, last))
    x0, x1 = min(blocks, key=lambda b: abs((b[0] + b[1]) // 2 - near_x))
    vivid_rows = (chroma[:, x0:x1 + 1] > min_chroma).sum(axis=1)
    rows = np.where(vivid_rows > max(2, (x1 - x0 + 1) // 2))[0]
    return {'x': int(x0), 'w': int(x1 - x0 + 1), 'y': int(rows[0]), 'h': int(rows[-1] - rows[0] + 1)}


def label_blocks(img, bar, gap=25, span=170, min_dark=2):
    """The vertical centre of every label next to the bar."""
    rgb = np.asarray(img.convert('RGB')).astype(np.int16)
    h, w = rgb.shape[:2]
    x0 = bar['x'] + bar['w'] + gap
    x1 = min(w, x0 + span)
    y0 = max(0, bar['y'] - 40)
    y1 = min(h, bar['y'] + bar['h'] + 40)
    if x1 <= x0 or y1 <= y0:
        return []
    region = rgb[y0:y1, x0:x1]
    dark = (region.max(axis=2) < 120)
    rows = dark.sum(axis=1)
    blocks = []
    start = None
    for i, n in enumerate(rows):
        if n >= min_dark and start is None:
            start = i
        elif n < min_dark and start is not None:
            blocks.append((start, i))
            start = None
    if start is not None:
        blocks.append((start, len(rows)))
    out = []
    for a, b in blocks:
        if out and a - out[-1][1] <= 6:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return [(y0 + (a + b) // 2, b - a) for a, b in out if (b - a) >= 20]


def main():
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    print('fetching the source of %s' % PAPER)
    files = source_files(PAPER)
    data = find_figure(files, FIGURE)
    if not data:
        print('the figure %s was not found in the source package' % FIGURE)
        sys.exit(1)
    source = os.path.join(OUT, '%s__%s' % (PAPER, FIGURE))
    if not os.path.exists(source):
        with open(source, 'wb') as fh:
            fh.write(data)
    img = Image.open(source)
    img.load()
    print('%s  %dx%d' % (FIGURE, img.size[0], img.size[1]))

    figures = []
    for panel in PANELS:
        crop = img.crop(panel['crop'])
        path = os.path.join(OUT, '%s.png' % panel['name'])
        crop.save(path)
        # The colour bar is the vivid block next to the figure. The panel is
        # measured by looking for it, so the truth does not depend on the
        # numbers in this file being right.
        bar = measure_bar(crop, crop.size[0] * 0.52)
        if not bar:
            print('  %s: no colour bar found' % panel['name'])
            continue
        labels = label_blocks(crop, bar)
        if len(labels) != len(panel['values']):
            print('  %s: %d labels but %d values, skipped' % (
                panel['name'], len(labels), len(panel['values'])))
            continue
        anchors = []
        for (centre, size), value in zip(labels, panel['values']):
            t = 1.0 - (centre - bar['y']) / float(bar['h'])
            anchors.append({'t': round(t, 5), 'value': value, 'labelY': centre})
        print('  %-8s bar x=%d y=%d w=%d h=%d  %d ticks  %s' % (
            panel['name'], bar['x'], bar['y'], bar['w'], bar['h'],
            len(anchors), panel['note']))
        figures.append({
            'file': '%s.png' % panel['name'],
            'paper': PAPER,
            'title': PAPER_TITLE,
            'url': PAPER_URL,
            'kind': 'colourbar',
            'bar': bar,
            'anchors': anchors,
            'note': panel['note']
        })

    with open(os.path.join(OUT, 'truth.json'), 'w') as fh:
        json.dump({'figures': figures}, fh, indent=2)
    print('wrote %s with %d figures' % (os.path.join(OUT, 'truth.json'), len(figures)))


if __name__ == '__main__':
    main()

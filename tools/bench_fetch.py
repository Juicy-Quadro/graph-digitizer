#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Collect real figures from arXiv papers for the benchmark.

The figures of the papers are taken from the source package, so the original
files are used and not a rasterised copy of the page. Every figure is
scaled down so that the collection stays manageable.

    python tools/bench_fetch.py --count 400

The figures land in testdata/bench/figures/ and the papers in
testdata/bench/papers.json.
"""

import argparse
import io
import json
import os
import re
import sys
import tarfile
import time
import zipfile

import requests
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'testdata', 'bench')
FIGURES = os.path.join(OUT, 'figures')
API = 'http://export.arxiv.org/api/query'
UA = {'User-Agent': 'graph-digitizer-benchmark/1.0'}
MAX_SIDE = 1400
MIN_SIDE = 260

# Categories whose figures tend to hold a curve or a colour map.
CATEGORIES = [
    'astro-ph.IM', 'astro-ph.GA', 'cs.LG', 'cs.CV', 'physics.flu-dyn',
    'math.OC', 'eess.IV', 'q-bio.PE', 'cond-mat.stat-mech', 'physics.optics',
    'stat.ML', 'nlin.CD', 'hep-ex', 'astro-ph.SR', 'cs.DB'
]


def search(categories, wanted, since='20240101'):
    """The addresses of the newest papers of the given categories."""
    found = []
    query = ' OR '.join('cat:' + c for c in categories)
    query = '(%s) AND submittedDate:[%s TO 20260101]' % (query, since)
    page = 0
    while len(found) < wanted:
        params = {
            'search_query': query,
            'max_results': 100,
            'start': page * 100,
            'sortBy': 'submittedDate',
            'sortOrder': 'descending'
        }
        r = requests.get(API, params=params, timeout=90, headers=UA)
        r.raise_for_status()
        entries = re.findall(r'<entry>(.*?)</entry>', r.text, re.S)
        if not entries:
            break
        for block in entries:
            idm = re.search(r'<id>http://arxiv\.org/abs/([^<]+)</id>', block)
            tm = re.search(r'<title>(.*?)</title>', block, re.S)
            cm = re.search(r'<arxiv:primary_category[^>]*term="([^"]+)"', block)
            if not idm:
                continue
            title = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', tm.group(1))).strip() if tm else ''
            found.append({
                'id': idm.group(1),
                'title': title,
                'category': cm.group(1) if cm else ''
            })
        page += 1
        time.sleep(3.0)
        if page > 12:
            break
    return found[:wanted]


def source_files(arxiv_id):
    r = requests.get('https://arxiv.org/e-print/' + arxiv_id, timeout=300, headers=UA)
    r.raise_for_status()
    raw = r.content
    out = []
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as tf:
            for m in tf.getmembers():
                if m.isfile() and not m.name.endswith(('.tex', '.sty', '.cls', '.bib', '.bbl')):
                    out.append((m.name, tf.extractfile(m).read()))
        return out
    except tarfile.ReadError:
        pass
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            for name in zf.namelist():
                if not name.endswith(('.tex', '.sty', '.cls', '.bib', '.bbl')):
                    out.append((name, zf.read(name)))
        return out
    except Exception:
        return []


def rasterise_pdf(data, dpi=150):
    import fitz
    doc = fitz.open(stream=data, filetype='pdf')
    pages = []
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        pages.append(Image.open(io.BytesIO(pix.tobytes('png'))))
    doc.close()
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--count', type=int, default=400, help='how many figures to collect')
    ap.add_argument('--papers', type=int, default=140, help='how many papers to walk through')
    args = ap.parse_args()

    if not os.path.isdir(FIGURES):
        os.makedirs(FIGURES)

    papers = search(CATEGORIES, args.papers)
    print('%d papers' % len(papers))
    kept = []
    figures = 0
    for n, paper in enumerate(papers):
        if figures >= args.count:
            break
        try:
            files = source_files(paper['id'])
        except Exception as exc:
            print('  %s -> %s' % (paper['id'], exc))
            time.sleep(1.0)
            continue
        stem = paper['id'].replace('/', '_')
        for name, data in files:
            if figures >= args.count:
                break
            base = os.path.basename(name)
            low = base.lower()
            if low.endswith(('.tex', '.sty', '.cls', '.bib', '.bbl', '.txt', '.dat', '.csv')):
                continue
            try:
                if low.endswith('.pdf'):
                    pages = rasterise_pdf(data)
                elif low.endswith(('.png', '.jpg', '.jpeg')):
                    pages = [Image.open(io.BytesIO(data))]
                else:
                    continue
            except Exception:
                continue
            for i, img in enumerate(pages):
                if figures >= args.count:
                    break
                try:
                    img.load()
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    w, h = img.size
                    if min(w, h) < MIN_SIDE:
                        continue
                    if max(w, h) > MAX_SIDE:
                        scale = MAX_SIDE / float(max(w, h))
                        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))),
                                         Image.LANCZOS)
                    out = os.path.join(FIGURES, '%s__%s__%d.jpg' % (stem, os.path.splitext(base)[0][:40], i))
                    img.save(out, 'JPEG', quality=88)
                except Exception:
                    continue
                figures += 1
                kept.append({
                    'file': os.path.basename(out),
                    'paper': paper['id'],
                    'title': paper['title'],
                    'category': paper['category'],
                    'url': 'https://arxiv.org/abs/' + paper['id']
                })
        if (n + 1) % 10 == 0:
            print('  %d papers -> %d figures' % (n + 1, figures))
            with open(os.path.join(OUT, 'papers.json'), 'w') as fh:
                json.dump(kept, fh, indent=2)
        time.sleep(1.2)

    with open(os.path.join(OUT, 'papers.json'), 'w') as fh:
        json.dump(kept, fh, indent=2)
    print('%d figures from %d papers' % (figures, len(papers)))
    print('wrote ' + os.path.join(OUT, 'papers.json'))


if __name__ == '__main__':
    main()

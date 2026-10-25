#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build ground truth fixtures for the JavaScript test suite.

For every GetData sample figure the workspace file stores the points that
GetData itself extracted. The stored coordinates live in an unknown unit, so
the scale is recovered by looking for the factor under which all reference
points share (almost) the same colour - that only happens when they really
sit on the curve.
"""

import json
import os
import re

import numpy as np
from PIL import Image

SAMPLES = [
    ("sample1.jpg", "sample1.gdw"),
    ("sample2.tif", "sample2.gdw"),
    ("sample3.pcx", "sample3.gdw"),
]
GRAPHS = r"C:\Program Files (x86)\GetData\graphs"
WS = r"C:\Program Files (x86)\GetData\workspaces"
OUT = r"C:\Users\Diaoyibi\Desktop\test\graph-digitizer\testdata"


def parse_gdw(path):
    xml = open(path, encoding="utf-8").read()
    lines = []
    for chunk in xml.split("<Line>")[1:]:
        if "</Line>" not in chunk:
            break
        body = chunk.split("</Line>")[0]
        nums = []
        for m in re.finditer(r"<Points[^>]*>([^<]*)</Points>", body):
            nums += [float(v) for v in m.group(1).split(",")]
        if not nums:
            continue
        cap = re.search(r"<Caption>([^<]*)</Caption>", body)
        lines.append({
            "caption": cap.group(1) if cap else "",
            "points": [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        })
    cal = {}
    for k in ("Xmin", "Xmax", "Ymin", "Ymax"):
        m = re.search(r"<%s[^>]*>([^<]*)</%s>" % (k, k), xml)
        if m:
            vals = [float(v) for v in m.group(1).split(",")]
            cal[k] = [vals[0], vals[1]]
    return lines, cal


def color_spread(arr, W, H, points, scale):
    """Mean colour distance of the reference points to their own median."""
    cols = []
    for (X, Y) in points:
        x = int(round(X / scale))
        y = int(round(Y / scale))
        if not (0 <= x < W and 0 <= y < H):
            return 1e9, None, 0
        cols.append(arr[y, x])
    cols = np.array(cols, dtype=float)
    med = np.median(cols, axis=0)
    d = np.sqrt(((cols - med) ** 2).sum(axis=1))
    return float(d.mean()), med.astype(int).tolist(), 0


def surroundings_contrast(arr, W, H, points, scale, med, radius=5):
    """How different the neighbourhood of the reference points is.

    A curve is a thin structure: the pixels around it belong to something
    else. Landing on a flat background region gives a contrast of zero, which
    is what separates a real hit from a false one.
    """
    if med is None:
        return 0.0
    target = np.array(med, dtype=float)
    total = []
    for (X, Y) in points:
        x = int(round(X / scale))
        y = int(round(Y / scale))
        if not (0 <= x < W and 0 <= y < H):
            return 0.0
        best = 0.0
        for angle in range(0, 360, 45):
            r = np.radians(angle)
            nx = int(round(x + radius * np.cos(r)))
            ny = int(round(y + radius * np.sin(r)))
            if 0 <= nx < W and 0 <= ny < H:
                c = arr[ny, nx].astype(float)
                best = max(best, float(np.sqrt(((c - target) ** 2).sum())))
        total.append(best)
    return float(np.mean(total))


def score_scale(arr, W, H, points, scale):
    spread, med, _ = color_spread(arr, W, H, points, scale)
    if spread > 1e8:
        return 1e9, spread, med
    contrast = surroundings_contrast(arr, W, H, points, scale, med)
    return spread - 0.5 * contrast, spread, med


def core_line_color(arr, W, H, points, scale, radius=2):
    """The colour of the stroke itself.

    Reference points usually sit on the anti-aliased edge of the stroke, so
    the local neighbourhood is searched for the pixel that is furthest from the
    background - that is the core of the line.
    """
    bg = np.median(arr.reshape(-1, 3), axis=0)
    picks = []
    for (X, Y) in points:
        x = int(round(X / scale))
        y = int(round(Y / scale))
        best = None
        bestd = -1
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H:
                    c = arr[ny, nx].astype(float)
                    d = float(np.sqrt(((c - bg) ** 2).sum()))
                    if d > bestd:
                        bestd = d
                        best = arr[ny, nx]
        if best is not None:
            picks.append(best)
    if not picks:
        return [0, 0, 0]
    return [int(v) for v in np.median(np.array(picks), axis=0)]


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []

    for img_name, gdw_name in SAMPLES:
        img_path = os.path.join(GRAPHS, img_name)
        gdw_path = os.path.join(WS, gdw_name)
        if not (os.path.exists(img_path) and os.path.exists(gdw_path)):
            print("skip", img_name)
            continue

        im = Image.open(img_path).convert("RGB")
        W, H = im.size
        arr = np.asarray(im).astype(int)
        xml = open(gdw_path, encoding="utf-8").read()
        lines, cal = parse_gdw(gdw_path)
        if not lines:
            continue

        # Recover the scale for every line independently. All lines live in the
        # same coordinate space, so the scales must agree; when they do not,
        # that line simply cannot be matched to the shipped thumbnail.
        scales = []
        for li, line in enumerate(lines):
            pts = line["points"]
            if len(pts) < 4:
                scales.append(None)
                continue
            b = None
            for scale in np.arange(1.0, 40.0, 0.05):
                score, spread, med = score_scale(arr, W, H, pts, float(scale))
                if b is None or score < b[0]:
                    b = (score, float(scale), spread, med)
            for scale in np.arange(max(1.0, b[1] - 0.06), b[1] + 0.06, 0.005):
                score, spread, med = score_scale(arr, W, H, pts, float(scale))
                if score < b[0]:
                    b = (score, float(scale), spread, med)
            scales.append(b[1])

        # Every line lives in the same coordinate space, so one scale applies
        # to all of them. Per line estimates are only used to find it.
        good = [s for s in scales if s]
        scale = float(np.median(good)) if good else 1.0
        scale_index = int(np.argmax([len(l["points"]) for l in lines]))
        target = lines[scale_index]["points"]

        # Per line colour and points, all expressed with the shared scale.
        line_entries = []
        for line in lines:
            col = core_line_color(arr, W, H, line["points"], scale)
            line_entries.append({
                "caption": line["caption"],
                "lineColor": col,
                "points": [[X / scale, Y / scale] for (X, Y) in line["points"]]
            })

        core = core_line_color(arr, W, H, target, scale)
        contrast = surroundings_contrast(arr, W, H, target, scale, core)
        print("              per line estimates: %s -> shared scale=%.3f  contrast=%.1f  core=%s"
              % (", ".join("%.2f" % s if s else "n/a" for s in scales), scale, contrast, core))

        fixture = {
            "image": img_name,
            "width": W,
            "height": H,
            "scale": scale,
            "scaleIndex": scale_index,
            "lineColor": core,
            "lines": line_entries
        }
        # The workspace also stores the four calibration points with their
        # logical values, in the same coordinate space.
        if len(cal) == 4:
            fixture["calibration"] = {
                "xScale": "log" if "<XScale>logarithmic" in xml else "linear",
                "yScale": "log" if "<YScale>logarithmic" in xml else "linear",
                "points": {}
            }
            for k, raw in cal.items():
                m = re.search(r"<%s[^>]*>([^<]*)</%s>" % (k, k), xml)
                vals = [float(v) for v in m.group(1).split(",")]
                fixture["calibration"]["points"][k.lower()] = {
                    "x": raw[0] / scale,
                    "y": raw[1] / scale,
                    "value": vals[2]
                }
        with open(os.path.join(OUT, os.path.splitext(img_name)[0] + "-truth.json"), "w") as fh:
            json.dump(fixture, fh, indent=1)

        rgba = im.convert("RGBA").tobytes()
        with open(os.path.join(OUT, os.path.splitext(img_name)[0] + ".rgba"), "wb") as fh:
            fh.write(rgba)

        manifest.append({
            "image": img_name,
            "truth": os.path.splitext(img_name)[0] + "-truth.json",
            "rgba": os.path.splitext(img_name)[0] + ".rgba",
            "width": W, "height": H, "scale": scale, "lineColor": core
        })

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print("\nwrote", len(manifest), "fixtures")


if __name__ == "__main__":
    main()

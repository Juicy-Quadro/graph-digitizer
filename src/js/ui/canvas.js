/*
 * Canvas viewport.
 *
 * Responsibilities:
 *   - draw the figure, the detection mask overlay, the calibration markers,
 *     the sampling region and the digitised points
 *   - convert between image and screen coordinates
 *   - emit normalised pointer events for the app layer
 *
 * The view transform is `screen = image * zoom + offset` with the offset
 * expressed in device independent pixels.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const G = GD.Geometry;

  function createCanvasView(canvas, options) {
    const opt = options || {};
    const ctx = canvas.getContext('2d');
    const handlers = {};

    /* Mask overlay options are mutable: the inspector drives them live. */
    const maskOpts = {
      showMask: opt.showMask !== false,
      maskOpacity: opt.maskOpacity === undefined ? 0.45 : opt.maskOpacity
    };

    let image = null;            // { imageData, width, height, name }
    let maskInfo = null;
    let maskCanvas = null;
    let maskToken = null;
    let calibration = null;
    let calibPoints = null;
    let series = [];
    let activeSeries = 0;
    let areaRegion = null;
    let areaOptions = null;
    let barRegion = null;      // the colour bar of a contour map
    let barAnchors = [];       // the known values along the bar
    let barOrientation = 'vertical';
    let calibMode = null;        // { key, stage }
    let hoverPoint = -1;
    /*
     * The table owns the selection. The canvas mirrors it per series so a
     * stale index can never highlight a different point: the entry of a
     * series is dropped as soon as its point list changes and the indices
     * are clamped to the current point count.
     */
    const selectionBySeries = new Map();
    const NO_SELECTION = new Set();

    const view = { zoom: 1, offsetX: 0, offsetY: 0 };
    let dpr = window.devicePixelRatio || 1;

    function on(event, fn) {
      (handlers[event] || (handlers[event] = [])).push(fn);
    }

    function emit(event, payload) {
      (handlers[event] || []).forEach((fn) => fn(payload));
    }

    // ------------------------------------------------------------ geometry

    function imageToScreen(x, y) {
      return { x: x * view.zoom + view.offsetX, y: y * view.zoom + view.offsetY };
    }

    function screenToImage(x, y) {
      return { x: (x - view.offsetX) / view.zoom, y: (y - view.offsetY) / view.zoom };
    }

    function cssSize() {
      const rect = canvas.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    }

    function resize() {
      const size = cssSize();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(size.w * dpr));
      canvas.height = Math.max(1, Math.round(size.h * dpr));
      render();
    }

    function fit() {
      if (!image) return;
      const size = cssSize();
      const pad = 28;
      const zoom = Math.min(
        (size.w - pad * 2) / image.width,
        (size.h - pad * 2) / image.height
      );
      view.zoom = Math.max(0.02, Math.min(40, zoom));
      view.offsetX = (size.w - image.width * view.zoom) / 2;
      view.offsetY = (size.h - image.height * view.zoom) / 2;
      render();
      emit('view', Object.assign({}, view));
    }

    function zoomBy(factor, anchor) {
      const size = cssSize();
      const ax = anchor ? anchor.x : size.w / 2;
      const ay = anchor ? anchor.y : size.h / 2;
      const before = screenToImage(ax, ay);
      view.zoom = Math.max(0.02, Math.min(40, view.zoom * factor));
      view.offsetX = ax - before.x * view.zoom;
      view.offsetY = ay - before.y * view.zoom;
      render();
      emit('view', Object.assign({}, view));
    }

    function setZoom(zoom, anchor) {
      const size = cssSize();
      const ax = anchor ? anchor.x : size.w / 2;
      const ay = anchor ? anchor.y : size.h / 2;
      const before = screenToImage(ax, ay);
      view.zoom = Math.max(0.02, Math.min(40, zoom));
      view.offsetX = ax - before.x * view.zoom;
      view.offsetY = ay - before.y * view.zoom;
      render();
      emit('view', Object.assign({}, view));
    }

    // ------------------------------------------------------------ painting

    function theme(name) {
      const styles = getComputedStyle(document.documentElement);
      const v = (n, fallback) => (styles.getPropertyValue(n) || fallback).trim();
      return {
        accent: v('--accent', '#4c8dff'),
        text: v('--text', '#e6edf7'),
        dim: v('--text-dim', '#9aa7b8'),
        faint: v('--text-faint', '#6b7889'),
        warn: v('--warn', '#f0b429'),
        danger: v('--danger', '#f06255'),
        ok: v('--ok', '#37c98b'),
        panel: v('--bg-panel', '#151b25'),
        border: v('--border', '#232c3a')
      };
    }

    function buildMaskCanvas(accent) {
      if (!maskInfo) {
        maskCanvas = null;
        maskToken = null;
        return;
      }
      const colour = accent || theme().accent;
      const { mask, width, height } = maskInfo;
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const octx = off.getContext('2d');
      const img = octx.createImageData(width, height);
      const d = img.data;
      const r = parseInt(colour.slice(1, 3), 16);
      const g = parseInt(colour.slice(3, 5), 16);
      const b = parseInt(colour.slice(5, 7), 16);
      for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
        if (!mask[i]) continue;
        d[p] = r;
        d[p + 1] = g;
        d[p + 2] = b;
        d[p + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      maskCanvas = off;
      maskToken = colour;
    }

    function render() {
      const size = cssSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);

      // The mask overlay bakes in the accent colour, so it has to be rebuilt
      // whenever the theme changes.
      if (maskInfo && maskToken !== theme().accent) buildMaskCanvas();

      if (!image) {
        renderCalibOverlay(size);
        return;
      }

      ctx.save();
      ctx.translate(view.offsetX, view.offsetY);
      ctx.scale(view.zoom, view.zoom);
      ctx.imageSmoothingEnabled = view.zoom < 3;

      ctx.drawImage(image.canvas, 0, 0);

      if (maskCanvas && maskOpts.showMask && maskOpts.maskOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = maskOpts.maskOpacity;
        // Normal alpha compositing keeps the overlay readable on light *and*
        // dark figures; a multiply blend would darken the curve into a black
        // background instead of tinting it.
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.restore();
      }

      renderArea(size);
      renderBar();
      ctx.restore();

      renderCalibOverlay(size);
      renderPoints(size);
    }

    function renderArea(size) {
      if (!areaRegion) return;
      const t = theme();
      const segs = areaOptions
        ? GD.Area.previewSegments(areaRegion, calibration, areaOptions)
        : [];
      ctx.save();
      ctx.lineWidth = 1 / view.zoom;
      ctx.strokeStyle = t.warn;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      for (const s of segs) {
        ctx.beginPath();
        ctx.moveTo(s.p0.x, s.p0.y);
        ctx.lineTo(s.p1.x, s.p1.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = t.warn;
      ctx.lineWidth = 1.5 / view.zoom;
      const th = (areaRegion.rotation * Math.PI) / 180;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const corner = (lx, ly) => ({
        x: areaRegion.cx + lx * c - ly * s,
        y: areaRegion.cy + lx * s + ly * c
      });
      ctx.beginPath();
      const p0 = corner(-areaRegion.hw, -areaRegion.hh);
      const p1 = corner(areaRegion.hw, -areaRegion.hh);
      const p2 = corner(areaRegion.hw, areaRegion.hh);
      const p3 = corner(-areaRegion.hw, areaRegion.hh);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    /**
     * The colour bar of a contour map. The frame shows what was picked and
     * the small marks show where the known values sit, so a wrong reading is
     * visible at once instead of only in the exported numbers.
     */
    function renderBar() {
      if (!barRegion) return;
      const t = theme();
      ctx.save();
      ctx.lineWidth = 2 / view.zoom;
      ctx.strokeStyle = t.accent;
      const x = barRegion.x;
      const y = barRegion.y;
      const w = barRegion.w;
      const h = barRegion.h;
      ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeStyle = t.warn;
      for (const a of barAnchors) {
        if (!a || !isFinite(a.t)) continue;
        if (barOrientation === 'horizontal') {
          const ax = x + a.t * w;
          ctx.beginPath();
          ctx.moveTo(ax, y - 6 / view.zoom);
          ctx.lineTo(ax, y + h + 6 / view.zoom);
          ctx.stroke();
        } else {
          const ay = y + (1 - a.t) * h;
          ctx.beginPath();
          ctx.moveTo(x - 6 / view.zoom, ay);
          ctx.lineTo(x + w + 6 / view.zoom, ay);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    function renderCalibOverlay(size) {
      const t = theme();
      if (!calibPoints) return;
      const order = ['xmin', 'xmax', 'ymin', 'ymax'];
      const colors = { xmin: t.accent, xmax: t.accent, ymin: t.ok, ymax: t.ok };
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Axis guides.
      if (calibPoints.xmin && calibPoints.xmax) {
        const a = imageToScreen(calibPoints.xmin.x, calibPoints.xmin.y);
        const b = imageToScreen(calibPoints.xmax.x, calibPoints.xmax.y);
        ctx.strokeStyle = t.accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (calibPoints.ymin && calibPoints.ymax) {
        const a = imageToScreen(calibPoints.ymin.x, calibPoints.ymin.y);
        const b = imageToScreen(calibPoints.ymax.x, calibPoints.ymax.y);
        ctx.strokeStyle = t.ok;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      for (const key of order) {
        const p = calibPoints[key];
        if (!p) continue;
        const s = imageToScreen(p.x, p.y);
        const active = calibMode && calibMode.key === key;
        ctx.beginPath();
        ctx.arc(s.x, s.y, active ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = active ? t.warn : colors[key];
        ctx.globalAlpha = active ? 1 : 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = t.panel;
        ctx.stroke();

        ctx.font = '600 10px ' + getComputedStyle(document.body).fontFamily;
        ctx.fillStyle = t.dim;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(key.toUpperCase(), s.x, s.y - 9);
      }
      ctx.restore();
    }

    /**
     * The selection of one series, clamped to its current point count.
     * Indices outside the range are dropped so a stale index can never
     * highlight a different point.
     */
    function selectionFor(index) {
      const set = selectionBySeries.get(index);
      if (!set || !set.size) return NO_SELECTION;
      const line = series[index];
      const count = line ? (line.points || []).length : 0;
      let clamped = null;
      set.forEach((i) => {
        if (i >= 0 && i < count) {
          if (!clamped) clamped = new Set();
          clamped.add(i);
        }
      });
      return clamped || NO_SELECTION;
    }

    function renderPoints(size) {
      const t = theme();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const palette = ['#4c8dff', '#f0625f', '#37c98b', '#f0b429', '#a78bfa', '#22b8cf'];
      const activeSel = selectionFor(activeSeries);

      series.forEach((line, li) => {
        const pts = line.points || [];
        if (!pts.length) return;
        const isActive = li === activeSeries;
        const color = line.color || palette[li % palette.length];

        if (isActive) {
          // Connect consecutive points with a polyline.
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          pts.forEach((p, i) => {
            const s = imageToScreen(p.px !== undefined ? p.px : p.x, p.py !== undefined ? p.py : p.y);
            if (i === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
          });
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        const radius = isActive ? 3 : 2;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const s = imageToScreen(p.px !== undefined ? p.px : p.x, p.py !== undefined ? p.py : p.y);
          const isSel = isActive && activeSel.has(i);
          ctx.beginPath();
          ctx.arc(s.x, s.y, isSel ? radius + 1.6 : radius, 0, Math.PI * 2);
          ctx.fillStyle = isSel ? t.warn : color;
          ctx.globalAlpha = isActive ? 1 : 0.4;
          ctx.fill();
          ctx.globalAlpha = 1;
          if (isSel) {
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = t.panel;
            ctx.stroke();
          }
          if (isActive && i === hoverPoint) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, radius + 3.5, 0, Math.PI * 2);
            ctx.strokeStyle = t.warn;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      });
      ctx.restore();
    }

    // ------------------------------------------------------------ pointers

    /*
     * A click is a gesture in screen space, so the press and the release are
     * compared in screen pixels. Measuring the distance in image pixels made
     * the classification depend on the zoom level: a 40 screen pixel drag
     * looked like a click when zoomed in and a 1 screen pixel jitter looked
     * like a drag when zoomed out.
     */
    const CLICK_SLOP = 3;

    let dragging = false;
    let dragStart = null;
    let spaceDown = false;
    let panning = false;

    function localPoint(evt) {
      const rect = canvas.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', (evt) => {
      const p = localPoint(evt);
      const img = screenToImage(p.x, p.y);
      const wantsPan = evt.button === 1 || spaceDown || (evt.button === 0 && opt.tool === 'select' && !spaceDown && evt.altKey);
      if (wantsPan) {
        panning = true;
        dragStart = { x: p.x, y: p.y, offsetX: view.offsetX, offsetY: view.offsetY };
        try { canvas.setPointerCapture(evt.pointerId); } catch (e) { void e; }
        canvas.parentElement.classList.add('panning');
        return;
      }
      if (evt.button !== 0) return;
      dragging = true;
      dragStart = { img: img, screen: p };
      try { canvas.setPointerCapture(evt.pointerId); } catch (e) { void e; }
      emit('pointerdown', { image: img, screen: p, event: evt });
    });

    canvas.addEventListener('pointermove', (evt) => {
      const p = localPoint(evt);
      const img = screenToImage(p.x, p.y);
      if (panning && dragStart) {
        view.offsetX = dragStart.offsetX + (p.x - dragStart.x);
        view.offsetY = dragStart.offsetY + (p.y - dragStart.y);
        render();
        emit('view', Object.assign({}, view));
        return;
      }
      if (dragging && dragStart) {
        emit('drag', { image: img, screen: p, origin: dragStart.img, start: dragStart.screen, event: evt });
      }
      emit('cursor', { image: img, screen: p });
    });

    function endPointer(evt) {
      const p = localPoint(evt);
      const img = screenToImage(p.x, p.y);
      if (panning) {
        panning = false;
        dragStart = null;
        canvas.parentElement.classList.remove('panning');
        try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { void e; }
        return;
      }
      if (dragging) {
        dragging = false;
        const origin = dragStart ? dragStart.img : { x: img.x, y: img.y };
        const startScreen = dragStart ? dragStart.screen : p;
        // Screen space distance: the same pointer movement classifies the
        // same way at every zoom level.
        const moved = G.dist(p, startScreen);
        dragStart = null;
        try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { void e; }
        if (moved <= CLICK_SLOP) {
          emit('click', { image: img, screen: p, event: evt });
        } else {
          emit('dragend', { image: img, screen: p, origin: origin, event: evt });
        }
      }
    }

    canvas.addEventListener('pointerup', endPointer);

    /*
     * A cancelled pointer is an aborted gesture: it must not be reported as a
     * finished click, otherwise a cancelled calibration or data point would
     * be created.
     */
    canvas.addEventListener('pointercancel', (evt) => {
      if (panning) {
        panning = false;
        dragStart = null;
        canvas.parentElement.classList.remove('panning');
      } else {
        dragging = false;
        dragStart = null;
      }
      try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { void e; }
    });

    canvas.addEventListener('wheel', (evt) => {
      evt.preventDefault();
      const p = localPoint(evt);
      const factor = evt.ctrlKey ? 1.04 : 1.12;
      const delta = evt.deltaY < 0 ? factor : 1 / factor;
      zoomBy(delta, p);
      emit('cursor', { image: screenToImage(p.x, p.y), screen: p });
    }, { passive: false });

    canvas.addEventListener('pointerleave', () => {
      emit('cursor', null);
    });

    window.addEventListener('keydown', (evt) => {
      if (evt.code === 'Space' && !spaceDown) {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          spaceDown = true;
          canvas.parentElement.classList.add('panning');
        }
      }
    });
    window.addEventListener('keyup', (evt) => {
      if (evt.code === 'Space') {
        spaceDown = false;
        canvas.parentElement.classList.remove('panning');
      }
    });
    window.addEventListener('blur', () => {
      spaceDown = false;
      canvas.parentElement.classList.remove('panning');
    });

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas.parentElement);

    // ------------------------------------------------------------ public API

    return {
      canvas,
      view,
      on,
      emit,
      render,
      resize,
      fit,
      zoomBy,
      setZoom,
      imageToScreen,
      screenToImage,

      setImage(img) {
        image = img;
        maskInfo = null;
        maskCanvas = null;
        render();
      },
      getImage() {
        return image;
      },
      setMask(info) {
        maskInfo = info;
        buildMaskCanvas();
        render();
      },
      setMaskOptions(patch) {
        Object.assign(maskOpts, patch || {});
        render();
      },
      setCalibration(calib, points) {
        calibration = calib;
        calibPoints = points;
        render();
      },
      setCalibMode(mode) {
        calibMode = mode;
        render();
      },
      setSeries(list, active) {
        const next = list || [];
        const nextActive = active || 0;
        // The point list of a series changed: its indices no longer address
        // the same points, so the selection of that series is dropped.
        next.forEach((line, i) => {
          const prev = series[i];
          const prevPoints = prev ? prev.points : null;
          const nextPoints = line.points || null;
          if (!prev || prevPoints !== nextPoints) {
            selectionBySeries.delete(i);
          }
        });
        // Switching series starts a new selection.
        if (nextActive !== activeSeries) {
          selectionBySeries.delete(nextActive);
        }
        series = next;
        activeSeries = nextActive;
        // Forget the series that no longer exist.
        Array.from(selectionBySeries.keys()).forEach((key) => {
          if (key >= series.length) selectionBySeries.delete(key);
        });
        render();
      },
      setSelected(sel) {
        const line = series[activeSeries];
        const count = line ? (line.points || []).length : 0;
        const next = new Set();
        (sel || []).forEach((i) => {
          const n = Number(i);
          if (isFinite(n) && n >= 0 && n < count) next.add(n);
        });
        // Only one series carries a selection: the table owns it, so the
        // other series lose theirs.
        Array.from(selectionBySeries.keys()).forEach((key) => {
          if (key !== activeSeries) selectionBySeries.delete(key);
        });
        selectionBySeries.set(activeSeries, next);
        render();
      },
      setHoverPoint(index) {
        if (hoverPoint === index) return;
        hoverPoint = index;
        render();
      },
      setArea(region, options) {
        areaRegion = region;
        areaOptions = options;
        render();
      },
      setBar(region, anchors, orientation) {
        barRegion = region;
        barAnchors = anchors || [];
        barOrientation = orientation === 'horizontal' ? 'horizontal' : 'vertical';
        render();
      },
      getView() {
        return Object.assign({}, view);
      },
      setView(v) {
        Object.assign(view, v);
        render();
      }
    };
  }

  GD.createCanvasView = createCanvasView;
})(typeof window !== 'undefined' ? window : globalThis);

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
    let calibMode = null;        // { key, stage }
    let hoverPoint = -1;
    let selected = new Set();

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

    function buildMaskCanvas() {
      if (!maskInfo) {
        maskCanvas = null;
        maskToken = null;
        return;
      }
      const t = theme();
      const { mask, width, height } = maskInfo;
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const octx = off.getContext('2d');
      const img = octx.createImageData(width, height);
      const d = img.data;
      const r = parseInt(t.accent.slice(1, 3), 16);
      const g = parseInt(t.accent.slice(3, 5), 16);
      const b = parseInt(t.accent.slice(5, 7), 16);
      for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
        if (!mask[i]) continue;
        d[p] = r;
        d[p + 1] = g;
        d[p + 2] = b;
        d[p + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      maskCanvas = off;
      maskToken = t.accent;
    }

    function render() {
      const size = cssSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);

      if (!image) {
        renderCalibOverlay(size);
        return;
      }

      ctx.save();
      ctx.translate(view.offsetX, view.offsetY);
      ctx.scale(view.zoom, view.zoom);
      ctx.imageSmoothingEnabled = view.zoom < 3;

      ctx.drawImage(image.canvas, 0, 0);

      if (maskCanvas && opt.showMask && opt.maskOpacity > 0) {
        ctx.save();
        ctx.globalAlpha = opt.maskOpacity;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.restore();
      }

      renderArea(size);
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

    function renderPoints(size) {
      const t = theme();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const palette = ['#4c8dff', '#f0625f', '#37c98b', '#f0b429', '#a78bfa', '#22b8cf'];

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
          const isSel = isActive && selected.has(i);
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
        const moved = dragStart ? G.dist({ x: img.x, y: img.y }, origin) : 0;
        dragStart = null;
        try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { void e; }
        if (moved < 2) {
          emit('click', { image: img, screen: p, event: evt });
        } else {
          emit('dragend', { image: img, screen: p, origin: origin, event: evt });
        }
      }
    }

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

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
        series = list || [];
        activeSeries = active || 0;
        render();
      },
      setSelected(sel) {
        selected = sel || new Set();
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

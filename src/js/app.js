/*
 * Application wiring.
 *
 * Connects the store, the canvas viewport, the data table, the native menu
 * and the keyboard to the digitising algorithms.
 */
(function () {
  'use strict';

  const GD = window.GD;
  const { I18n, createStore, Geometry, Calibration, Mask, Trace, Area, Exporters } = GD;
  const t = (key, params) => I18n.t(key, params);

  const store = createStore();

  /** Watches the operating system colour scheme. */
  const systemThemeMedia = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : { matches: false, addEventListener: null };

  // ------------------------------------------------------------------ DOM

  const el = {
    app: document.getElementById('app'),
    stage: document.getElementById('stage'),
    canvas: document.getElementById('canvas'),
    emptyState: document.getElementById('empty-state'),
    stageHint: document.getElementById('stage-hint'),
    zoomLabel: document.getElementById('zoom-label'),
    toolrail: document.getElementById('toolrail'),
    inspector: document.getElementById('inspector'),
    drawer: document.getElementById('drawer'),
    tableWrap: document.getElementById('table-wrap'),
    dataBody: document.getElementById('data-body'),
    dataTable: document.getElementById('data-table'),
    tableEmpty: document.getElementById('table-empty'),
    seriesTabs: document.getElementById('series-tabs'),
    toasts: document.getElementById('toasts'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    statusTool: document.getElementById('status-tool'),
    statusCursor: document.getElementById('status-cursor'),
    statusLogical: document.getElementById('status-logical'),
    statusCount: document.getElementById('status-count'),
    calibState: document.getElementById('calib-state'),
    langSwitch: document.getElementById('lang-switch'),

    // calibration
    calibRows: Array.from(document.querySelectorAll('[data-calib]')),
    calibXScale: document.getElementById('calib-xscale'),
    calibYScale: document.getElementById('calib-yscale'),

    // sampling
    sampleMethod: document.getElementById('sample-method'),
    sampleTolerance: document.getElementById('sample-tolerance'),
    tolValue: document.getElementById('tol-value'),
    sampleMinSize: document.getElementById('sample-minsize'),
    sampleThickness: document.getElementById('sample-thickness'),
    lineColor: document.getElementById('line-color'),
    lineColorHex: document.getElementById('line-color-hex'),
    bgColor: document.getElementById('bg-color'),
    bgColorHex: document.getElementById('bg-color-hex'),
    showMask: document.getElementById('show-mask'),
    maskOpacity: document.getElementById('mask-opacity'),
    opacityValue: document.getElementById('opacity-value'),

    // trace
    traceDirection: document.getElementById('trace-direction'),
    traceMaxGap: document.getElementById('trace-maxgap'),
    traceSpacing: document.getElementById('trace-spacing'),
    traceSmooth: document.getElementById('trace-smooth'),
    smoothValue: document.getElementById('smooth-value'),

    // area
    areaMode: document.getElementById('area-mode'),
    areaSpacing: document.getElementById('area-spacing'),
    areaOffset: document.getElementById('area-offset'),
    areaPlacement: document.getElementById('area-placement'),
    areaRotation: document.getElementById('area-rotation'),

    // export
    exportFormat: document.getElementById('export-format'),
    exportDelimiter: document.getElementById('export-delimiter'),
    exportDecimals: document.getElementById('export-decimals')
  };

  // ------------------------------------------------------------------ state

  let image = null;          // { canvas, imageData, width, height, name }
  let maskInfo = null;
  let calibration = null;
  let calibPending = null;   // { key, step }
  let tracePending = null;   // { x, y } first click of a directional trace
  let areaDrag = null;       // { start, current }
  let maskTimer = null;
  let view = null;

  const canvasView = GD.createCanvasView(el.canvas, {
    tool: 'select',
    showMask: true,
    maskOpacity: 0.45
  });
  view = canvasView;

  const table = GD.createDataTable({
    tbody: el.dataBody,
    wrap: el.tableWrap,
    table: el.dataTable,
    emptyEl: el.tableEmpty,
    onSelect: (sel) => {
      canvasView.setSelected(sel);
      updateStatus();
    },
    onDelete: (index) => {
      store.pushUndo();
      store.removePoints([index]);
      toast(t('msg.pointRemoved'), 'ok');
    },
    onEdit: (index, field, value) => {
      store.pushUndo();
      const s = store.state;
      const series = s.series.slice();
      const points = series[s.activeSeries].points.slice();
      const p = points[index];
      const next = { x: p.x, y: p.y };
      next[field] = value;
      // Move the marker with the number: the canvas draws from the pixel
      // position, so it has to follow the edited value.
      let px = p.px;
      let py = p.py;
      if (calibration && calibration.ok && p.px !== undefined && p.py !== undefined) {
        const back = calibration.toPixel(next.x, next.y);
        px = back.x;
        py = back.y;
      }
      points[index] = Object.assign({}, p, { x: next.x, y: next.y, px: px, py: py });
      series[s.activeSeries] = Object.assign({}, series[s.activeSeries], { points: points });
      store.set({ series: series });
      renderSeriesTabs();
      renderTable();
    }
  });

  // ------------------------------------------------------------------ toast

  function toast(message, kind) {
    if (!message) return;
    const node = document.createElement('div');
    node.className = 'toast' + (kind ? ' ' + kind : '');
    node.textContent = message;
    el.toasts.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity .2s';
      setTimeout(() => node.remove(), 220);
    }, 2600);
  }

  /** Set by a modal that offers an explicit confirm action. */
  let modalConfirm = null;

  function showModal(title, bodyHtml, onReady) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = bodyHtml;
    const actions = el.modalBackdrop.querySelector('.modal-actions');
    actions.innerHTML = '';
    modalConfirm = null;

    if (onReady) {
      const ok = document.createElement('button');
      ok.className = 'primary';
      ok.textContent = t('action.apply');
      ok.setAttribute('data-action', 'modal-confirm');
      actions.appendChild(ok);
    }
    const close = document.createElement('button');
    close.className = 'ghost';
    close.textContent = t('action.close');
    close.setAttribute('data-action', 'modal-close');
    actions.appendChild(close);

    el.modalBackdrop.hidden = false;
    if (onReady) onReady(el.modalBody);
  }

  function hideModal() {
    el.modalBackdrop.hidden = true;
  }

  /** Settings dialog: language and theme, both applied immediately. */
  function showSettings() {
    const lang = store.state.ui.language;
    const theme = store.state.ui.theme;
    el.modalTitle.textContent = t('settings.title');
    el.modalBody.innerHTML =
      '<div class="settings-block">' +
      '<div class="settings-label">' + escapeHtml(t('settings.language')) + '</div>' +
      '<div class="settings-row">' +
      '<label><input type="radio" name="set-lang" value="en"' + (lang === 'en' ? ' checked' : '') + '> English</label>' +
      '<label><input type="radio" name="set-lang" value="zh"' + (lang === 'zh' ? ' checked' : '') + '> 简体中文</label>' +
      '</div></div>' +
      '<div class="settings-block">' +
      '<div class="settings-label">' + escapeHtml(t('settings.theme')) + '</div>' +
      '<div class="settings-row">' +
      '<label><input type="radio" name="set-theme" value="auto"' + (theme === 'auto' ? ' checked' : '') + '> ' + escapeHtml(t('settings.theme.auto')) + '</label>' +
      '<label><input type="radio" name="set-theme" value="dark"' + (theme === 'dark' ? ' checked' : '') + '> ' + escapeHtml(t('settings.theme.dark')) + '</label>' +
      '<label><input type="radio" name="set-theme" value="light"' + (theme === 'light' ? ' checked' : '') + '> ' + escapeHtml(t('settings.theme.light')) + '</label>' +
      '</div>' +
      '<p class="hint">' + escapeHtml(t('settings.themeHint')) + '</p>' +
      '</div>' +
      '<p class="hint">' + escapeHtml(t('settings.applyNow')) + '</p>';

    el.modalBody.querySelectorAll('input[name="set-lang"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        setLanguage(radio.value);
        el.modalTitle.textContent = t('settings.title');
      });
    });
    el.modalBody.querySelectorAll('input[name="set-theme"]').forEach((radio) => {
      radio.addEventListener('change', () => setTheme(radio.value));
    });
    el.modalBackdrop.hidden = false;
  }

  // ------------------------------------------------------------------ i18n

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.getAttribute('data-i18n-title'));
    });
    document.title = t('app.name');
    el.statusTool.textContent = t('tool.' + store.state.ui.tool);
    el.stageHint.textContent = t('tool.' + store.state.ui.tool + '.hint');
    renderCalibPanel();
    renderSeriesTabs();
    renderTable();
    updateStatus();
    applyTheme();
  }

  function setLanguage(lang, persist) {
    I18n.setLanguage(lang);
    store.setUi({ language: lang });
    document.documentElement.setAttribute('data-theme', store.state.ui.theme);
    el.langSwitch.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
    if (window.gd && window.gd.setMenuLanguage) window.gd.setMenuLanguage(lang);
    if (persist !== false) {
      try { localStorage.setItem('gd.language', lang); } catch (e) { void e; }
    }
    applyI18n();
  }

  /** Chinese UI when the operating system is Chinese, English otherwise. */
  function detectLanguage() {
    try {
      const saved = localStorage.getItem('gd.language');
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) { void e; }
    const lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return lang.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  // ---------------------------------------------------------------- theme

  const THEME_CYCLE = ['auto', 'light', 'dark'];

  /** Last colour scheme reported by the operating system. */
  let lastSystemTheme = null;

  function systemTheme() {
    if (lastSystemTheme) return lastSystemTheme;
    return systemThemeMedia.matches ? 'dark' : 'light';
  }

  /** Apply the current theme preference and keep the native frame in sync. */
  function applyTheme() {
    const pref = store.state.ui.theme;
    const actual = pref === 'auto' ? systemTheme() : pref;
    document.documentElement.setAttribute('data-theme', actual);

    const btn = document.querySelector('[data-action="toggle-theme"]');
    if (btn) {
      btn.setAttribute('data-theme-mode', pref);
      btn.title = t('settings.theme') + ': ' + t('settings.theme.' + pref);
    }
    if (window.gd && window.gd.setTitleBarColor) {
      window.gd.setTitleBarColor(
        actual === 'dark' ? '#11151c' : '#f4f6fa',
        actual === 'dark' ? '#8b97a8' : '#62708a'
      );
    }
    if (window.gd && window.gd.setMenuTheme) window.gd.setMenuTheme(pref);
    return actual;
  }

  function setTheme(pref) {
    if (THEME_CYCLE.indexOf(pref) < 0) pref = 'auto';
    store.setUi({ theme: pref });
    try { localStorage.setItem('gd.theme', pref); } catch (e) { void e; }
    applyTheme();
  }

  function detectTheme() {
    try {
      const saved = localStorage.getItem('gd.theme');
      if (THEME_CYCLE.indexOf(saved) >= 0) return saved;
    } catch (e) { void e; }
    return 'auto';
  }

  // ------------------------------------------------------------------ colour

  function rgbToHex(c) {
    return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex) {
    const v = hex.replace('#', '');
    return [
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16)
    ];
  }

  // ------------------------------------------------------------------ mask

  function scheduleMaskUpdate() {
    if (maskTimer) clearTimeout(maskTimer);
    maskTimer = setTimeout(recomputeMask, 90);
  }

  /**
   * Apply a pending sampling change right now. Without this the tracer can
   * run against the mask the user was looking at before they changed a
   * parameter.
   */
  function flushMaskUpdate() {
    if (!maskTimer) return;
    clearTimeout(maskTimer);
    maskTimer = null;
    recomputeMask();
  }

  function recomputeMask() {
    maskTimer = null;
    if (!image) {
      maskInfo = null;
      canvasView.setMask(null);
      return;
    }
    const s = store.state.sampling;
    maskInfo = Mask.buildMask(image.imageData, {
      method: s.method,
      lineColor: s.lineColor,
      bgColor: s.bgColor,
      tolerance: s.tolerance,
      minSize: s.minSize,
      thickness: s.thickness
    });
    canvasView.setMask(maskInfo);
    updateStatus();
  }

  // ------------------------------------------------------------------ calibration

  function buildCalibration() {
    const s = store.state.calibration;
    const result = Calibration.create(s.points, {
      xScale: s.xScale,
      yScale: s.yScale
    });
    calibration = result;
    canvasView.setCalibration(result.ok ? result : null, s.points);
    renderCalibPanel();
    return result;
  }

  /**
   * Re-derive the logical coordinates of every digitised point from the pixel
   * position it was taken at. Without this the table and every export would
   * keep showing numbers that belong to the previous calibration.
   */
  function recomputePointValues() {
    if (!calibration || !calibration.ok) return false;
    const series = store.state.series.map((line) => ({
      ...line,
      points: (line.points || []).map((p) => {
        if (p.px === undefined || p.py === undefined) return p;
        const l = calibration.toLogical(p.px, p.py);
        return Object.assign({}, p, { x: l.x, y: l.y });
      })
    }));
    store.set({ series });
    renderSeriesTabs();
    renderTable();
    return true;
  }

  function renderCalibPanel() {
    const s = store.state.calibration;
    el.calibRows.forEach((row) => {
      const key = row.getAttribute('data-calib');
      const pt = s.points[key];
      const pxCell = row.querySelector('.px-val');
      const input = row.querySelector('.calib-value');
      if (pt) {
        pxCell.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
        row.classList.remove('pending');
        if (document.activeElement !== input) input.value = pt.value;
      } else {
        pxCell.textContent = '—';
        row.classList.add('pending');
        if (document.activeElement !== input) input.value = '';
      }
    });
    el.calibXScale.value = s.xScale;
    el.calibYScale.value = s.yScale;

    const result = calibration || buildCalibration();
    if (!result.ok) {
      const missing = result.missing
        ? t('calib.pending', { point: result.missing.toUpperCase() })
        : calibrationErrorText(result.error);
      el.calibState.textContent = missing;
      el.calibState.classList.remove('ok');
    } else {
      el.calibState.textContent = '✓';
      el.calibState.classList.add('ok');
    }
  }

  function calibrationErrorText(code) {
    switch (code) {
      case Calibration.CalibrationError.COLLINEAR: return t('msg.calibCollinear');
      case Calibration.CalibrationError.X_COINCIDE:
      case Calibration.CalibrationError.Y_COINCIDE: return t('msg.calibCoincide');
      case Calibration.CalibrationError.LOG_NEGATIVE: return t('msg.calibLog');
      default: return t('msg.calibIncomplete');
    }
  }

  function setCalibPoint(key, x, y) {
    const s = store.state.calibration;
    const points = Object.assign({}, s.points);
    const prev = points[key];
    const value = prev && isFinite(prev.value) ? prev.value : defaultValueFor(key);
    points[key] = { x: x, y: y, value: value };
    store.setIn('calibration', { points: points });
    buildCalibration();
    recomputePointValues();
  }

  function defaultValueFor(key) {
    return (key === 'xmax' || key === 'ymax') ? 1 : 0;
  }

  // ------------------------------------------------------------------ series

  function renderSeriesTabs() {
    const s = store.state;
    el.seriesTabs.innerHTML = '';
    s.series.forEach((line, i) => {
      const chip = document.createElement('button');
      chip.className = 'series-chip' + (i === store.state.activeSeries ? ' active' : '');
      chip.setAttribute('data-index', String(i));
      chip.innerHTML =
        `<span class="dot" style="background:${line.color || 'currentColor'}"></span>` +
        `<span class="nm"></span>` +
        `<span class="cnt">${(line.points || []).length}</span>`;
      chip.querySelector('.nm').textContent = line.name;
      chip.title = t('series.active');
      chip.addEventListener('click', () => {
        store.setActiveSeries(i);
        renderSeriesTabs();
        renderTable();
      });
      el.seriesTabs.appendChild(chip);
    });
  }

  /** Rename a series through the in-app dialog (Electron has no window.prompt). */
  function renameSeries(index) {
    const line = store.state.series[index];
    if (!line) return;
    showModal(t('series.rename'),
      `<input type="text" id="series-name-input" maxlength="80" />`,
      (body) => {
        const input = body.querySelector('#series-name-input');
        input.value = line.name;
        input.focus();
        input.select();
        input.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
            commitSeriesRename(index, input.value);
            hideModal();
          }
        });
        modalConfirm = () => commitSeriesRename(index, input.value);
      });
  }

  function commitSeriesRename(index, name) {
    const value = String(name || '').trim();
    const line = store.state.series[index];
    if (!line || !value || value === line.name) return;
    store.pushUndo();
    const series = store.state.series.slice();
    series[index] = Object.assign({}, series[index], { name: value });
    store.set({ series: series });
    renderSeriesTabs();
  }

  function renderTable() {
    const s = store.state;
    const series = s.series[s.activeSeries];
    table.setPoints(series ? series.points : []);
    canvasView.setSeries(s.series, s.activeSeries);
  }

  // ------------------------------------------------------------------ status

  function updateStatus(cursor) {
    const s = store.state;
    el.statusTool.textContent = t('tool.' + s.ui.tool);
    el.zoomLabel.textContent = Math.round(view.getView().zoom * 100) + '%';
    const series = s.series[s.activeSeries];
    const count = series ? series.points.length : 0;
    el.statusCount.textContent = t('status.points', { n: count });
    if (cursor) {
      el.statusCursor.textContent = `px ${cursor.image.x.toFixed(0)}, ${cursor.image.y.toFixed(0)}`;
      if (calibration && calibration.ok) {
        const l = calibration.toLogical(cursor.image.x, cursor.image.y);
        el.statusLogical.textContent = `xy ${formatCoord(l.x)}, ${formatCoord(l.y)}`;
      } else {
        el.statusLogical.textContent = 'xy —';
      }
    }
  }

  function formatCoord(v) {
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(4);
    return String(Math.round(v * 1e6) / 1e6);
  }

  // ------------------------------------------------------------------ tools

  function setTool(tool) {
    store.setUi({ tool: tool });
    el.toolrail.querySelectorAll('.tool').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });
    el.stage.className = 'stage tool-' + tool;
    el.statusTool.textContent = t('tool.' + tool);
    el.stageHint.textContent = t('tool.' + tool + '.hint');
    canvasView.emit('view', view.getView());
    if (tool !== 'trace') tracePending = null;
    if (tool !== 'scale') {
      calibPending = null;
      canvasView.setCalibMode(null);
      renderCalibPanel();
    }
  }

  const CALIB_ORDER = ['xmin', 'xmax', 'ymin', 'ymax'];

  function handleClick(payload) {
    const tool = store.state.ui.tool;
    const { image: pt } = payload;

    if (tool === 'scale') {
      if (!calibPending) {
        calibPending = { key: CALIB_ORDER[0], step: 0 };
      }
      const key = CALIB_ORDER[calibPending.step];
      store.pushUndo();
      setCalibPoint(key, pt.x, pt.y);
      calibPending.step += 1;
      if (calibPending.step >= CALIB_ORDER.length) {
        calibPending = null;
        canvasView.setCalibMode(null);
        toast(t('calib.hint'), 'ok');
      } else {
        canvasView.setCalibMode({ key: CALIB_ORDER[calibPending.step] });
      }
      return;
    }

    if (tool === 'lineColor' || tool === 'bgColor') {
      const color = samplePixel(pt);
      if (!color) return;
      const s = store.state.sampling;
      if (tool === 'lineColor') {
        store.setIn('sampling', { lineColor: color });
        el.lineColor.value = rgbToHex(color);
      } else {
        store.setIn('sampling', { bgColor: color });
        el.bgColor.value = rgbToHex(color);
      }
      void s;
      scheduleMaskUpdate();
      return;
    }

    if (tool === 'trace') {
      runTrace(pt);
      return;
    }

    if (tool === 'point') {
      if (!calibration || !calibration.ok) {
        toast(t('msg.calibNeeded'), 'error');
        return;
      }
      const l = calibration.toLogical(pt.x, pt.y);
      store.pushUndo();
      store.addPoint(store.state.activeSeries, { x: l.x, y: l.y, px: pt.x, py: pt.y });
      toast(t('msg.pointAdded'), 'ok');
      return;
    }

    if (tool === 'erase') {
      const hit = findPointAt(pt);
      if (hit >= 0) {
        store.pushUndo();
        store.removePoints([hit]);
        toast(t('msg.pointRemoved'), 'ok');
      }
      return;
    }
  }

  function handleDrag(payload) {
    if (store.state.ui.tool !== 'area') return;
    areaDrag = { start: payload.origin, current: payload.image };
    drawAreaPreview();
  }

  function drawAreaPreview() {
    if (!areaDrag) {
      canvasView.setArea(store.state.area.region, areaOptions());
      return;
    }
    const rect = rectFromDrag(areaDrag.start, areaDrag.current, store.state.area.rotation);
    canvasView.setArea(rect, areaOptions());
  }

  function rectFromDrag(a, b, rotation) {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const hw = Math.abs(b.x - a.x) / 2;
    const hh = Math.abs(b.y - a.y) / 2;
    return { cx, cy, hw, hh, rotation: rotation || 0 };
  }

  function handleDragEnd(payload) {
    if (store.state.ui.tool !== 'area' || !areaDrag) return;
    const rect = rectFromDrag(areaDrag.start, payload.image, store.state.area.rotation);
    areaDrag = null;
    // One gesture, one undo entry: the snapshot covers both the region and
    // the points it produces.
    store.pushUndo();
    store.setIn('area', { region: rect });
    canvasView.setArea(rect, areaOptions());
    runAreaSampling(false);
  }

  function areaOptions() {
    const a = store.state.area;
    return {
      mode: a.mode,
      spacing: a.spacing,
      offset: a.offset,
      placement: a.placement,
      rotation: a.rotation
    };
  }

  function samplePixel(pt) {
    if (!image) return null;
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    const p = (y * image.width + x) * 4;
    return [image.imageData.data[p], image.imageData.data[p + 1], image.imageData.data[p + 2]];
  }

  function findPointAt(pt) {
    const series = store.state.series[store.state.activeSeries];
    if (!series) return -1;
    const radius = 8 / view.getView().zoom;
    for (let i = series.points.length - 1; i >= 0; i--) {
      const p = series.points[i];
      const px = p.px !== undefined ? p.px : p.x;
      const py = p.py !== undefined ? p.py : p.y;
      if (Math.hypot(px - pt.x, py - pt.y) <= radius) return i;
    }
    return -1;
  }

  // ------------------------------------------------------------------ tracing

  function runTrace(pt) {
    if (!image) {
      toast(t('msg.noImage'), 'error');
      return;
    }
    flushMaskUpdate();
    if (!maskInfo) recomputeMask();

    const s = store.state.trace;
    if (s.direction === 'forward' && !tracePending) {
      tracePending = { x: pt.x, y: pt.y };
      toast(t('tool.trace.hint'));
      return;
    }

    const start = tracePending || pt;
    const hint = tracePending ? pt : null;
    tracePending = null;

    const result = Trace.trace(maskInfo, start, {
      direction: s.direction,
      hint: hint,
      maxGap: s.maxGap,
      smoothRadius: s.smooth,
      spacing: s.spacing,
      simplifyEpsilon: s.spacing > 0 ? 0 : 0.35
    });

    if (!result.ok) {
      toast(result.reason === 'no_curve' ? t('msg.noCurve') : t('msg.tooShort'), 'error');
      return;
    }

    const pts = result.points.map((p) => {
      const l = calibration && calibration.ok
        ? calibration.toLogical(p.x, p.y)
        : { x: p.x, y: p.y };
      return { x: l.x, y: l.y, px: p.x, py: p.y };
    });

    store.pushUndo();
    store.setSeriesPoints(store.state.activeSeries, pts);
    toast(t('msg.traced', { n: pts.length }), 'ok');
    if (result.truncated) {
      // The tracer stopped at a safety limit; the curve is incomplete and
      // the user has to know.
      toast(t('msg.truncated', { n: pts.length }), 'error');
    }
  }

  function runAreaSampling(recordUndo) {
    const region = store.state.area.region;
    if (!region) return;
    flushMaskUpdate();
    if (!maskInfo) recomputeMask();
    const results = Area.digitizeArea(maskInfo, region, calibration, areaOptions());
    if (!results.length) {
      toast(t('msg.noCurve'), 'error');
      return;
    }
    if (recordUndo !== false) store.pushUndo();
    store.setSeriesPoints(store.state.activeSeries, results);
    toast(t('msg.areaDone', { n: results.length }), 'ok');
  }

  // ------------------------------------------------------------------ image

  async function openImage() {
    if (!window.gd) return;
    let picked = null;
    try {
      picked = await window.gd.openImage();
      if (!picked) return;
      await loadImageFromDataURL(picked.dataURL, picked.name, picked.path);
    } catch (err) {
      const name = picked && picked.name ? picked.name : '';
      const message = /\.tiff?$/i.test(name)
        ? t('msg.tiffUnsupported')
        : (err && err.message ? err.message : String(err));
      toast(message, 'error');
    }
  }

  /**
   * A new figure invalidates the calibration and every point that was
   * digitised from the previous one - they are pixel coordinates of the old
   * image. Clear them instead of silently exporting them under the new name.
   */
  function resetDigitizingState() {
    const area = store.state.area;
    store.set({
      calibration: {
        points: { xmin: null, xmax: null, ymin: null, ymax: null },
        xScale: 'linear',
        yScale: 'linear'
      },
      area: {
        mode: area.mode,
        spacing: area.spacing,
        offset: area.offset,
        placement: area.placement,
        rotation: area.rotation,
        region: null
      },
      series: [{ id: 'series-' + Date.now().toString(36), name: 'Series 1', color: null, points: [] }],
      activeSeries: 0
    });
    buildCalibration();
    renderSeriesTabs();
    renderTable();
    canvasView.setArea(null, areaOptions());
  }

  function loadImageFromDataURL(dataURL, name, path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        image = {
          canvas: canvas,
          imageData: imageData,
          width: canvas.width,
          height: canvas.height,
          name: name || 'image',
          path: path || null
        };
        store.set({
          image: { name: image.name, width: image.width, height: image.height, path: image.path }
        });
        resetDigitizingState();
        el.emptyState.hidden = true;
        canvasView.setImage(image);
        canvasView.fit();
        recomputeMask();
        toast(t('msg.imageLoaded', {
          name: image.name, w: image.width, h: image.height
        }), 'ok');
        resolve();
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = dataURL;
    });
  }

  // ------------------------------------------------------------------ export

  function exportOptions() {
    const decimals = Number(el.exportDecimals.value) || 6;
    return {
      decimals: decimals,
      delimiter: el.exportDelimiter.value === '\\t' ? '\t' : el.exportDelimiter.value,
      withHeader: true
    };
  }

  const EXPORT_META = {
    csv: { ext: 'csv', name: 'CSV', filters: [{ name: 'CSV', extensions: ['csv'] }] },
    txt: { ext: 'txt', name: 'Text', filters: [{ name: 'Text', extensions: ['txt'] }] },
    xls: { ext: 'xls', name: 'Excel XML', filters: [{ name: 'Excel (XML)', extensions: ['xls'] }] },
    xml: { ext: 'xml', name: 'XML', filters: [{ name: 'XML', extensions: ['xml'] }] },
    json: { ext: 'json', name: 'JSON', filters: [{ name: 'JSON', extensions: ['json'] }] },
    svg: { ext: 'svg', name: 'SVG', filters: [{ name: 'SVG', extensions: ['svg'] }] },
    dxf: { ext: 'dxf', name: 'DXF', filters: [{ name: 'DXF', extensions: ['dxf'] }] },
    eps: { ext: 'eps', name: 'EPS', filters: [{ name: 'EPS', extensions: ['eps'] }] }
  };

  async function exportData() {
    const s = store.state;
    // The payload contains every series, so the guard must ask whether any
    // series holds data - not only the active one.
    const hasData = s.series.some((line) => (line.points || []).length > 0);
    if (!hasData) {
      toast(t('table.empty'), 'error');
      return;
    }
    const format = el.exportFormat.value;
    const meta = EXPORT_META[format];
    let content;
    try {
      content = Exporters.exportData(format, store.exportPayload(), exportOptions());
    } catch (err) {
      toast(String(err && err.message ? err.message : err), 'error');
      return;
    }
    if (!window.gd) return;
    const base = (image ? image.name.replace(/\.[^.]+$/, '') : 'graph');
    const res = await window.gd.saveText({
      title: t('action.export'),
      defaultPath: base + '-data.' + meta.ext,
      filters: meta.filters,
      content: content
    });
    if (res) toast(t('msg.exported', { file: res.name }), 'ok');
  }

  async function copyData() {
    const s = store.state;
    const series = s.series[s.activeSeries];
    if (!series || !series.points.length) {
      toast(t('table.empty'), 'error');
      return;
    }
    const text = Exporters.toTXT(store.exportPayload(), {
      decimals: Number(el.exportDecimals.value) || 6,
      separator: '\t',
      withHeader: true
    });
    if (window.gd) await window.gd.writeClipboard(text);
    else if (navigator.clipboard) await navigator.clipboard.writeText(text);
    toast(t('msg.copied'), 'ok');
  }

  // ------------------------------------------------------------------ workspace

  async function saveWorkspace() {
    const s = store.state;
    const payload = {
      format: 'graph-digitizer/workspace',
      version: 1,
      image: s.image,
      calibration: s.calibration,
      sampling: s.sampling,
      trace: s.trace,
      area: s.area,
      series: s.series,
      activeSeries: s.activeSeries
    };
    if (!window.gd) return;
    const res = await window.gd.saveText({
      title: t('action.saveWorkspace'),
      defaultPath: (image ? image.name.replace(/\.[^.]+$/, '') : 'workspace') + '.gdw',
      filters: [{ name: 'Graph Digitizer Workspace', extensions: ['gdw'] }],
      content: JSON.stringify(payload, null, 2)
    });
    if (res) toast(t('msg.saved'), 'ok');
  }

  async function openWorkspace() {
    if (!window.gd) return;
    const res = await window.gd.openWorkspace();
    if (!res) return;
    let data;
    try {
      data = JSON.parse(res.content);
    } catch (err) {
      toast(String(err && err.message ? err.message : err), 'error');
      return;
    }
    if (!data || data.format !== 'graph-digitizer/workspace') {
      toast(t('msg.calibIncomplete'), 'error');
      return;
    }
    store.pushUndo();
    store.set({
      calibration: data.calibration || store.state.calibration,
      sampling: data.sampling || store.state.sampling,
      trace: data.trace || store.state.trace,
      area: data.area || store.state.area,
      series: data.series && data.series.length ? data.series : store.state.series,
      activeSeries: data.activeSeries || 0
    });
    syncControlsFromState();
    buildCalibration();
    recomputeMask();
    renderSeriesTabs();
    renderTable();

    // A workspace only stores a link to the original figure; reload it when
    // the file is still where it was left.
    if (data.image && data.image.path && window.gd) {
      try {
        const bytes = await window.gd.readBinary(data.image.path);
        if (bytes) {
          await loadImageFromDataURL(
            'data:image/' + (data.image.name.split('.').pop() || 'png').toLowerCase() + ';base64,' + bytes,
            data.image.name,
            data.image.path
          );
        }
      } catch (err) {
        toast(String(err && err.message ? err.message : err), 'error');
      }
    }
    toast(t('msg.loaded'), 'ok');
  }

  function syncControlsFromState() {
    const s = store.state;
    el.sampleMethod.value = s.sampling.method;
    el.sampleTolerance.value = Math.round(s.sampling.tolerance * 100);
    el.tolValue.textContent = el.sampleTolerance.value + '%';
    el.sampleMinSize.value = s.sampling.minSize;
    el.sampleThickness.value = s.sampling.thickness;
    el.lineColor.value = rgbToHex(s.sampling.lineColor);
    el.bgColor.value = rgbToHex(s.sampling.bgColor);
    el.showMask.checked = s.sampling.showMask;
    el.maskOpacity.value = Math.round(s.sampling.maskOpacity * 100);
    el.opacityValue.textContent = el.maskOpacity.value + '%';
    el.traceDirection.value = s.trace.direction;
    el.traceMaxGap.value = s.trace.maxGap;
    el.traceSpacing.value = s.trace.spacing;
    el.traceSmooth.value = s.trace.smooth;
    el.smoothValue.textContent = String(s.trace.smooth);
    el.areaMode.value = s.area.mode;
    el.areaSpacing.value = s.area.spacing;
    el.areaOffset.value = s.area.offset;
    el.areaPlacement.value = s.area.placement;
    el.areaRotation.value = s.area.rotation;
    el.calibXScale.value = s.calibration.xScale;
    el.calibYScale.value = s.calibration.yScale;
    canvasView.setArea(s.area.region, areaOptions());
  }

  // ------------------------------------------------------------------ events

  function wireToolbar() {
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (evt) => {
        evt.preventDefault();
        handleAction(btn.getAttribute('data-action'));
      });
    });

    el.toolrail.querySelectorAll('.tool').forEach((btn) => {
      btn.addEventListener('click', () => setTool(btn.getAttribute('data-tool')));
    });

    el.langSwitch.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
    });

    // Double click a series chip to rename it. The listener lives on the
    // stable container because the chips are re-rendered on every change.
    el.seriesTabs.addEventListener('dblclick', (evt) => {
      const chip = evt.target.closest('.series-chip');
      if (!chip) return;
      renameSeries(Number(chip.getAttribute('data-index')));
    });

    // calibration values
    el.calibRows.forEach((row) => {
      const key = row.getAttribute('data-calib');
      const input = row.querySelector('.calib-value');
      input.addEventListener('change', () => {
        const value = parseFloat(input.value);
        if (!isFinite(value)) return;
        const s = store.state.calibration;
        const points = Object.assign({}, s.points);
        if (!points[key]) return;
        if (points[key].value === value) return;
        store.pushUndo();
        points[key] = Object.assign({}, points[key], { value: value });
        store.setIn('calibration', { points: points });
        buildCalibration();
        recomputePointValues();
        renderTable();
      });
    });

    el.calibXScale.addEventListener('change', () => {
      if (el.calibXScale.value === store.state.calibration.xScale) return;
      store.pushUndo();
      store.setIn('calibration', { xScale: el.calibXScale.value });
      buildCalibration();
      recomputePointValues();
      renderTable();
    });
    el.calibYScale.addEventListener('change', () => {
      if (el.calibYScale.value === store.state.calibration.yScale) return;
      store.pushUndo();
      store.setIn('calibration', { yScale: el.calibYScale.value });
      buildCalibration();
      recomputePointValues();
      renderTable();
    });

    // sampling
    el.sampleMethod.addEventListener('change', () => {
      store.setIn('sampling', { method: el.sampleMethod.value });
      scheduleMaskUpdate();
    });
    el.sampleTolerance.addEventListener('input', () => {
      const v = Number(el.sampleTolerance.value);
      el.tolValue.textContent = v + '%';
      store.setIn('sampling', { tolerance: v / 100 });
      scheduleMaskUpdate();
    });
    el.sampleMinSize.addEventListener('change', () => {
      store.setIn('sampling', { minSize: Number(el.sampleMinSize.value) || 0 });
      scheduleMaskUpdate();
    });
    el.sampleThickness.addEventListener('change', () => {
      store.setIn('sampling', { thickness: Number(el.sampleThickness.value) || 0 });
      scheduleMaskUpdate();
    });
    el.lineColor.addEventListener('input', () => {
      el.lineColorHex.textContent = el.lineColor.value;
      store.setIn('sampling', { lineColor: hexToRgb(el.lineColor.value) });
      scheduleMaskUpdate();
    });
    el.bgColor.addEventListener('input', () => {
      el.bgColorHex.textContent = el.bgColor.value;
      store.setIn('sampling', { bgColor: hexToRgb(el.bgColor.value) });
      scheduleMaskUpdate();
    });
    el.showMask.addEventListener('change', () => {
      store.setIn('sampling', { showMask: el.showMask.checked });
      canvasView.setMaskOptions({ showMask: el.showMask.checked });
    });
    el.maskOpacity.addEventListener('input', () => {
      const v = Number(el.maskOpacity.value);
      el.opacityValue.textContent = v + '%';
      store.setIn('sampling', { maskOpacity: v / 100 });
      canvasView.setMaskOptions({ maskOpacity: v / 100 });
    });

    // trace
    el.traceDirection.addEventListener('change', () => {
      store.setIn('trace', { direction: el.traceDirection.value });
      // A pending first click belongs to the previous direction.
      tracePending = null;
    });
    el.traceMaxGap.addEventListener('change', () => {
      store.setIn('trace', { maxGap: Number(el.traceMaxGap.value) || 0 });
    });
    el.traceSpacing.addEventListener('change', () => {
      store.setIn('trace', { spacing: Number(el.traceSpacing.value) || 0 });
    });
    el.traceSmooth.addEventListener('input', () => {
      el.smoothValue.textContent = el.traceSmooth.value;
      store.setIn('trace', { smooth: Number(el.traceSmooth.value) });
    });

    // area
    el.areaMode.addEventListener('change', () => {
      store.setIn('area', { mode: el.areaMode.value });
      canvasView.setArea(store.state.area.region, areaOptions());
    });
    el.areaSpacing.addEventListener('change', () => {
      store.setIn('area', { spacing: Number(el.areaSpacing.value) || 1 });
      canvasView.setArea(store.state.area.region, areaOptions());
    });
    el.areaOffset.addEventListener('change', () => {
      store.setIn('area', { offset: Number(el.areaOffset.value) || 0 });
      canvasView.setArea(store.state.area.region, areaOptions());
    });
    el.areaPlacement.addEventListener('change', () => {
      store.setIn('area', { placement: el.areaPlacement.value });
    });
    el.areaRotation.addEventListener('change', () => {
      const rotation = Number(el.areaRotation.value) || 0;
      const region = store.state.area.region;
      store.setIn('area', { rotation: rotation });
      if (region) {
        store.setIn('area', { region: Object.assign({}, region, { rotation: rotation }) });
      }
      canvasView.setArea(store.state.area.region, areaOptions());
    });

    // modal
    el.modalBackdrop.addEventListener('click', (evt) => {
      const btn = evt.target.closest('[data-action]');
      if (btn) {
        const action = btn.getAttribute('data-action');
        if (action === 'modal-close') {
          modalConfirm = null;
          hideModal();
          return;
        }
        if (action === 'modal-confirm') {
          const fn = modalConfirm;
          modalConfirm = null;
          hideModal();
          if (fn) fn();
          return;
        }
      }
      if (evt.target === el.modalBackdrop) {
        modalConfirm = null;
        hideModal();
      }
    });
  }

  function handleAction(action) {
    switch (action) {
      case 'open-image': openImage(); break;
      case 'open-workspace': openWorkspace(); break;
      case 'save-workspace': saveWorkspace(); break;
      case 'export': exportData(); break;
      case 'copy': copyData(); break;
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'zoom-in': view.zoomBy(1.25); updateStatus(); break;
      case 'zoom-out': view.zoomBy(1 / 1.25); updateStatus(); break;
      case 'zoom-fit': view.fit(); updateStatus(); break;
      case 'zoom-actual': view.setZoom(1); updateStatus(); break;
      case 'toggle-mask': {
        const next = !store.state.sampling.showMask;
        el.showMask.checked = next;
        store.setIn('sampling', { showMask: next });
        canvasView.setMaskOptions({ showMask: next });
        break;
      }
      case 'toggle-theme': {
        const current = store.state.ui.theme;
        const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
        setTheme(next);
        break;
      }
      case 'auto-detect': autoDetect(); break;
      case 'calib-reset': resetCalibration(); break;
      case 'calib-pixel': pixelCalibration(); break;
      case 'clear-region': {
        store.pushUndo();
        store.setIn('area', { region: null });
        canvasView.setArea(null, areaOptions());
        break;
      }
      case 'clear-points': {
        store.pushUndo();
        store.clearPoints(store.state.activeSeries);
        toast(t('action.clear'), 'ok');
        break;
      }
      case 'add-series': {
        store.addSeries();
        renderSeriesTabs();
        renderTable();
        break;
      }
      case 'delete-points': {
        const sel = table.getSelected();
        if (sel.size) {
          store.pushUndo();
          store.removePoints(Array.from(sel));
        }
        break;
      }
      case 'select-all': {
        const series = store.state.series[store.state.activeSeries];
        if (!series) break;
        const all = new Set(series.points.map((_, i) => i));
        table.setSelected(all);
        canvasView.setSelected(all);
        break;
      }
      case 'toggle-drawer': el.drawer.classList.toggle('collapsed'); break;
      case 'shortcuts':
        showModal(t('shortcuts.title'), '<pre>' + escapeHtml(t('shortcuts.body')) + '</pre>');
        break;
      case 'settings':
        showSettings();
        break;
      case 'about':
        showModal(t('about.title'), '<p>' + escapeHtml(t('about.body')) + '</p>');
        break;
      case 'modal-close': hideModal(); break;
      default: break;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function doUndo() {
    if (store.undo()) {
      afterHistoryChange();
      toast(t('msg.undo'));
    } else {
      toast(t('msg.nothingToUndo'));
    }
  }

  function doRedo() {
    if (store.redo()) {
      afterHistoryChange();
      toast(t('msg.redo'));
    }
  }

  /**
   * Everything that has to follow a restored history entry: the calibration
   * markers, the sampling region on the canvas and the pending calibration
   * step, which would otherwise point at the wrong axis end.
   */
  function afterHistoryChange() {
    buildCalibration();
    recomputeMask();
    renderSeriesTabs();
    renderTable();
    canvasView.setArea(store.state.area.region, areaOptions());
    syncCalibStep();
  }

  /** Recompute which calibration point is expected next. */
  function syncCalibStep() {
    const points = store.state.calibration.points;
    const placed = CALIB_ORDER.filter((key) => points[key]);
    if (placed.length === 0) {
      calibPending = null;
      canvasView.setCalibMode(null);
    } else if (placed.length >= CALIB_ORDER.length) {
      calibPending = null;
      canvasView.setCalibMode(null);
    } else {
      // Find the first missing point in the expected order.
      const next = CALIB_ORDER.find((key) => !points[key]);
      calibPending = { key: next, step: placed.length };
      canvasView.setCalibMode({ key: next });
    }
    renderCalibPanel();
  }

  function autoDetect() {
    if (!image) {
      toast(t('msg.noImage'), 'error');
      return;
    }
    const guess = Mask.autoDetectColors(image.imageData);
    el.lineColor.value = rgbToHex(guess.lineColor);
    el.lineColorHex.textContent = el.lineColor.value;
    el.bgColor.value = rgbToHex(guess.bgColor);
    el.bgColorHex.textContent = el.bgColor.value;
    store.setIn('sampling', { lineColor: guess.lineColor, bgColor: guess.bgColor });
    scheduleMaskUpdate();
    toast(t('action.autoDetect'), 'ok');
  }

  function resetCalibration() {
    store.pushUndo();
    store.setIn('calibration', {
      points: { xmin: null, xmax: null, ymin: null, ymax: null }
    });
    buildCalibration();
    renderTable();
  }

  function pixelCalibration() {
    if (!image) return;
    store.pushUndo();
    store.setIn('calibration', {
      xScale: 'linear',
      yScale: 'linear',
      points: {
        xmin: { x: 0, y: 0, value: 0 },
        xmax: { x: image.width, y: 0, value: image.width },
        ymin: { x: 0, y: 0, value: 0 },
        ymax: { x: 0, y: image.height, value: image.height }
      }
    });
    buildCalibration();
    recomputePointValues();
    renderTable();
  }

  // ------------------------------------------------------------------ keyboard

  const TOOL_KEYS = {
    v: 'select', s: 'scale', l: 'lineColor', b: 'bgColor',
    t: 'trace', g: 'area', p: 'point', e: 'erase'
  };

  /** Drop an image file straight onto the canvas. */
  function wireDragAndDrop() {
    const stop = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    };
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((type) => {
      el.stage.addEventListener(type, stop, false);
    });
    el.stage.addEventListener('drop', (evt) => {
      const file = evt.dataTransfer && evt.dataTransfer.files && evt.dataTransfer.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        toast(t('msg.noImage'), 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => loadImageFromDataURL(reader.result, file.name, null);
      reader.onerror = () => toast(t('msg.noImage'), 'error');
      reader.readAsDataURL(file);
    });
  }

  function wireKeyboard() {
    window.addEventListener('keydown', (evt) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = evt.ctrlKey || evt.metaKey;

      if (mod) {
        const key = evt.key.toLowerCase();
        // While the user is typing, only the application level shortcuts stay
        // active. Copy, select all and undo have to reach the text field.
        const APP_LEVEL = ['o', 's', 'e', 'm', ','];
        if (typing && APP_LEVEL.indexOf(key) < 0) return;
        switch (key) {
          case 'z': evt.preventDefault(); evt.shiftKey ? doRedo() : doUndo(); return;
          case 'y': evt.preventDefault(); doRedo(); return;
          case 'o': evt.preventDefault(); openImage(); return;
          case 's': evt.preventDefault(); saveWorkspace(); return;
          case 'e': evt.preventDefault(); exportData(); return;
          case 'c': evt.preventDefault(); copyData(); return;
          case 'a': evt.preventDefault(); handleAction('select-all'); return;
          case 'm': evt.preventDefault(); handleAction('toggle-mask'); return;
          case ',': evt.preventDefault(); handleAction('settings'); return;
          case '0': evt.preventDefault(); view.fit(); updateStatus(); return;
          case '1': evt.preventDefault(); view.setZoom(1); updateStatus(); return;
          case '=': case '+': evt.preventDefault(); view.zoomBy(1.25); updateStatus(); return;
          case '-': evt.preventDefault(); view.zoomBy(1 / 1.25); updateStatus(); return;
          default: return;
        }
      }

      if (typing) {
        if (evt.key === 'Escape') document.activeElement.blur();
        return;
      }

      if (evt.key === 'Escape') {
        tracePending = null;
        calibPending = null;
        canvasView.setCalibMode(null);
        areaDrag = null;
        canvasView.setArea(store.state.area.region, areaOptions());
        setTool('select');
        return;
      }

      if (evt.key === 'Delete' || evt.key === 'Backspace') {
        evt.preventDefault();
        handleAction('delete-points');
        return;
      }

      if (evt.key.toLowerCase() === 'f') {
        view.fit();
        updateStatus();
        return;
      }

      const tool = TOOL_KEYS[evt.key.toLowerCase()];
      if (tool) {
        setTool(tool);
      }
    });
  }

  // ------------------------------------------------------------------ boot

  function init() {
    store.addSeries('Series 1');
    renderSeriesTabs();
    syncControlsFromState();
    buildCalibration();

    wireToolbar();
    wireKeyboard();
    wireDragAndDrop();

    canvasView.on('click', handleClick);
    canvasView.on('drag', handleDrag);
    canvasView.on('dragend', handleDragEnd);
    canvasView.on('cursor', (cursor) => updateStatus(cursor));
    canvasView.on('view', () => updateStatus());

    if (window.gd && window.gd.onMenuAction) {
      window.gd.onMenuAction((payload) => {
        switch (payload.action) {
          case 'open-image': openImage(); break;
          case 'open-workspace': openWorkspace(); break;
          case 'save-workspace': saveWorkspace(); break;
          case 'export': exportData(); break;
          case 'undo': doUndo(); break;
          case 'redo': doRedo(); break;
          case 'delete-points': handleAction('delete-points'); break;
          case 'select-all': handleAction('select-all'); break;
          case 'zoom-in': view.zoomBy(1.25); updateStatus(); break;
          case 'zoom-out': view.zoomBy(1 / 1.25); updateStatus(); break;
          case 'zoom-fit': view.fit(); updateStatus(); break;
          case 'zoom-actual': view.setZoom(1); updateStatus(); break;
          case 'toggle-mask': handleAction('toggle-mask'); break;
          case 'language': setLanguage(payload.payload); break;
          case 'theme': setTheme(payload.payload); break;
          case 'settings': handleAction('settings'); break;
          case 'shortcuts': handleAction('shortcuts'); break;
          case 'about': handleAction('about'); break;
          default: break;
        }
      });
    }

    store.subscribe((state, reason) => {
      if (reason === 'points' || reason === 'series' || reason === 'undo' || reason === 'redo') {
        renderSeriesTabs();
        renderTable();
        updateStatus();
      }
    });

    setTool('select');
    setLanguage(detectLanguage(), false);
    store.setUi({ theme: detectTheme() });
    applyTheme();

    // Follow the operating system theme for as long as the user has not
    // pinned a theme of their own. Two channels are used: the media query in
    // the renderer and the native theme notification from the main process.
    if (systemThemeMedia.addEventListener) {
      systemThemeMedia.addEventListener('change', () => {
        lastSystemTheme = systemThemeMedia.matches ? 'dark' : 'light';
        if (store.state.ui.theme === 'auto') applyTheme();
      });
    }
    if (window.gd && window.gd.onSystemTheme) {
      window.gd.onSystemTheme((theme) => {
        lastSystemTheme = theme;
        if (store.state.ui.theme === 'auto') applyTheme();
      });
    }
    lastSystemTheme = systemThemeMedia.matches ? 'dark' : 'light';

    canvasView.resize();
    setTimeout(() => canvasView.resize(), 60);

    // Test hook. Lets an automated capture script drive the application
    // without going through the native file dialogs. It is only exposed when
    // the main process starts with GD_TEST_HOOK=1, so it never ships in a
    // normal installation.
    if (window.gd && window.gd.testHookAllowed) {
      window.__gd = {
          store,
          view,
          GD,
          setTool,
          setLanguage,
          setTheme,
          applyTheme,
          systemTheme,
        lastSystemTheme: () => lastSystemTheme,
        loadImage: loadImageFromDataURL,
        calibration: () => calibration,
        maskInfo: () => maskInfo,
        recomputeMask,
        setSampling(patch) {
          store.setIn('sampling', patch);
          el.sampleMethod.value = store.state.sampling.method;
          el.sampleTolerance.value = Math.round(store.state.sampling.tolerance * 100);
          el.tolValue.textContent = el.sampleTolerance.value + '%';
          el.lineColor.value = rgbToHex(store.state.sampling.lineColor);
          el.bgColor.value = rgbToHex(store.state.sampling.bgColor);
          recomputeMask();
        },
        setCalibration(points, xScale, yScale) {
          store.pushUndo();
          store.setIn('calibration', {
            points: points,
            xScale: xScale || 'linear',
            yScale: yScale || 'linear'
          });
          buildCalibration();
          recomputePointValues();
          renderTable();
        },
        traceAt(x, y) {
          setTool('trace');
          handleClick({ image: { x: x, y: y } });
        },
        areaIn(x0, y0, x1, y1, rotation) {
          setTool('area');
          store.pushUndo();
          const rect = rectFromDrag({ x: x0, y: y0 }, { x: x1, y: y1 }, rotation || 0);
          store.setIn('area', { region: rect });
          canvasView.setArea(rect, areaOptions());
          runAreaSampling(false);
        }
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

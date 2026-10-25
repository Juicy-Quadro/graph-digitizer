/*
 * Central application state with a small undo/redo stack.
 *
 * Only the data bearing part of the state (calibration, series and the
 * sampling region) is captured by the undo stack; view and tool settings are
 * intentionally excluded because they never change the digitised result.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const UID = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const DEFAULT_STATE = {
    image: null,          // { name, width, height, dataURL }
    calibration: {
      points: {
        xmin: null, xmax: null, ymin: null, ymax: null
      },
      xScale: 'linear',
      yScale: 'linear'
    },
    sampling: {
      method: 'color',
      tolerance: 0.12,
      minSize: 2,
      thickness: 0,
      lineColor: [0, 0, 0],
      bgColor: [255, 255, 255],
      showMask: true,
      maskOpacity: 0.45
    },
    trace: {
      direction: 'both',
      maxGap: 6,
      smooth: 1,
      spacing: 0
    },
    area: {
      mode: 'pixels',
      spacing: 10,
      offset: 0,
      placement: 'center',
      rotation: 0,
      region: null
    },
    /*
     * The colour map workspace. It is kept apart from the series: a contour
     * map carries a field of values, not a list of points, so it has its own
     * calibration (the colour bar) and its own export.
     */
    grid: {
      bar: null,             // { x, y, w, h } of the colour bar in image pixels
      orientation: 'vertical',
      anchors: [],           // [{ t, value }] the known values along the bar
      scale: 'linear',       // 'linear' or 'log'
      step: 1,               // read every n-th pixel
      region: null,          // { x, y, w, h } the part of the figure to read
      useCalibration: true   // export the grid in calibrated coordinates
    },
    series: [],
    activeSeries: 0,
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
    ui: {
      tool: 'select',
      language: 'en',
      theme: 'auto',
      showMask: true
    },
    selection: []
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStore() {
    let state = clone(DEFAULT_STATE);
    const listeners = [];
    const undoStack = [];
    const redoStack = [];

    function dataSnapshot(s) {
      return JSON.stringify({
        calibration: s.calibration,
        series: s.series,
        areaRegion: s.area.region,
        activeSeries: s.activeSeries
      });
    }

    function emit(reason) {
      listeners.forEach((fn) => fn(state, reason));
    }

    const store = {
      get state() {
        return state;
      },

      subscribe(fn) {
        listeners.push(fn);
        return () => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      },

      /** Merge a patch into the state and notify listeners. */
      set(patch, reason) {
        state = Object.assign({}, state, patch);
        emit(reason || 'set');
      },

      setIn(section, patch, reason) {
        const next = Object.assign({}, state);
        next[section] = Object.assign({}, state[section], patch);
        state = next;
        emit(reason || 'set');
      },

      setUi(patch, reason) {
        const next = Object.assign({}, state);
        next.ui = Object.assign({}, state.ui, patch);
        state = next;
        emit(reason || 'ui');
      },

      /** Capture the current data state so it can be restored by undo(). */
      pushUndo() {
        undoStack.push(dataSnapshot(state));
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
      },

      undo() {
        if (!undoStack.length) return false;
        redoStack.push(dataSnapshot(state));
        const snap = JSON.parse(undoStack.pop());
        state = Object.assign({}, state, {
          calibration: snap.calibration,
          series: snap.series,
          area: Object.assign({}, state.area, { region: snap.areaRegion }),
          activeSeries: snap.activeSeries
        });
        emit('undo');
        return true;
      },

      redo() {
        if (!redoStack.length) return false;
        undoStack.push(dataSnapshot(state));
        const snap = JSON.parse(redoStack.pop());
        state = Object.assign({}, state, {
          calibration: snap.calibration,
          series: snap.series,
          area: Object.assign({}, state.area, { region: snap.areaRegion }),
          activeSeries: snap.activeSeries
        });
        emit('redo');
        return true;
      },

      canUndo() {
        return undoStack.length > 0;
      },

      canRedo() {
        return redoStack.length > 0;
      },

      // ------------------------------------------------------------ series

      addSeries(name, color) {
        store.pushUndo();
        const id = UID();
        const series = state.series.concat([{
          id,
          name: name || ('Series ' + (state.series.length + 1)),
          color: color || null,
          points: []
        }]);
        state = Object.assign({}, state, { series, activeSeries: series.length - 1 });
        emit('series');
        return id;
      },

      removeSeries(index) {
        if (state.series.length <= 1) return;
        store.pushUndo();
        const series = state.series.filter((s, i) => i !== index);
        state = Object.assign({}, state, {
          series,
          activeSeries: Math.max(0, Math.min(index, series.length - 1))
        });
        emit('series');
      },

      setActiveSeries(index) {
        if (index < 0 || index >= state.series.length) return;
        state = Object.assign({}, state, { activeSeries: index });
        emit('series');
      },

      activeSeriesObject() {
        return state.series[state.activeSeries] || null;
      },

      setSeriesPoints(index, points) {
        const series = state.series.slice();
        if (!series[index]) return;
        series[index] = Object.assign({}, series[index], { points });
        state = Object.assign({}, state, { series });
        emit('points');
      },

      addPoint(index, point) {
        const series = state.series.slice();
        if (!series[index]) return;
        series[index] = Object.assign({}, series[index], {
          points: series[index].points.concat([point])
        });
        state = Object.assign({}, state, { series });
        emit('points');
      },

      removePoints(indices) {
        const set = new Set(indices);
        const series = state.series.slice();
        if (!series[state.activeSeries]) return;
        series[state.activeSeries] = Object.assign({}, series[state.activeSeries], {
          points: series[state.activeSeries].points.filter((p, i) => !set.has(i))
        });
        state = Object.assign({}, state, { series });
        emit('points');
      },

      clearPoints(index) {
        const series = state.series.slice();
        if (!series[index]) return;
        series[index] = Object.assign({}, series[index], { points: [] });
        state = Object.assign({}, state, { series });
        emit('points');
      },

      reset() {
        state = clone(DEFAULT_STATE);
        undoStack.length = 0;
        redoStack.length = 0;
        emit('reset');
      },

      /** Payload handed to the exporters. */
      exportPayload() {
        return {
          lines: state.series.map((s) => ({
            name: s.name,
            color: s.color,
            points: s.points
          })),
          calibration: {
            xScale: state.calibration.xScale,
            yScale: state.calibration.yScale,
            points: state.calibration.points
          },
          image: state.image
            ? { name: state.image.name, width: state.image.width, height: state.image.height }
            : null
        };
      }
    };

    return store;
  }

  GD.createStore = createStore;
  GD.DEFAULT_STATE = DEFAULT_STATE;
})(typeof window !== 'undefined' ? window : globalThis);

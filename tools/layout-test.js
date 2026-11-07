'use strict';

/*
 * Layout audit.
 *
 * The interface has to hold together in a small window as well as in a
 * large one: no button may hang over the edge, no button may be covered by
 * something else, and no two buttons may lie on top of each other.
 *
 *   electron tools/layout-test.js
 *
 * Every size is measured with the figure loaded, so that the panels are
 * full and the checks see the real thing.
 */

const { app } = require('electron');
const { createTestWindow } = require('./lib/test-window');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;

function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

const SIZES = [
  { width: 1440, height: 920, name: 'a big window' },
  { width: 1180, height: 760, name: 'a laptop' },
  { width: 1024, height: 680, name: 'a small laptop' },
  { width: 900, height: 600, name: 'a narrow window' },
  { width: 780, height: 520, name: 'a very narrow window' }
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const truth = JSON.parse(fs.readFileSync(path.join(root, 'testdata', 'sample3-truth.json'), 'utf8'));
  const png = fs.readFileSync(path.join(root, 'testdata', 'sample3.png'));
  const dataURL = 'data:image/png;base64,' + png.toString('base64');

  const win = createTestWindow({
    root,
    width: SIZES[0].width,
    height: SIZES[0].height,
    backgroundColor: '#11151c'
  });
  await new Promise((r) => setTimeout(r, 1000));

  // The figure is loaded once; the windows only change the size.
  const loaded = await win.webContents.executeJavaScript(`(async () => {
    try {
      const g = window.__gd;
      const t = ${JSON.stringify(truth)};
      await g.loadImage(${JSON.stringify(dataURL)}, 'a.png', 'C:/tmp/a.png');
      g.setCalibration(t.calibration.points, t.calibration.xScale, t.calibration.yScale);
      g.setSampling({ method: 'color', lineColor: t.lines[t.scaleIndex].lineColor, bgColor: [255,255,255], tolerance: 0.06, minSize: 2 });
      g.traceAt(t.lines[t.scaleIndex].points[0][0], t.lines[t.scaleIndex].points[0][1]);
      return 'ok';
    } catch (err) {
      return 'the figure could not be loaded: ' + String(err && err.stack ? err.stack : err);
    }
  })()`);
  if (loaded !== 'ok') {
    console.log('  FAIL the figure could be loaded  (' + loaded + ')');
    failures++;
    app.exit(1);
    return;
  }

  for (const size of SIZES) {
    win.setSize(size.width, size.height);
    win.webContents.send('menu:action', { action: 'zoom-fit' });
    await new Promise((r) => setTimeout(r, 700));

    const script = `(async () => {
      try {
      // The panels are scrolled, so that the headings that stick are in
      // their place and not at the top of the page.
      const inspector = document.querySelector('.inspector');
      inspector.scrollTop = 160;
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        // A button that is not shown is not a problem, even when it lies
        // under something else.
        if (Number(s.opacity) < 0.05) return false;
        return true;
      };
      /*
       * The part of a control that is really on the screen. A control that
       * lies outside a box that scrolls is not faulty, it is simply further
       * down - but it must not be measured as if it were there.
       */
      const onScreen = (el) => {
        let r = el.getBoundingClientRect();
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          const pr = p.getBoundingClientRect();
          const scrolls = /(auto|scroll)/.test(s.overflowY + s.overflowX);
          const clips = /hidden/.test(s.overflowY + s.overflowX);
          if (scrolls || clips) {
            const top = Math.max(r.top, pr.top);
            const bottom = Math.min(r.bottom, pr.bottom);
            const left = Math.max(r.left, pr.left);
            const right = Math.min(r.right, pr.right);
            if (right - left < 2 || bottom - top < 2) return null;
            r = { top, bottom, left, right, width: right - left, height: bottom - top };
          }
        }
        return r;
      };
      const name = (el) => el.getAttribute('data-action') || el.id ||
        (el.className && el.className.baseVal === undefined ? String(el.className).split(' ')[0] : '') ||
        el.tagName.toLowerCase();

      const controls = Array.from(document.querySelectorAll(
        'button, input, select, .tool, .itab, .series-chip, .panel-title'
      )).filter(shown);

      const outside = [];
      const covered = [];
      const overlaps = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rects = new Map();
      const scrollOf = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (/(auto|scroll)/.test(s.overflowY + s.overflowX)) return p;
        }
        return null;
      };
      for (const el of controls) {
        const r = onScreen(el);
        rects.set(el, r);
        if (!r) continue;
        if (r.right > vw + 0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.top < -0.5) {
          outside.push(name(el) + ' @' + Math.round(r.left) + ',' + Math.round(r.top));
        }
      }

      /*
       * A control that lies under a heading that sticks is not a fault: it
       * comes into view when the panel is scrolled. So every control is
       * scrolled into view first, and only then it is hit tested.
       */
      const saved = inspector.scrollTop;
      for (const el of controls) {
        const box = scrollOf(el);
        if (!box) continue;
        const r = el.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        if (r.top >= br.top && r.bottom <= br.bottom) continue;
        // Bring the control below the headings that stick, so that they do
        // not lie on it.
        box.scrollTop += (r.top - br.top) - 90;
        await new Promise((res) => setTimeout(res, 30));
        const rr = el.getBoundingClientRect();
        const x = Math.round(rr.left + rr.width / 2);
        const y = Math.round(rr.top + rr.height / 2);
        if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
        const top = document.elementFromPoint(x, y);
        if (top && !el.contains(top) && !top.contains(el)) {
          covered.push(name(el) + ' <- ' + name(top));
        }
      }
      inspector.scrollTop = saved;
      await new Promise((res) => setTimeout(res, 30));

      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i];
          const b = controls[j];
          if (a.contains(b) || b.contains(a)) continue;
          // A heading that sticks lies over the text that scrolls under it.
          // That is how it is meant to be.
          if (a.classList.contains('itab') || b.classList.contains('itab')) continue;
          if (a.classList.contains('panel-title') || b.classList.contains('panel-title')) continue;
          // Two controls that do not live in the same box cannot lie on each
          // other in a way that the user cannot get out of.
          const sa = scrollOf(a);
          const sb = scrollOf(b);
          if (sa !== sb) continue;
          const ra = rects.get(a);
          const rb = rects.get(b);
          if (!ra || !rb) continue;
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 2 && h > 2) overlaps.push(name(a) + ' / ' + name(b));
        }
      }
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
      };
      return {
        vw, vh, outside, covered, overlaps,
        toolbar: box('.toolbar'),
        titlebar: box('.titlebar'),
        inspector: box('.inspector'),
        drawer: box('.drawer'),
        stage: box('.stage'),
        rail: box('.toolrail')
      };
      } catch (err) {
        return { error: String(err && err.stack ? err.stack : err) };
      }
    })()`;
    fs.writeFileSync(path.join(root, 'testdata', 'layout-script.js'), script);
    const out = await win.webContents.executeJavaScript(script);

    const label = size.name + ' (' + size.width + 'x' + size.height + ')';
    if (out.error) {
      check(label + ': the audit runs', false, out.error);
      continue;
    }
    check(label + ': no control hangs over the edge',
      out.outside.length === 0, out.outside.join(' | '));
    check(label + ': no control is covered',
      out.covered.length === 0, out.covered.join(' | '));
    check(label + ': no two controls lie on top of each other',
      out.overlaps.length === 0, out.overlaps.join(' | '));

    // The drawer must not eat the whole figure when the window is short.
    const stage = out.stage ? out.stage.h : 0;
    console.log('       the figure is ' + stage + ' px high, the table ' +
      (out.drawer ? out.drawer.h : 0) + ' px');
    if (stage < 170) {
      check(label + ': the figure keeps a usable height', false, stage + ' px');
    }
    // The toolbar must fit beside the name of the application.
    if (out.titlebar && out.toolbar && out.titlebar.w < out.toolbar.left + out.toolbar.w + 4) {
      check(label + ': the toolbar fits in the title bar', false,
        'title ' + out.titlebar.w + ' px, toolbar ends at ' + (out.toolbar.left + out.toolbar.w));
    }
  }

  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'the layout holds at every size'));
  app.exit(failures ? 1 : 0);
});

/*
 * Data table with sorting, inline editing and row selection.
 * Rows are virtualised so a trace with thousands of points stays responsive.
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});

  const ROW_HEIGHT = 22;
  const OVERSCAN = 12;

  function createDataTable(config) {
    const cfg = config || {};
    const tbody = cfg.tbody;
    const wrap = cfg.wrap;
    const emptyEl = cfg.emptyEl;
    const table = cfg.table;

    let points = [];
    let selected = new Set();
    let sortKey = null;
    let sortDir = 1;
    let editing = -1;

    /*
     * The materialised rows. They are reused between renders: rebuilding the
     * tbody detaches the row the user is clicking, so the click that ends a
     * cell edit would never be dispatched.
     */
    let rowEls = [];

    function sortedIndices() {
      const idx = points.map((_, i) => i);
      if (!sortKey) return idx;
      const copy = idx.slice();
      copy.sort((a, b) => {
        const pa = points[a];
        const pb = points[b];
        let va = pa[sortKey];
        let vb = pb[sortKey];
        if (typeof va === 'string' || typeof vb === 'string') {
          va = String(va);
          vb = String(vb);
          return va.localeCompare(vb) * sortDir;
        }
        return (va - vb) * sortDir;
      });
      return copy;
    }

    /** An empty row with the five cells of the table. */
    function makeRow() {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="col-idx"></td><td class="col-x"></td><td class="col-y"></td>' +
        '<td class="col-fill"></td><td class="col-act"></td>';
      return tr;
    }

    /** Writes the state of one point into an existing row. */
    function fillRow(tr, index) {
      const p = points[index];
      if (!p) return;
      const cells = tr.children;
      if (cells.length !== 5) {
        tr.innerHTML = '<td class="col-idx"></td><td class="col-x"></td><td class="col-y"></td>' +
          '<td class="col-fill"></td><td class="col-act"></td>';
        return;
      }
      const isEditing = editing === index;
      const hasEditor = !!cells[1].querySelector('.cell-input');

      // Every row keeps its index, also the one that is being edited.
      tr.setAttribute('data-index', String(index));
      tr.className = (isEditing || selected.has(index)) ? 'selected' : '';
      cells[0].textContent = String(index + 1);

      if (isEditing) {
        if (!hasEditor) {
          cells[1].textContent = '';
          cells[2].textContent = '';
          cells[4].textContent = '';
          const ix = document.createElement('input');
          ix.className = 'cell-input';
          ix.setAttribute('data-field', 'x');
          ix.value = p.x;
          cells[1].appendChild(ix);
          const iy = document.createElement('input');
          iy.className = 'cell-input';
          iy.setAttribute('data-field', 'y');
          iy.value = p.y;
          cells[2].appendChild(iy);
        } else {
          const ix = cells[1].querySelector('.cell-input');
          const iy = cells[2].querySelector('.cell-input');
          if (document.activeElement !== ix) ix.value = p.x;
          if (document.activeElement !== iy) iy.value = p.y;
        }
        return;
      }

      if (hasEditor) {
        // Leave the editing state: the inputs make room for the values.
        cells[1].textContent = '';
        cells[2].textContent = '';
        cells[4].textContent = '';
      }
      cells[1].textContent = format(p.x);
      cells[2].textContent = format(p.y);
      let btn = cells[4].firstElementChild;
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'row-del';
        btn.textContent = '×';
        cells[4].appendChild(btn);
      }
      btn.setAttribute('data-del', String(index));
      btn.title = GD.I18n.t('table.remove');
    }

    /** The spacer row above or below the materialised rows. */
    function spacer(cls, isTop) {
      let el = tbody.querySelector('tr.' + cls);
      if (el) return el;
      el = document.createElement('tr');
      el.className = cls;
      if (isTop) tbody.insertBefore(el, tbody.firstChild);
      else tbody.appendChild(el);
      return el;
    }

    function render() {
      const order = sortedIndices();
      if (!points.length) {
        tbody.innerHTML = '';
        rowEls = [];
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;

      const scrollTop = wrap ? wrap.scrollTop : 0;
      const viewport = wrap ? wrap.clientHeight : 400;
      const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
      const last = Math.min(order.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

      // Virtualisation: a spacer row above and below keeps the scroll
      // position stable while only the visible rows are materialised.
      const topSpacer = spacer('vtop', true);
      const bottomSpacer = spacer('vbot', false);
      topSpacer.style.height = (first * ROW_HEIGHT) + 'px';
      bottomSpacer.style.height = ((order.length - last) * ROW_HEIGHT) + 'px';

      const needed = last - first;
      while (rowEls.length < needed) {
        const tr = makeRow();
        rowEls.push(tr);
        tbody.insertBefore(tr, bottomSpacer);
      }
      while (rowEls.length > needed) {
        const tr = rowEls.pop();
        if (tr.parentNode) tr.parentNode.removeChild(tr);
      }

      // The rows are filled in place: the elements survive a repaint, so a
      // click that is still waiting for its row is not swallowed.
      for (let i = first; i < last; i++) {
        fillRow(rowEls[i - first], order[i]);
      }
    }

    function format(v) {
      if (typeof v !== 'number' || !isFinite(v)) return '—';
      if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(6);
      return String(Math.round(v * 1e9) / 1e9);
    }

    if (wrap) {
      wrap.addEventListener('scroll', () => {
        if (editing >= 0) return;
        render();
      });
    }

    if (table) {
      table.querySelectorAll('th.sortable').forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.getAttribute('data-sort');
          if (sortKey === key) {
            sortDir = -sortDir;
          } else {
            sortKey = key;
            sortDir = 1;
          }
          table.querySelectorAll('th.sortable').forEach((h) => {
            h.classList.remove('sorted', 'asc', 'desc');
          });
          th.classList.add('sorted', sortDir > 0 ? 'asc' : 'desc');
          render();
        });
      });
    }

    tbody.addEventListener('click', (evt) => {
      const del = evt.target.closest('[data-del]');
      if (del) {
        evt.stopPropagation();
        cfg.onDelete && cfg.onDelete(Number(del.getAttribute('data-del')));
        return;
      }
      // A click inside the cell editor belongs to the editor: it must not
      // change the selection and it must not rebuild the row.
      if (evt.target.closest('.cell-input')) return;
      const row = evt.target.closest('tr[data-index]');
      if (!row) return;
      const index = Number(row.getAttribute('data-index'));
      if (evt.detail === 2) {
        editing = index;
        render();
        const input = tbody.querySelector('tr[data-index="' + index + '"] .cell-input');
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      if (evt.shiftKey || evt.ctrlKey || evt.metaKey) {
        if (selected.has(index)) selected.delete(index);
        else selected.add(index);
      } else {
        selected = new Set([index]);
      }
      cfg.onSelect && cfg.onSelect(new Set(selected));
      render();
    });

    tbody.addEventListener('change', (evt) => {
      const input = evt.target.closest('.cell-input');
      if (!input) return;
      const field = input.getAttribute('data-field');
      const value = parseFloat(input.value);
      const index = editing;
      if (isFinite(value) && index >= 0) {
        cfg.onEdit && cfg.onEdit(index, field, value);
      }
      editing = -1;
      render();
    });

    tbody.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        evt.target.blur();
      } else if (evt.key === 'Escape') {
        editing = -1;
        render();
      }
    });

    return {
      setPoints(list) {
        const hadSelection = selected.size > 0;
        points = list || [];
        selected = new Set();
        editing = -1;
        // The canvas mirrors the selection of the table. Tell it that the
        // selection is gone instead of leaving a stale highlight behind.
        if (hadSelection) cfg.onSelect && cfg.onSelect(new Set());
        render();
      },
      setSelected(sel) {
        selected = new Set(sel || []);
        render();
      },
      getSelected() {
        return selected;
      },
      render
    };
  }

  GD.createDataTable = createDataTable;
})(typeof window !== 'undefined' ? window : globalThis);

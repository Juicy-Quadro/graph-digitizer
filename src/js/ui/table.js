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

    function render() {
      const order = sortedIndices();
      if (!points.length) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;

      const scrollTop = wrap ? wrap.scrollTop : 0;
      const viewport = wrap ? wrap.clientHeight : 400;
      const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
      const last = Math.min(order.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

      const rows = [];
      for (let i = first; i < last; i++) {
        const index = order[i];
        const p = points[index];
        if (!p) continue;
        const cls = selected.has(index) ? ' class="selected"' : '';
        const x = format(p.x);
        const y = format(p.y);
        if (editing === index) {
          rows.push(
            `<tr class="selected"><td class="col-idx">${index + 1}</td>` +
            `<td><input class="cell-input" data-field="x" value="${escapeAttr(p.x)}" /></td>` +
            `<td><input class="cell-input" data-field="y" value="${escapeAttr(p.y)}" /></td>` +
            `<td class="col-act"></td></tr>`
          );
        } else {
          rows.push(
            `<tr${cls} data-index="${index}">` +
            `<td class="col-idx">${index + 1}</td>` +
            `<td>${x}</td><td>${y}</td>` +
            `<td class="col-act"><button class="row-del" data-del="${index}" title="${GD.I18n.t('table.remove')}">×</button></td>` +
            `</tr>`
          );
        }
      }
      // Virtualisation: a spacer row above and below keeps the scroll
      // position stable while only the visible rows are materialised.
      const topSpacer = '<tr class="vtop" style="height:' + (first * ROW_HEIGHT) + 'px"></tr>';
      const bottomSpacer = '<tr class="vbot" style="height:' +
        ((order.length - last) * ROW_HEIGHT) + 'px"></tr>';
      tbody.innerHTML = topSpacer + rows.join('') + bottomSpacer;
    }

    function format(v) {
      if (typeof v !== 'number' || !isFinite(v)) return '—';
      if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(6);
      return String(Math.round(v * 1e9) / 1e9);
    }

    function escapeAttr(v) {
      return String(v).replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
      const row = evt.target.closest('tr[data-index]');
      if (!row) return;
      const index = Number(row.getAttribute('data-index'));
      if (evt.detail === 2) {
        editing = index;
        render();
        const input = tbody.querySelector('.cell-input');
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
      if (isFinite(value) && editing >= 0) {
        cfg.onEdit && cfg.onEdit(editing, field, value);
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
        points = list || [];
        selected = new Set();
        editing = -1;
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

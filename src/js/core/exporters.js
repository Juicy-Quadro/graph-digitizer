/*
 * Data exporters.
 *
 * Every exporter takes the same payload:
 *   {
 *     lines: [ { name, color, points: [{ x, y, px, py }] } ],
 *     calibration: { xScale, yScale, points } | null,
 *     image: { name, width, height } | null
 *   }
 */
(function (root) {
  'use strict';

  const GD = root.GD || (root.GD = {});
  const G = GD.Geometry;

  const Formats = {
    CSV: 'csv',
    TXT: 'txt',
    XLS: 'xls',
    XML: 'xml',
    JSON: 'json',
    SVG: 'svg',
    DXF: 'dxf',
    EPS: 'eps'
  };

  /** A point is usable only when both logical coordinates are real numbers. */
  function isUsablePoint(p) {
    return !!p &&
      p.x !== null && p.x !== undefined && isFinite(p.x) &&
      p.y !== null && p.y !== undefined && isFinite(p.y);
  }

  /** The points of one series that carry a usable measurement. */
  function finitePoints(points) {
    const out = [];
    for (const p of points || []) {
      if (isUsablePoint(p)) out.push(p);
    }
    return out;
  }

  function allPoints(data) {
    const out = [];
    for (const line of data.lines || []) {
      for (const p of line.points || []) out.push(p);
    }
    return out;
  }

  function logicalBounds(data) {
    const pts = allPoints(data).filter(isUsablePoint);
    if (!pts.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX === maxX) maxX = minX + 1;
    if (minY === maxY) maxY = minY + 1;
    return { minX, maxX, minY, maxY };
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /** Clamp the number of decimals to the range toFixed() accepts. */
  function clampDecimals(decimals) {
    if (decimals === undefined || decimals === null) return 6;
    const n = Math.floor(Number(decimals));
    if (!isFinite(n)) return 6;
    return Math.max(0, Math.min(100, n));
  }

  function fmt(v, decimals) {
    // A missing measurement must not look like a real zero, so a non-finite
    // value is left empty instead of being formatted as a number.
    if (v === null || v === undefined || !isFinite(v)) return '';
    return Number(v).toFixed(clampDecimals(decimals));
  }

  /** A number for JSON output; a missing measurement stays null. */
  function jsonNum(v, decimals) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    return Number(fmt(v, decimals));
  }

  // ------------------------------------------------------------------ CSV

  function toCSV(data, options) {
    const opt = options || {};
    const delimiter = opt.delimiter || ',';
    const decimals = opt.decimals === undefined ? 6 : opt.decimals;
    const rows = [];
    const lines = data.lines || [];
    if (lines.length > 1) {
      // Every series contributes an X and a Y column, so the names have to
      // be laid out over the same columns as the data.
      const names = [];
      for (let i = 0; i < lines.length; i++) {
        names.push(lines[i].name || ('Series ' + (i + 1)), '');
      }
      rows.push(names);
    }
    const header = opt.withHeader !== false;
    if (header) {
      const cols = [];
      for (const line of lines) cols.push('X', 'Y');
      rows.push(cols.length ? cols : ['X', 'Y']);
    }
    const longest = Math.max(0, ...lines.map((l) => (l.points || []).length));
    for (let i = 0; i < longest; i++) {
      const row = [];
      for (const line of lines) {
        const p = (line.points || [])[i];
        row.push(p ? fmt(p.x, decimals) : '');
        row.push(p ? fmt(p.y, decimals) : '');
      }
      rows.push(row);
    }
    return rows
      .map((r) => r.map((c) => `${c}`).join(delimiter))
      .join('\r\n');
  }

  // ------------------------------------------------------------------ TXT

  function toTXT(data, options) {
    const opt = options || {};
    const decimals = opt.decimals === undefined ? 6 : opt.decimals;
    const sep = opt.separator || '\t';
    const lines = data.lines || [];
    const out = [];
    if (opt.withHeader !== false) {
      if (lines.length > 1) {
        // The names have to sit over the same columns as the data.
        const names = [];
        for (let i = 0; i < lines.length; i++) {
          names.push(lines[i].name || ('Series ' + (i + 1)), '');
        }
        out.push(names.join(sep));
      }
      const cols = [];
      for (const line of lines) cols.push('X', 'Y');
      out.push((cols.length ? cols : ['X', 'Y']).join(sep));
    }
    const longest = Math.max(0, ...lines.map((l) => (l.points || []).length));
    for (let i = 0; i < longest; i++) {
      const row = [];
      for (const line of lines) {
        const p = (line.points || [])[i];
        row.push(p ? fmt(p.x, decimals) : '');
        row.push(p ? fmt(p.y, decimals) : '');
      }
      out.push(row.join(sep));
    }
    return out.join('\r\n');
  }

  // ------------------------------------------------------------------ XLS
  // SpreadsheetML 2003 - opens natively in Excel, LibreOffice and Numbers.

  function toXLS(data, options) {
    const opt = options || {};
    const decimals = opt.decimals === undefined ? 10 : opt.decimals;
    const lines = data.lines || [];
    let rows = '';
    const header = opt.withHeader !== false;
    if (header) {
      if (lines.length > 1) {
        // One name cell per series, followed by an empty cell so the names
        // line up with the X and Y columns of the data.
        const nameCells = [];
        for (let i = 0; i < lines.length; i++) {
          nameCells.push(
            `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escapeXml(lines[i].name || ('Series ' + (i + 1)))}</Data></Cell>`,
            '<Cell/>'
          );
        }
        rows += '<Row>' + nameCells.join('') + '</Row>';
      }
      const headCells = [];
      for (const line of lines) {
        headCells.push(
          '<Cell ss:StyleID="hdr"><Data ss:Type="String">X</Data></Cell>',
          '<Cell ss:StyleID="hdr"><Data ss:Type="String">Y</Data></Cell>'
        );
      }
      rows += '<Row>' + (headCells.length ? headCells.join('') :
        '<Cell ss:StyleID="hdr"><Data ss:Type="String">X</Data></Cell>' +
        '<Cell ss:StyleID="hdr"><Data ss:Type="String">Y</Data></Cell>') + '</Row>';
    }
    const longest = Math.max(0, ...lines.map((l) => (l.points || []).length));
    for (let i = 0; i < longest; i++) {
      rows += '<Row>';
      for (const line of lines) {
        const p = (line.points || [])[i];
        const cx = p && isFinite(p.x)
          ? `<Cell><Data ss:Type="Number">${fmt(p.x, decimals)}</Data></Cell>`
          : '<Cell/>';
        const cy = p && isFinite(p.y)
          ? `<Cell><Data ss:Type="Number">${fmt(p.y, decimals)}</Data></Cell>`
          : '<Cell/>';
        rows += cx + cy;
      }
      rows += '</Row>';
    }
    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/></Style>
 </Styles>
 <Worksheet ss:Name="Data">
  <Table>
   ${rows}
  </Table>
 </Worksheet>
</Workbook>`;
  }

  // ------------------------------------------------------------------ XML

  function toXML(data, options) {
    const opt = options || {};
    const decimals = opt.decimals === undefined ? 10 : opt.decimals;
    const lines = data.lines || [];
    const body = lines.map((line, li) => {
      // A point without a real measurement would produce empty attributes,
      // so only usable points are written.
      const pts = finitePoints(line.points).map((p) =>
        `      <Point x="${fmt(p.x, decimals)}" y="${fmt(p.y, decimals)}"${
          p.px !== undefined ? ` px="${fmt(p.px, 2)}" py="${fmt(p.py, 2)}"` : ''
        }/>`
      ).join('\n');
      return `    <Series index="${li}" name="${escapeXml(line.name || '')}">\n${pts}\n    </Series>`;
    }).join('\n');
    const calib = data.calibration;
    const CALIB_TAGS = { xmin: 'Xmin', xmax: 'Xmax', ymin: 'Ymin', ymax: 'Ymax' };
    const calibXml = calib && calib.points
      ? `  <Calibration xScale="${escapeXml(calib.xScale || 'linear')}" yScale="${escapeXml(calib.yScale || 'linear')}">\n` +
        Object.keys(CALIB_TAGS).map((k) => {
          const pt = calib.points[k];
          if (!pt) return null;
          return `    <${CALIB_TAGS[k]} x="${fmt(pt.x, 2)}" y="${fmt(pt.y, 2)}" value="${fmt(pt.value, 10)}"/>`;
        }).filter(Boolean).join('\n') + '\n  </Calibration>\n'
      : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<GraphDigitizerData version="1.0"${data.image && data.image.name ? ` source="${escapeXml(data.image.name)}"` : ''}>
${calibXml}${body}
</GraphDigitizerData>`;
  }

  // ------------------------------------------------------------------ JSON

  function toJSON(data, options) {
    const opt = options || {};
    const decimals = opt.decimals === undefined ? 10 : opt.decimals;
    const payload = {
      version: '1.0',
      source: data.image || null,
      calibration: data.calibration
        ? {
            xScale: data.calibration.xScale || 'linear',
            yScale: data.calibration.yScale || 'linear',
            points: data.calibration.points
          }
        : null,
      series: (data.lines || []).map((line) => ({
        name: line.name || '',
        color: line.color || null,
        points: (line.points || []).map((p) => ({
          x: jsonNum(p.x, decimals),
          y: jsonNum(p.y, decimals),
          px: p.px === undefined ? null : jsonNum(p.px, 3),
          py: p.py === undefined ? null : jsonNum(p.py, 3)
        }))
      }))
    };
    return JSON.stringify(payload, null, 2);
  }

  // ------------------------------------------------------------------ SVG

  /**
   * The series that can actually be drawn, together with the bounds of the
   * transformed coordinates. A logarithmic axis turns a non-positive value
   * into a non-finite number, so the check happens after the transform.
   */
  function drawableSeries(data, tx, ty) {
    const series = [];
    for (const line of data.lines || []) {
      const pts = [];
      for (const p of line.points || []) {
        if (!isUsablePoint(p)) continue;
        const x = tx(p.x);
        const y = ty(p.y);
        if (!isFinite(x) || !isFinite(y)) continue;
        pts.push(p);
      }
      if (pts.length) series.push({ name: line.name || '', color: line.color || null, points: pts });
    }
    if (!series.length) return { series: [], bounds: null };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        const x = tx(p.x);
        const y = ty(p.y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (minX === maxX) maxX = minX + 1;
    if (minY === maxY) maxY = minY + 1;
    return { series, bounds: { minX, maxX, minY, maxY } };
  }

  function toSVG(data, options) {
    const opt = options || {};
    const width = opt.width || 900;
    const height = opt.height || 600;
    const pad = opt.padding || 70;
    const logX = data.calibration && data.calibration.xScale === 'log';
    const logY = data.calibration && data.calibration.yScale === 'log';
    const tx = (v) => (logX ? Math.log(v) : v);
    const ty = (v) => (logY ? Math.log(v) : v);
    const drawn = drawableSeries(data, tx, ty);
    const bounds = drawn.bounds;
    if (!bounds) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`;
    }

    const b = bounds;
    const sx = (v) => pad + ((tx(v) - b.minX) / (b.maxX - b.minX)) * (width - 2 * pad);
    const sy = (v) => height - pad - ((ty(v) - b.minY) / (b.maxY - b.minY)) * (height - 2 * pad);

    const palette = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];
    const body = drawn.series.map((line, i) => {
      const pts = line.points;
      const d = pts.map((p, k) => `${k ? 'L' : 'M'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ');
      const color = line.color || palette[i % palette.length];
      const label = line.name
        ? `<text x="${(sx(pts[0].x) + 8).toFixed(2)}" y="${(sy(pts[0].y) - 8).toFixed(2)}" font-family="Segoe UI,Arial" font-size="12" fill="${color}">${escapeXml(line.name)}</text>`
        : '';
      return `  <path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>\n${label}`;
    }).join('\n');

    const ticksX = 6;
    const ticksY = 5;
    let grid = '';
    for (let i = 0; i <= ticksX; i++) {
      const v = b.minX + ((b.maxX - b.minX) * i) / ticksX;
      const px = pad + ((width - 2 * pad) * i) / ticksX;
      grid += `  <line x1="${px.toFixed(2)}" y1="${pad}" x2="${px.toFixed(2)}" y2="${height - pad}" stroke="#e5e7eb"/>\n`;
      const label = logX ? Math.exp(v) : v;
      grid += `  <text x="${px.toFixed(2)}" y="${height - pad + 18}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="11" fill="#6b7280">${G.num(label, 4)}</text>`;
    }
    for (let i = 0; i <= ticksY; i++) {
      const v = b.minY + ((b.maxY - b.minY) * i) / ticksY;
      const py = height - pad - ((height - 2 * pad) * i) / ticksY;
      grid += `  <line x1="${pad}" y1="${py.toFixed(2)}" x2="${width - pad}" y2="${py.toFixed(2)}" stroke="#e5e7eb"/>\n`;
      const label = logY ? Math.exp(v) : v;
      grid += `  <text x="${pad - 8}" y="${(py + 4).toFixed(2)}" text-anchor="end" font-family="Segoe UI,Arial" font-size="11" fill="#6b7280">${G.num(label, 4)}</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
${grid}
  <rect x="${pad}" y="${pad}" width="${width - 2 * pad}" height="${height - 2 * pad}" fill="none" stroke="#9ca3af"/>
${body}
</svg>`;
  }

  // ------------------------------------------------------------------ DXF

  function toDXF(data, options) {
    const opt = options || {};
    const decimals = opt.decimals === undefined ? 8 : opt.decimals;
    const out = [];
    const push = (code, value) => {
      out.push(String(code));
      out.push(String(value));
    };
    push(0, 'SECTION');
    push(2, 'ENTITIES');
    (data.lines || []).forEach((line) => {
      // A vertex without a real measurement would be written as a literal
      // NaN, which makes the whole DXF unreadable, so it is dropped.
      const pts = finitePoints(line.points);
      if (!pts.length) return;
      push(0, 'POLYLINE');
      push(8, '0');
      push(66, 1);
      push(70, 8); // 3D polyline
      pts.forEach((p) => {
        push(0, 'VERTEX');
        push(8, '0');
        push(10, fmt(p.x, decimals));
        push(20, fmt(p.y, decimals));
        push(30, '0.0');
      });
      push(0, 'SEQEND');
    });
    push(0, 'ENDSEC');
    push(0, 'EOF');
    return out.join('\r\n');
  }

  // ------------------------------------------------------------------ EPS

  function toEPS(data, options) {
    const opt = options || {};
    const decimals = opt.decimals === undefined ? 6 : opt.decimals;
    const widthPt = 540;
    const heightPt = 360;
    const padPt = 40;
    // A logarithmic axis has to be spaced in log space, the same way the
    // SVG exporter does it, otherwise the curve is drawn with the log
    // values spread out linearly.
    const logX = data.calibration && data.calibration.xScale === 'log';
    const logY = data.calibration && data.calibration.yScale === 'log';
    const tx = (v) => (logX ? Math.log(v) : v);
    const ty = (v) => (logY ? Math.log(v) : v);
    const drawn = drawableSeries(data, tx, ty);
    const b = drawn.bounds || { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const sx = (v) => padPt + ((tx(v) - b.minX) / (b.maxX - b.minX)) * (widthPt - 2 * padPt);
    const sy = (v) => padPt + ((ty(v) - b.minY) / (b.maxY - b.minY)) * (heightPt - 2 * padPt);
    const out = [];
    out.push('%!PS-Adobe-3.0 EPSF-3.0');
    out.push(`%%BoundingBox: 0 0 ${widthPt} ${heightPt}`);
    out.push('%%Creator: Graph Digitizer');
    out.push('%%Title: Digitized data');
    out.push('%%EndComments');
    out.push('/l {lineto} bind def');
    out.push('/r {setrgbcolor} bind def');
    out.push('/m {moveto} bind def');
    out.push('/s {stroke} bind def');
    out.push('%%EndProlog');
    out.push('1 setlinecap 1 setlinejoin');
    const palette = ['0.1 0.3 0.8', '0.8 0.15 0.15', '0.05 0.55 0.35', '0.8 0.5 0.1'];
    drawn.series.forEach((line, i) => {
      const pts = line.points;
      const rgb = palette[i % palette.length];
      out.push(`${rgb} r`);
      out.push('1.2 setlinewidth');
      pts.forEach((p, k) => {
        const x = sx(p.x).toFixed(3);
        const y = sy(p.y).toFixed(3);
        out.push(k === 0 ? `${x} ${y} m` : `${x} ${y} l`);
      });
      out.push('s');
    });
    out.push('showpage');
    out.push('%%EOF');
    return out.join('\r\n');
  }

  const EXPORTERS = {
    [Formats.CSV]: toCSV,
    [Formats.TXT]: toTXT,
    [Formats.XLS]: toXLS,
    [Formats.XML]: toXML,
    [Formats.JSON]: toJSON,
    [Formats.SVG]: toSVG,
    [Formats.DXF]: toDXF,
    [Formats.EPS]: toEPS
  };

  function exportData(format, data, options) {
    const fn = EXPORTERS[format];
    if (!fn) throw new Error('Unsupported export format: ' + format);
    return fn(data, options || {});
  }

  GD.Exporters = {
    Formats,
    exportData,
    toCSV,
    toTXT,
    toXLS,
    toXML,
    toJSON,
    toSVG,
    toDXF,
    toEPS,
    logicalBounds
  };
})(typeof window !== 'undefined' ? window : globalThis);

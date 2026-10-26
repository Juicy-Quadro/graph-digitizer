'use strict';

/*
 * The report of the benchmark.
 *
 *   node tools/bench-report.js
 *
 * It reads testdata/bench/results.jsonl and writes a summary to the
 * console and to testdata/bench/REPORT.md.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const benchDir = path.join(root, 'testdata', 'bench');
const resultsFile = path.join(benchDir, 'results.jsonl');
const reportFile = path.join(benchDir, 'REPORT.md');

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function stats(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    mean: sum / values.length,
    median: percentile(values, 50),
    p90: percentile(values, 90),
    worst: Math.max.apply(null, values)
  };
}

function fmt(v, digits) {
  if (v === null || v === undefined || !isFinite(v)) return '-';
  return v.toFixed(digits === undefined ? 2 : digits);
}

function main() {
  if (!fs.existsSync(resultsFile)) {
    console.log('no results yet, run: electron tools/bench-llm.js');
    return;
  }
  const records = fs.readFileSync(resultsFile, 'utf8').split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  /*
   * A figure can be in the file more than once, when the way it was
   * measured changed. The newest answer is the one that counts, and the
   * two tasks are kept apart, so a figure that was measured for its colour
   * bar and for its curves keeps both.
   */
  const byFile = new Map();
  for (const r of records) {
    let m = byFile.get(r.file);
    if (!m) {
      m = {
        file: r.file,
        paper: r.paper,
        category: r.category,
        width: r.width,
        height: r.height,
        hasBar: r.hasBar,
        labels: r.labels
      };
      byFile.set(r.file, m);
    }
    if (r.curve) m.curve = r.curve;
    if (r.bar) m.bar = r.bar;
  }
  const figures = Array.from(byFile.values());

  const lines = [];
  const say = (s) => {
    console.log(s);
    lines.push(s);
  };

  say('# Benchmark: the model against the classical algorithm');
  say('');
  say('Figures from arXiv papers, extracted from the source packages. The');
  say('reference is what the ordinary algorithm finds in the same figure: the');
  say('colour that stands out is traced, and the colour bar is measured.');
  say('');
  say('* figures measured: **' + figures.length + '**');
  say('* with a traceable curve: **' + figures.filter((r) => r.hasReference).length + '**');
  say('* with a colour bar: **' + figures.filter((r) => r.hasBar).length + '**');
  say('');

  // ---------------------------------------------------------- curves
  const curveRecords = figures.filter((r) => r.curve);
  if (curveRecords.length) {
    const ok = curveRecords.filter((r) => r.curve.ok);
    const empty = ok.filter((r) => r.curve.points === 0);
    const withPoints = ok.filter((r) => r.curve.points > 0);
    const onStructure = withPoints
      .filter((r) => typeof r.curve.onStructure === 'number')
      .map((r) => r.curve.onStructure);
    const coherence = withPoints
      .filter((r) => typeof r.curve.coherence === 'number')
      .map((r) => r.curve.coherence);
    const scored = withPoints.filter((r) => r.curve.deviation);
    say('## Curve extraction');
    say('');
    say('The model was asked which curves the figure holds. There is no ground');
    say('truth for that on a real paper figure, so the measure is whether the');
    say('points it returned really sit on a drawn line and whether they form');
    say('one continuous path.');
    say('');
    say('* the model answered: **' + ok.length + ' of ' + curveRecords.length +
      '** (' + (100 * ok.length / curveRecords.length).toFixed(1) + ' percent)');
    say('* answers that named no curve at all: **' + empty.length + '**');
    say('* answers with points: **' + withPoints.length + '**');
    if (onStructure.length) {
      const s = stats(onStructure);
      say('');
      say('| measure | median | mean | p90 |');
      say('|---|---|---|---|');
      say('| share of the points that sit on a drawn line | ' +
        fmt(s.median * 100, 1) + '% | ' + fmt(s.mean * 100, 1) + '% | ' +
        fmt(s.p90 * 100, 1) + '% |');
      const good = onStructure.filter((v) => v > 0.8).length;
      say('');
      say('* answers with more than eighty percent of the points on a line: **' +
        good + ' of ' + onStructure.length + '** (' +
        (100 * good / onStructure.length).toFixed(1) + ' percent)');
    }
    if (coherence.length) {
      const s = stats(coherence);
      say('* share of the steps that jump too far (a broken path): median ' +
        fmt(s.median * 100, 1) + '%, p90 ' + fmt(s.p90 * 100, 1) + '%');
    }
    if (scored.length) {
      const s = stats(scored.map((r) => r.curve.deviation.mean));
      say('* where the classical tracer also found a curve: the mean distance ' +
        'of the points was ' + fmt(s.mean) + ' px');
    }
    const latencies = curveRecords.map((r) => r.curve.ms);
    if (latencies.length) {
      say('* time per figure: median ' + Math.round(stats(latencies).median) +
        ' ms, p90 ' + Math.round(stats(latencies).p90) + ' ms');
    }
    const errors = curveRecords.filter((r) => !r.curve.ok);
    if (errors.length) {
      const kinds = {};
      errors.forEach((r) => {
        const key = (r.curve.error || 'unknown').slice(0, 60);
        kinds[key] = (kinds[key] || 0) + 1;
      });
      say('');
      say('### Why the model did not answer');
      say('');
      Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).forEach((k) => {
        say('* ' + kinds[k] + ' x ' + k);
      });
    }
    say('');
  }

  // ---------------------------------------------------------- colour bars
  const barRecords = figures.filter((r) => r.bar && !r.bar.skipped);
  const skipped = figures.filter((r) => r.bar && r.bar.skipped);
  if (barRecords.length || skipped.length) {
    say('## Colour bar tick reading');
    say('');
    if (skipped.length) {
      say('* figures where the colour bar has no printed labels next to it and');
      say('  therefore cannot be scored: **' + skipped.length + '**');
    }
    const ok = barRecords.filter((r) => r.bar.ok);
    const withTicks = ok.filter((r) => r.bar.ticks > 0);
    const withPos = ok.filter((r) => r.bar.positionError !== null && r.bar.positionError !== undefined);
    const withRes = ok.filter((r) => r.bar.residual);
    say('* the model answered: **' + ok.length + ' of ' + barRecords.length + '**');
    say('* answers with at least one tick: **' + withTicks.length + '**');
    if (withPos.length) {
      const errs = withPos.map((r) => r.bar.positionError);
      const means = withPos.map((r) => r.bar.positionMean);
      const s = stats(errs);
      const sm = stats(means);
      say('* distance of the read tick from the printed label: median ' +
        fmt(sm.median, 1) + ' px, p90 ' + fmt(sm.p90, 1) + ' px, worst ' +
        fmt(s.worst, 1) + ' px');
      const close = withPos.filter((r) => r.bar.positionMean < 12).length;
      say('* answers whose ticks sit within twelve pixels of the printed ones: **' +
        close + ' of ' + withPos.length + '** (' +
        (100 * close / withPos.length).toFixed(1) + ' percent)');
    }
    if (withRes.length) {
      const rel = withRes.map((r) => r.bar.residual.relative).filter((v) => v !== null);
      const s = stats(rel);
      say('* the read numbers against a straight line (a number read wrong shows up here):');
      say('  * with the positions of the model: median ' + fmt(s.median * 100, 2) +
        ' percent of the range, p90 ' + fmt(s.p90 * 100, 2) +
        ' percent, worst ' + fmt(s.worst * 100, 2) + ' percent');
      const clean = withRes.filter((r) => r.bar.residual.relative !== null &&
        r.bar.residual.relative < 0.02).length;
      say('  * answers that sit on a straight line within two percent: **' +
        clean + ' of ' + withRes.length + '** (' +
        (100 * clean / withRes.length).toFixed(1) + ' percent)');
    }
    /*
     * The straight line only means something on a bar that is linear. A
     * logarithmic bar and a bar that is split into parts are not straight,
     * and on those the measure says nothing at all. They are told apart by
     * the numbers of the model, which are on a straight line only when the
     * bar is.
     */
    const straight = withRes.filter((r) => r.bar.residual &&
      r.bar.residual.relative !== null && r.bar.residual.relative < 0.02);
    if (straight.length) {
      const rel = straight.map((r) => r.bar.residual.relative);
      const s = stats(rel);
      const pr = straight.filter((r) => r.bar.residualPrinted);
      say('* on the bars that are straight, which is where the measure means something:');
      say('  * with the positions of the model: median ' + fmt(s.median * 100, 3) +
        ' percent of the range, worst ' + fmt(s.worst * 100, 3) + ' percent');
      if (pr.length) {
        const sp = stats(pr.map((r) => r.bar.residualPrinted.relative));
        say('  * with the positions the program found: median ' +
          fmt(sp.median * 100, 3) + ' percent of the range, worst ' +
          fmt(sp.worst * 100, 3) + ' percent');
      }
      say('  * the other ' + (withRes.length - straight.length) + ' bars are not straight' +
        ' (a logarithmic or a split bar), so the measure says nothing about them');
    }
    const printed = withRes.filter((r) => r.bar.residualPrinted);
    if (printed.length) {
      const rel = printed.map((r) => r.bar.residualPrinted.relative).filter((v) => v !== null);
      const s = stats(rel);
      say('* the same numbers on the positions the program found: median ' +
        fmt(s.median * 100, 2) + ' percent of the range, p90 ' +
        fmt(s.p90 * 100, 2) + ' percent, worst ' + fmt(s.worst * 100, 2) + ' percent');
    }
    const latencies = barRecords.map((r) => r.bar.ms);
    if (latencies.length) {
      say('* time per figure: median ' + Math.round(stats(latencies).median) +
        ' ms, p90 ' + Math.round(stats(latencies).p90) + ' ms');
    }
    const errors = barRecords.filter((r) => !r.bar.ok);
    if (errors.length) {
      const kinds = {};
      errors.forEach((r) => {
        const key = (r.bar.error || 'unknown').slice(0, 60);
        kinds[key] = (kinds[key] || 0) + 1;
      });
      say('');
      say('### Why the model did not answer');
      say('');
      Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).forEach((k) => {
        say('* ' + kinds[k] + ' x ' + k);
      });
    }
    say('');
  }

  // ---------------------------------------------------------- by category
  const byCategory = {};
  figures.forEach((r) => {
    const key = r.category || 'unknown';
    byCategory[key] = byCategory[key] || { total: 0, ok: 0, covered: 0, scored: 0 };
    byCategory[key].total++;
    if (r.curve && r.curve.ok) byCategory[key].ok++;
    if (r.curve && r.curve.deviation) {
      byCategory[key].scored++;
      if (r.curve.deviation.covered > 0.5) byCategory[key].covered++;
    }
  });
  say('## By subject');
  say('');
  say('| subject | figures | answered | scored | covered more than half |');
  say('|---|---|---|---|---|');
  Object.keys(byCategory).sort((a, b) => byCategory[b].total - byCategory[a].total).forEach((k) => {
    const c = byCategory[k];
    say('| ' + k + ' | ' + c.total + ' | ' + c.ok + ' | ' + c.scored + ' | ' + c.covered + ' |');
  });
  say('');

  fs.writeFileSync(reportFile, lines.join('\n'));
  console.log('wrote ' + reportFile);
}

main();

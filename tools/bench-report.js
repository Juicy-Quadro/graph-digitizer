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
  say('* figures measured: **' + records.length + '**');
  say('* with a traceable curve: **' + records.filter((r) => r.hasReference).length + '**');
  say('* with a colour bar: **' + records.filter((r) => r.hasBar).length + '**');
  say('');

  // ---------------------------------------------------------- curves
  const curveRecords = records.filter((r) => r.curve);
  if (curveRecords.length) {
    const ok = curveRecords.filter((r) => r.curve.ok);
    const scored = ok.filter((r) => r.curve.deviation);
    const empty = ok.filter((r) => r.curve.points === 0);
    say('## Curve extraction');
    say('');
    say('* the model answered: **' + ok.length + ' of ' + curveRecords.length +
      '** (' + (100 * ok.length / curveRecords.length).toFixed(1) + ' percent)');
    say('* of those, an answer with no point at all: **' + empty.length + '**');
    say('* answers that could be compared with the reference: **' + scored.length + '**');
    if (scored.length) {
      const means = scored.map((r) => r.curve.deviation.mean);
      const covers = scored.map((r) => r.curve.deviation.covered);
      const worsts = scored.map((r) => r.curve.deviation.worst);
      const s1 = stats(means);
      const s2 = stats(covers);
      say('');
      say('| measure | median | mean | p90 | worst |');
      say('|---|---|---|---|---|');
      say('| distance of the points from the reference curve (px) | ' +
        fmt(s1.median) + ' | ' + fmt(s1.mean) + ' | ' + fmt(s1.p90) + ' | ' + fmt(s1.worst) + ' |');
      say('| share of the reference the model covered | ' +
        fmt(s2.median * 100, 1) + '% | ' + fmt(s2.mean * 100, 1) + '% | ' +
        fmt(s2.p90 * 100, 1) + '% | ' + fmt(s2.worst * 100, 1) + '% |');
      say('| largest distance of a single point (px) | ' +
        fmt(stats(worsts).median) + ' | ' + fmt(stats(worsts).mean) + ' | ' +
        fmt(stats(worsts).p90) + ' | ' + fmt(stats(worsts).worst) + ' |');
      const good = scored.filter((r) => r.curve.deviation.covered > 0.5).length;
      const close = scored.filter((r) => r.curve.deviation.mean < 10).length;
      say('');
      say('* answers that covered more than half of the reference curve: **' +
        good + ' of ' + scored.length + '** (' +
        (100 * good / scored.length).toFixed(1) + ' percent)');
      say('* answers whose points sit on the curve (mean distance below 10 px): **' +
        close + ' of ' + scored.length + '** (' +
        (100 * close / scored.length).toFixed(1) + ' percent)');
    }
    const latencies = curveRecords.map((r) => r.curve.ms);
    if (latencies.length) {
      say('');
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
  const barRecords = records.filter((r) => r.bar);
  if (barRecords.length) {
    const ok = barRecords.filter((r) => r.bar.ok);
    const withTicks = ok.filter((r) => r.bar.ticks > 0);
    const withPos = ok.filter((r) => r.bar.positionError !== null && r.bar.positionError !== undefined);
    const withRes = ok.filter((r) => r.bar.residual);
    say('## Colour bar tick reading');
    say('');
    say('* the model answered: **' + ok.length + ' of ' + barRecords.length + '**');
    say('* answers with at least one tick: **' + withTicks.length + '**');
    if (withPos.length) {
      const errs = withPos.map((r) => r.bar.positionError);
      const s = stats(errs);
      say('* distance of the read tick from the printed label: median ' + fmt(s.median, 1) +
        ' px, p90 ' + fmt(s.p90, 1) + ' px, worst ' + fmt(s.worst, 1) + ' px');
    }
    if (withRes.length) {
      const rel = withRes.map((r) => r.bar.residual.relative).filter((v) => v !== null);
      const s = stats(rel);
      say('* the read numbers against a straight line (a number read wrong shows up here):');
      say('  * median ' + fmt(s.median * 100, 2) + ' percent of the range, p90 ' +
        fmt(s.p90 * 100, 2) + ' percent, worst ' + fmt(s.worst * 100, 2) + ' percent');
      const clean = withRes.filter((r) => r.bar.residual.relative !== null &&
        r.bar.residual.relative < 0.02).length;
      say('  * answers that sit on a straight line within two percent: **' +
        clean + ' of ' + withRes.length + '**');
    }
    const latencies = barRecords.map((r) => r.bar.ms);
    say('* time per figure: median ' + Math.round(stats(latencies).median) +
      ' ms, p90 ' + Math.round(stats(latencies).p90) + ' ms');
    say('');
  }

  // ---------------------------------------------------------- by category
  const byCategory = {};
  records.forEach((r) => {
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

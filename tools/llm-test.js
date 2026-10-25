'use strict';

/*
 * LLM helper test harness.
 *
 * The prompt builders and the reply parsers are pure, so they run under
 * plain node. No request is sent to the model from this suite.
 */

const path = require('path');

const llm = require(path.join(__dirname, '..', 'electron', 'llm.js'));

const {
  buildBarPrompt,
  parseBarReply,
  parseNumber,
  buildCurvePrompt,
  parseCurveReply
} = llm;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ok   ' + name + (detail ? '  (' + detail + ')' : ''));
  } else {
    failed++;
    failures.push(name + (detail ? '  (' + detail + ')' : ''));
    console.log('  FAIL ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

// ---------------------------------------------------------------- 1. numbers

section('1. Numeric tick labels');
{
  const cases = [
    ['0', 0],
    ['0.0', 0],
    ['-5', -5],
    ['+3', 3],
    ['1e-3', 0.001],
    ['2.5E+04', 25000],
    ['1 234', 1234],
    [' 7 ', 7]
  ];
  cases.forEach((entry) => {
    const value = parseNumber(entry[0]);
    check('parseNumber(' + JSON.stringify(entry[0]) + ') is ' + entry[1],
      value === entry[1], String(value));
  });

  ['abc', '', '--3'].forEach((text) => {
    const value = parseNumber(text);
    check('parseNumber(' + JSON.stringify(text) + ') is null', value === null, String(value));
  });
}

// ---------------------------------------------------------------- 2. bar reply

section('2. Colour bar reply');
{
  const fenced = 'Here are the labels I found:\n' +
    '```json\n' +
    '{"ticks":[{"label":"0","value":0,"position":12},' +
    '{"label":"1e-3","value":0.001,"position":88}]}\n' +
    '```\n' +
    'Let me know if you need more.';

  const fencedTicks = parseBarReply(fenced).ticks;
  check('a fenced reply is parsed', fencedTicks.length === 2, 'ticks=' + fencedTicks.length);
  check('the first label is kept', fencedTicks[0].label === '0', JSON.stringify(fencedTicks[0]));
  check('the first value is a number', fencedTicks[0].value === 0, String(fencedTicks[0].value));
  check('the first position is a number', fencedTicks[0].position === 12, String(fencedTicks[0].position));
  check('the scientific notation is parsed', fencedTicks[1].value === 0.001, String(fencedTicks[1].value));

  const prose = 'Sure, this is the answer:\n' +
    '{"ticks":[{"label":"-5","value":-5,"position":40}]}\n' +
    'That was all.';

  const proseTicks = parseBarReply(prose).ticks;
  check('a reply with prose around it is parsed', proseTicks.length === 1, 'ticks=' + proseTicks.length);
  check('the value of a prose reply is kept', proseTicks[0].value === -5, String(proseTicks[0].value));

  const nullValue = parseBarReply('{"ticks":[{"label":"?","value":null,"position":7}]}').ticks;
  check('a null value is tolerated', nullValue.length === 1 && nullValue[0].value === null,
    JSON.stringify(nullValue[0]));

  const dropped = parseBarReply(
    '{"ticks":[{"label":"0","value":0,"position":"abc"},{"label":"1","value":1,"position":5}]}'
  ).ticks;
  check('an entry with a non numeric position is dropped', dropped.length === 1, 'ticks=' + dropped.length);
  check('the remaining entry is kept', dropped[0].position === 5, String(dropped[0].position));

  const garbage = parseBarReply('I cannot read this image at all.');
  check('a broken reply gives no ticks', garbage.ticks.length === 0, 'ticks=' + garbage.ticks.length);
}

// ---------------------------------------------------------------- 3. curve reply

section('3. Curve reply');
{
  const reply = '{"series":[{"name":"curve 1","color":"#3366ff","points":' +
    '[{"x":0,"y":0.5},{"x":0.5,"y":0.4},{"x":1,"y":0.6},' +
    '{"x":1.5,"y":0.2},{"x":"nope","y":0.3},{"x":0.2,"y":-0.1}]}]}';

  const series = parseCurveReply(reply).series;
  check('the series is kept', series.length === 1, 'series=' + series.length);
  check('the name is kept', series[0].name === 'curve 1', JSON.stringify(series[0].name));
  check('the colour is kept', series[0].color === '#3366ff', String(series[0].color));
  check('only the points inside the unit square are kept', series[0].points.length === 3,
    'points=' + series[0].points.length);
  check('the first point is kept', series[0].points[0].x === 0 && series[0].points[0].y === 0.5,
    JSON.stringify(series[0].points[0]));

  const single = parseCurveReply('{"series":[{"name":"one","points":[{"x":0.1,"y":0.2}]}]}').series;
  check('a series with one point is dropped', single.length === 0, 'series=' + single.length);

  const garbage = parseCurveReply('There is no curve in this figure.');
  check('a broken reply gives no series', garbage.series.length === 0, 'series=' + garbage.series.length);
}

// ---------------------------------------------------------------- 4. prompts

section('4. Prompts');
{
  const bar = buildBarPrompt({ width: 640, height: 128, orientation: 'vertical' });
  check('the bar prompt states the image size', bar.indexOf('640') >= 0 && bar.indexOf('128') >= 0,
    '640 x 128');
  check('the bar prompt states the JSON shape', bar.indexOf('{"ticks":') >= 0);
  check('the bar prompt names the axis of the position', bar.indexOf('"position"') >= 0);

  const curve = buildCurvePrompt({ width: 800, height: 600 });
  check('the curve prompt states the image size', curve.indexOf('800') >= 0 && curve.indexOf('600') >= 0,
    '800 x 600');
  check('the curve prompt states the JSON shape', curve.indexOf('{"series":') >= 0);
}

// ---------------------------------------------------------------- summary

console.log('\n' + '='.repeat(60));
console.log('passed: ' + passed + '   failed: ' + failed);
if (failures.length) {
  console.log('\nfailures:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(60));
process.exit(failed ? 1 : 0);

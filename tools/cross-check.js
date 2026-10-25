'use strict';

/*
 * Cross layer consistency check.
 *
 * The interface is spread over a lot of small files that refer to each other
 * by name: an i18n key in the markup, an element id in the code, an IPC
 * channel in the bridge. A renamed key or a moved element breaks the
 * interface in a way that no unit test notices, so the names are compared
 * here.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let problems = 0;
const bad = (msg) => {
  console.log('  ' + msg);
  problems++;
};

// ------------------------------------------------------------------ i18n

const i18n = read('src/js/i18n.js');

/** The keys of one dictionary of the file. */
function dictionary(lang) {
  const start = i18n.indexOf('\n    ' + lang + ': {');
  if (start < 0) return null;
  const from = i18n.indexOf('{', start);
  let depth = 0;
  let end = from;
  for (let i = from; i < i18n.length; i++) {
    if (i18n[i] === '{') depth++;
    else if (i18n[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const keys = new Set();
  const re = /'([^']+)'\s*:/g;
  let m;
  while ((m = re.exec(i18n.slice(from, end + 1)))) keys.add(m[1]);
  return keys;
}

const en = dictionary('en');
const zh = dictionary('zh');
if (!en || !zh) {
  console.log('  the dictionaries could not be read');
  process.exit(1);
}
console.log('i18n keys: en=' + en.size + ' zh=' + zh.size);
for (const k of en) if (!zh.has(k)) bad('missing in zh: ' + k);
for (const k of zh) if (!en.has(k)) bad('missing in en: ' + k);

// ------------------------------------------------------------------ code

const sources = [
  'src/js/app.js',
  'src/js/ui/canvas.js',
  'src/js/ui/table.js',
  'src/js/core/colorbar.js',
  'src/js/core/exporters.js'
];

const used = new Set();
for (const rel of sources) {
  const s = read(rel);
  const re = /\bt\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(s))) used.add(m[1]);
}
for (const k of used) {
  // A key that ends with a dot is built at runtime, so it cannot be checked.
  if (k.endsWith('.')) continue;
  if (!en.has(k)) bad('used but not defined: ' + k);
}

// ------------------------------------------------------------------ markup

const html = read('src/index.html');
let m;
const binding = /data-i18n(?:-title)?="([^"]+)"/g;
let bound = 0;
while ((m = binding.exec(html))) {
  bound++;
  if (!en.has(m[1])) bad('data-i18n without a key: ' + m[1]);
}
console.log('bound elements: ' + bound);

const ids = new Set();
const idRe = /id="([^"]+)"/g;
while ((m = idRe.exec(html))) ids.add(m[1]);
for (const rel of sources) {
  const s = read(rel);
  const get = /getElementById\('([^']+)'\)/g;
  let x;
  while ((x = get.exec(s))) {
    if (!ids.has(x[1])) bad('getElementById without an element: ' + x[1] + ' in ' + rel);
  }
}

// ------------------------------------------------------------------ ipc

const main = read('electron/main.js');
const preload = read('electron/preload.js');
const invokes = new Set();
const invRe = /ipcRenderer\.invoke\('([^']+)'/g;
while ((m = invRe.exec(preload))) invokes.add(m[1]);
for (const name of invokes) {
  if (main.indexOf("'" + name + "'") < 0) bad('invoke without a handler: ' + name);
}
const handlers = new Set();
const hRe = /ipcMain\.(?:handle|on)\('([^']+)'/g;
while ((m = hRe.exec(main))) handlers.add(m[1]);
console.log('ipc: ' + invokes.size + ' invoked, ' + handlers.size + ' handled');

// ------------------------------------------------------------------ scripts

const scripts = [];
const sRe = /<script src="([^"]+)"><\/script>/g;
while ((m = sRe.exec(html))) scripts.push(m[1]);
for (const s of scripts) {
  if (!fs.existsSync(path.join(root, 'src', s))) bad('script tag without a file: ' + s);
}
console.log('scripts: ' + scripts.length);

console.log(problems ? problems + ' problem(s)' : 'the layers agree');
process.exit(problems ? 1 : 0);

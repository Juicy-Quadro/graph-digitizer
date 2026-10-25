'use strict';

/*
 * Runs every regression suite in one go.
 *
 *   node tools/run-tests.js
 *
 * The algorithm suite runs on plain node, the four interface suites need the
 * Electron runtime that ships with the project.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

const suites = [
  { name: 'algorithm', file: 'tools/algorithm-test.js', runtime: 'node' },
  { name: 'theme', file: 'tools/theme-test.js', runtime: 'electron' },
  { name: 'experience', file: 'tools/experience-test.js', runtime: 'electron' },
  { name: 'smoke', file: 'tools/smoke-test.js', runtime: 'electron' },
  { name: 'ui', file: 'tools/ui-test.js', runtime: 'electron' }
];

let failed = 0;
for (const suite of suites) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + suite.name);
  console.log('='.repeat(60));
  let cmd = process.execPath;
  let args = [path.join(root, suite.file)];
  if (suite.runtime === 'electron') {
    if (!fs.existsSync(electron)) {
      console.log('  SKIP: the Electron runtime is missing, run npm install first');
      continue;
    }
    cmd = electron;
    args = [path.join(root, suite.file)];
  }
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    failed++;
    console.log('  -> ' + suite.name + ' FAILED');
  }
}

console.log('\n' + '='.repeat(60));
console.log(failed ? failed + ' suite(s) FAILED' : 'every suite passed');
console.log('='.repeat(60));
process.exit(failed ? 1 : 0);

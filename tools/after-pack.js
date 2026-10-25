'use strict';

/*
 * afterPack hook.
 *
 * electron-builder normally uses the rcedit tool from the winCodeSign bundle
 * to stamp the icon and the version information into the packaged executable.
 * That bundle cannot be unpacked on machines without the "create symbolic
 * links" privilege, so the stamping is done here instead, after the
 * application files have been copied but before the installer is assembled.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

exports.default = async function afterPack(context) {
  const pkg = context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, pkg + '.exe');
  if (!fs.existsSync(exe)) {
    console.log('[afterPack] executable not found: ' + exe);
    return;
  }

  const rcedit = path.join(root, 'tools', 'rcedit-x64.exe');
  const icon = path.join(root, 'build', 'icon.ico');
  if (!fs.existsSync(rcedit)) {
    console.log('[afterPack] rcedit not available, skipping resource stamping');
    return;
  }

  const info = context.packager.appInfo;
  const version = (info.version || '1.0.0').replace(/-/g, '.');
  const args = [
    exe,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'FileDescription', 'Graph Digitizer - digitize data from graphs in images',
    '--set-version-string', 'ProductName', 'Graph Digitizer',
    '--set-version-string', 'CompanyName', 'Graph Digitizer',
    '--set-version-string', 'InternalName', 'Graph Digitizer',
    '--set-version-string', 'OriginalFilename', pkg + '.exe',
    '--set-version-string', 'LegalCopyright', 'MIT'
  ];

  try {
    execFileSync(rcedit, args, { stdio: 'inherit' });
    console.log('[afterPack] stamped icon and version info into ' + path.basename(exe));
  } catch (err) {
    console.log('[afterPack] rcedit failed: ' + (err && err.message ? err.message : err));
  }
};

'use strict';

/*
 * Shared test window.
 *
 * Creates a window that serves the renderer through the same custom scheme
 * the shipped application uses, so the tests exercise the real Content
 * Security Policy and the real preload bridge.
 */

const { app, BrowserWindow, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_SCHEME = 'app';
const APP_HOST = 'gd';
const APP_ORIGIN = APP_SCHEME + '://' + APP_HOST;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function registerAppProtocol(root) {
  const base = path.resolve(path.join(root, 'src'));
  protocol.handle(APP_SCHEME, (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (!rel || rel === '/') rel = '/index.html';
    const filePath = path.resolve(path.join(base, rel));
    if (filePath !== base && !filePath.startsWith(base + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = fs.readFileSync(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
  });
}

/**
 * @param {object} options { root, width, height }
 */
function createTestWindow(options) {
  const opt = options || {};
  const root = opt.root;
  registerAppProtocol(root);
  const win = new BrowserWindow({
    width: opt.width || 1440,
    height: opt.height || 920,
    show: false,
    backgroundColor: opt.backgroundColor || '#11151c',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.loadURL(APP_ORIGIN + '/index.html?testhook=1');
  return win;
}

module.exports = { createTestWindow, APP_ORIGIN };

'use strict';

/*
 * Main process side of the LLM integration.
 *
 * The prompt builders and the reply parsers are pure, so that they can be
 * unit tested without Electron. Therefore 'electron' must not be required at
 * the top level of this file; it is required inside the functions that need
 * the application or the safe storage.
 */

const fs = require('fs');
const path = require('path');

/**
 * The model that accepts an image attachment. M2.7 refuses images and
 * M3.1-Flash answered with a malformed body during testing.
 */
const DEFAULT_MODEL = 'MiniMax-M3';

const API_BASE = 'https://api.minimax.chat/v1/chat/completions';

/**
 * The curve reply is cut off below this budget, so it is also the lower
 * bound for every request.
 */
const MIN_MAX_TOKENS = 16000;

const KEY_FILE = 'llm-key.bin';
const KEY_MAGIC = 'GD-LLM-KEY-1';

const SYSTEM_PROMPT =
  'You are a precise image analysis assistant for scientific figures. ' +
  'You always answer with a single JSON object and never with commentary.';

/** A plain number, with an optional sign and an optional exponent. */
const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parses a numeric tick label.
 *
 * A space is used as a thousands separator in some figures, and a comma is
 * accepted for the same reason. The whole text has to be a number, so a
 * label that is not a number at all never yields a half parsed value.
 *
 * @param {string|number} text
 * @returns {number|null} the number, or null when the text is not a number
 */
function parseNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (typeof text !== 'string') return null;
  const compact = text.replace(/[\s\u00a0\u202f]/g, '');
  const grouped = /^[+-]?\d{1,3}(?:,\d{3})+$/.test(compact)
    ? compact.replace(/,/g, '')
    : compact;
  if (!NUMERIC_RE.test(grouped)) return null;
  const value = Number(grouped);
  return Number.isFinite(value) ? value : null;
}

/**
 * Coerces a value that came from the model into a finite number.
 *
 * @param {*} value
 * @returns {number|null}
 */
function coerceNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return parseNumber(value);
  return null;
}

/**
 * Coerces a value into a normalised coordinate inside the unit square.
 *
 * @param {*} value
 * @returns {number|null}
 */
function coerceUnit(value) {
  const number = coerceNumber(value);
  if (number === null) return null;
  if (number < 0 || number > 1) return null;
  return number;
}

/**
 * Collects every balanced JSON object of a text.
 *
 * The braces inside strings are ignored, so a label such as "a { b }" cannot
 * break the scan.
 *
 * @param {string} text
 * @returns {string[]} the candidate JSON texts
 */
function scanJsonObjects(text) {
  const found = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) found.push(text.slice(start, i + 1));
    }
  }
  return found;
}

/**
 * Finds the JSON object of a model reply.
 *
 * The model does not reliably honour a response format, so the reply may
 * arrive as a fenced block, as bare JSON or wrapped in prose. A fenced block
 * is preferred, and among the bare objects the last one usually is the
 * answer.
 *
 * @param {string} text
 * @param {string} [preferredKey] the key that identifies the wanted object
 * @returns {object|null}
 */
function firstJsonObject(text, preferredKey) {
  if (typeof text !== 'string' || !text) return null;
  const candidates = [];
  const fence = /```[ \t]*(?:json)?[ \t]*\r?\n?([\s\S]*?)```/gi;
  let match;
  while ((match = fence.exec(text)) !== null) {
    candidates.push(match[1]);
  }
  const bare = scanJsonObjects(text);
  for (let i = bare.length - 1; i >= 0; i--) candidates.push(bare[i]);

  const parsed = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed.push(value);
    } catch (err) {
      // Not every brace in a reply is a JSON object.
    }
  }
  if (!parsed.length) return null;
  if (preferredKey) {
    for (const value of parsed) {
      if (Array.isArray(value[preferredKey])) return value;
    }
  }
  return parsed[0];
}

/**
 * Builds the instruction that reads the tick labels of a colour bar.
 *
 * @param {{width:number, height:number, orientation:string}} options
 * @returns {string}
 */
function buildBarPrompt(options) {
  const opts = options || {};
  const width = Math.round(Number(opts.width) || 0);
  const height = Math.round(Number(opts.height) || 0);
  const horizontal = String(opts.orientation || '').toLowerCase() === 'horizontal';
  const axis = horizontal ? 'x' : 'y';
  const direction = horizontal ? 'left' : 'top';

  return 'You read the tick labels of a colour bar in a scientific figure.\n' +
    '\n' +
    'The attached image is a crop of a scientific figure. It shows a ' +
    (horizontal ? 'horizontal' : 'vertical') + ' colour bar and the tick ' +
    'labels printed next to it.\n' +
    'Image size: ' + width + ' x ' + height + ' pixels.\n' +
    '\n' +
    'Answer with JSON only. Do not explain anything, do not use markdown ' +
    'and do not repeat these instructions.\n' +
    '\n' +
    'The exact shape of the answer is:\n' +
    '{"ticks":[{"label":"<the text you can read>","value":<number or null>,"position":<number>}]}\n' +
    '\n' +
    'Rules:\n' +
    '- "label" is the tick label exactly as it is printed; use an empty ' +
    'string when it cannot be read.\n' +
    '- "value" is the number that the label stands for, parsed from the ' +
    'label text. A label may be "0", "0.0", "1e-3", "-5" or "2.5E+04"; use ' +
    'null when the label cannot be read as a number.\n' +
    '- "position" is the pixel coordinate of the tick along the long axis of ' +
    'the bar, measured from the TOP-LEFT corner of this image: the ' +
    (horizontal ? 'x' : 'y') + ' coordinate of the tick.\n' +
    '- List the ticks in the order in which they appear along the bar, ' +
    'starting at the ' + direction + '.\n' +
    '- When no label is legible at all, answer exactly {"ticks":[]}.';
}

/**
 * Parses the reply of the colour bar request.
 *
 * @param {string} text
 * @returns {{ticks: Array<{label:string, value:number|null, position:number}>}}
 */
function parseBarReply(text) {
  const data = firstJsonObject(text, 'ticks');
  const ticks = [];
  const list = data && Array.isArray(data.ticks) ? data.ticks : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    // A tick without a position cannot be placed in the figure.
    const position = coerceNumber(entry.position);
    if (position === null) continue;
    let label = '';
    if (typeof entry.label === 'string') label = entry.label;
    else if (entry.label !== null && entry.label !== undefined) label = String(entry.label);
    ticks.push({
      label: label,
      value: coerceNumber(entry.value),
      position: position
    });
  }
  return { ticks: ticks };
}

/**
 * Builds the instruction that extracts the curves of a figure.
 *
 * @param {{width:number, height:number}} options
 * @returns {string}
 */
function buildCurvePrompt(options) {
  const opts = options || {};
  const width = Math.round(Number(opts.width) || 0);
  const height = Math.round(Number(opts.height) || 0);

  return 'You extract the plotted curves of a scientific figure.\n' +
    '\n' +
    'The attached image is a whole scientific figure. It may contain one or ' +
    'several curves (lines), each drawn in its own colour.\n' +
    'Image size: ' + width + ' x ' + height + ' pixels.\n' +
    '\n' +
    'Answer with JSON only. Do not explain anything, do not use markdown ' +
    'and do not repeat these instructions.\n' +
    '\n' +
    'The exact shape of the answer is:\n' +
    '{"series":[{"name":"...","color":"#rrggbb or null","points":[{"x":<0..1>,"y":<0..1>}]}]}\n' +
    '\n' +
    'Rules:\n' +
    '- Every point is normalised to the image size: x = 0 at the left edge of ' +
    'the image and x = 1 at the right edge, y = 0 at the top edge and y = 1 ' +
    'at the bottom edge.\n' +
    '- "name" is a short name for the curve, for example "curve 1".\n' +
    '- "color" is the colour of the curve as "#rrggbb", or null when the ' +
    'colour cannot be determined.\n' +
    '- "points" holds the points of one curve in the order in which they ' +
    'appear along the curve, covering the whole visible curve from one end ' +
    'to the other.\n' +
    '- When the figure contains no curve at all, answer exactly {"series":[]}.';
}

/**
 * Normalises the colour of a series.
 *
 * @param {*} value
 * @returns {string|null}
 */
function coerceColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return ('#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3]);
  }
  return null;
}

/**
 * Parses the reply of the curve extraction.
 *
 * @param {string} text
 * @returns {{series: Array<{name:string, color:string|null, points:Array<{x:number,y:number}>}>}}
 */
function parseCurveReply(text) {
  const data = firstJsonObject(text, 'series');
  const series = [];
  const list = data && Array.isArray(data.series) ? data.series : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const points = [];
    const raw = Array.isArray(entry.points) ? entry.points : [];
    for (const point of raw) {
      if (!point || typeof point !== 'object' || Array.isArray(point)) continue;
      const x = coerceUnit(point.x);
      const y = coerceUnit(point.y);
      // A point outside the image cannot belong to a curve of the image.
      if (x === null || y === null) continue;
      points.push({ x: x, y: y });
    }
    // A single point does not describe a curve.
    if (points.length < 2) continue;
    series.push({
      name: typeof entry.name === 'string' ? entry.name : '',
      color: coerceColor(entry.color),
      points: points
    });
  }
  return { series: series };
}

/**
 * Absolute path of the file that holds the API key.
 *
 * @returns {string}
 */
function keyFilePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), KEY_FILE);
}

/**
 * Reads the stored API key.
 *
 * The key never leaves the main process; the renderer only learns whether a
 * key is configured.
 *
 * @returns {string|null} the key, or null when none is stored
 */
function readKey() {
  let raw = null;
  try {
    raw = fs.readFileSync(keyFilePath(), 'utf8');
  } catch (err) {
    // A missing file simply means that no key was stored yet.
    return null;
  }
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== KEY_MAGIC) return null;
  const mode = (lines[1] || '').trim();
  const payload = (lines[2] || '').trim();
  if (!payload) return null;
  try {
    if (mode === 'encrypted') {
      const { safeStorage } = require('electron');
      const key = safeStorage.decryptString(Buffer.from(payload, 'base64'));
      return key || null;
    }
    if (mode === 'plain') {
      const key = Buffer.from(payload, 'base64').toString('utf8');
      return key || null;
    }
  } catch (err) {
    // The key cannot be decrypted any more, for example because the system
    // key store was reset. That is handled as "not configured".
    return null;
  }
  return null;
}

/**
 * Stores the API key, encrypted with the system key store when possible.
 *
 * @param {string} key
 * @returns {{ok:boolean, error?:string}}
 */
function saveKey(key) {
  if (typeof key !== 'string' || !key.trim()) {
    return { ok: false, error: 'The API key is empty.' };
  }
  const value = key.trim();
  try {
    const { safeStorage } = require('electron');
    const file = keyFilePath();
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      fs.writeFileSync(file, KEY_MAGIC + '\n' + 'encrypted\n' +
        encrypted.toString('base64') + '\n', 'utf8');
    } else {
      // Without a system key store the key cannot be encrypted. The file is
      // still written, and it records that it is not encrypted.
      fs.writeFileSync(file, KEY_MAGIC + '\n' + 'plain\n' +
        Buffer.from(value, 'utf8').toString('base64') + '\n', 'utf8');
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * Removes the stored API key.
 *
 * @returns {{ok:boolean}}
 */
function forgetKey() {
  try {
    fs.unlinkSync(keyFilePath());
  } catch (err) {
    // A missing file is not an error, the key is gone either way.
  }
  return { ok: true };
}

/**
 * Tells whether an API key is available.
 *
 * @returns {boolean}
 */
function isConfigured() {
  const key = readKey();
  return typeof key === 'string' && key.length > 0;
}

/**
 * Reads the text of the assistant message of a reply.
 *
 * @param {*} data the parsed reply
 * @returns {string}
 */
function extractContent(data) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice && choice.message;
  const content = message && message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (part && typeof part.text === 'string') parts.push(part.text);
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Sends one request to the model.
 *
 * @param {{system:string, prompt:string, imageDataURL:string, maxTokens:number}} options
 * @returns {Promise<{ok:boolean, text:string|null, error:string|null}>}
 */
async function callModel(options) {
  const opts = options || {};
  const key = readKey();
  if (!key) {
    return { ok: false, text: null, error: 'No API key has been configured.' };
  }

  const content = [];
  if (opts.prompt) content.push({ type: 'text', text: String(opts.prompt) });
  if (opts.imageDataURL) {
    content.push({ type: 'image_url', image_url: { url: String(opts.imageDataURL) } });
  }
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: String(opts.system) });
  messages.push({ role: 'user', content: content });

  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages: messages,
    max_tokens: Math.max(MIN_MAX_TOKENS, Math.round(Number(opts.maxTokens) || MIN_MAX_TOKENS)),
    temperature: 0.2
  };

  try {
    const request = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    };
    // A request that never ends would block the renderer for ever.
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      request.signal = AbortSignal.timeout(300000);
    }

    const response = await fetch(API_BASE, request);
    if (!response.ok) {
      return {
        ok: false,
        text: null,
        error: 'The model request failed with HTTP ' + response.status + '.'
      };
    }

    // The body is large, so it is read as text and parsed defensively.
    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      data = null;
    }
    const text = extractContent(data);
    if (!text) {
      return { ok: false, text: null, error: 'The model returned an empty reply.' };
    }
    return { ok: true, text: text, error: null };
  } catch (err) {
    const message = err && err.name === 'TimeoutError'
      ? 'The model request timed out.'
      : 'The model request failed: ' + String(err && err.message ? err.message : err);
    return { ok: false, text: null, error: message };
  }
}

/**
 * Reads the tick labels of a colour bar.
 *
 * The positions of the answer stay relative to the crop; the caller knows
 * the origin of the crop and adds it.
 *
 * @param {{image:string, width:number, height:number, offsetX:number, offsetY:number, orientation:string}} payload
 * @returns {Promise<{ok:boolean, error?:string, ticks:Array}>}
 */
async function readColorBar(payload) {
  const data = payload || {};
  if (typeof data.image !== 'string' || !data.image) {
    return { ok: false, error: 'The colour bar image is missing.', ticks: [] };
  }
  const width = Math.round(Number(data.width) || 0);
  const height = Math.round(Number(data.height) || 0);
  const reply = await callModel({
    system: SYSTEM_PROMPT,
    prompt: buildBarPrompt({ width: width, height: height, orientation: data.orientation }),
    imageDataURL: data.image,
    maxTokens: MIN_MAX_TOKENS
  });
  if (!reply.ok) {
    return { ok: false, error: reply.error, ticks: [] };
  }
  if (!firstJsonObject(reply.text, 'ticks')) {
    return { ok: false, error: 'The model did not answer with a JSON object.', ticks: [] };
  }
  return { ok: true, ticks: parseBarReply(reply.text).ticks };
}

/**
 * Extracts the curves of a whole figure.
 *
 * @param {{image:string, width:number, height:number}} payload
 * @returns {Promise<{ok:boolean, error?:string, series:Array}>}
 */
async function extractCurves(payload) {
  const data = payload || {};
  if (typeof data.image !== 'string' || !data.image) {
    return { ok: false, error: 'The figure image is missing.', series: [] };
  }
  const width = Math.round(Number(data.width) || 0);
  const height = Math.round(Number(data.height) || 0);
  const reply = await callModel({
    system: SYSTEM_PROMPT,
    prompt: buildCurvePrompt({ width: width, height: height }),
    imageDataURL: data.image,
    maxTokens: MIN_MAX_TOKENS
  });
  if (!reply.ok) {
    return { ok: false, error: reply.error, series: [] };
  }
  if (!firstJsonObject(reply.text, 'series')) {
    return { ok: false, error: 'The model did not answer with a JSON object.', series: [] };
  }
  return { ok: true, series: parseCurveReply(reply.text).series };
}

module.exports = {
  DEFAULT_MODEL: DEFAULT_MODEL,
  API_BASE: API_BASE,
  buildBarPrompt: buildBarPrompt,
  parseBarReply: parseBarReply,
  parseNumber: parseNumber,
  buildCurvePrompt: buildCurvePrompt,
  parseCurveReply: parseCurveReply,
  readKey: readKey,
  saveKey: saveKey,
  forgetKey: forgetKey,
  isConfigured: isConfigured,
  callModel: callModel,
  readColorBar: readColorBar,
  extractCurves: extractCurves
};

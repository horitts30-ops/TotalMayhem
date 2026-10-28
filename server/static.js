// ---------------------------------------------------------------------------
// static.js - serves the game's web files (public/) COMPRESSED.
//
// The browser downloads about 400 KB of scripts and styles when it opens the game. Compressed (brotli or
// gzip, whichever the browser says it understands) that is roughly a quarter of the size, so the game
// appears sooner, especially on slower Wi-Fi. Each file is compressed once, in the background, and kept
// in memory; if the file changes on disk it is compressed again.
//
// The files are always sent with "Cache-Control: no-cache" plus an ETag: the browser keeps its copy but
// asks "has it changed?" every time, and gets a tiny "304 not modified" answer if not. That way a friend
// can never be stuck with a stale half-updated copy of the game after you update it.
//
// Anything this does not handle (images, unknown types, browsers that accept no compression) falls
// through to express.static in app.js, so nothing is ever lost.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const MAX_FILE = 2 * 1024 * 1024; // bigger files are left to express.static

function compress(enc, data) {
  return new Promise((resolve, reject) => {
    const done = (err, buf) => (err ? reject(err) : resolve(buf));
    if (enc === 'br') {
      zlib.brotliCompress(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }, done);
    } else zlib.gzip(data, { level: 9 }, done);
  });
}

function pickEncoding(header) {
  const h = String(header || '');
  if (/(^|[\s,])br\s*(;|,|$)/.test(h)) return 'br';
  if (/(^|[\s,])gzip\s*(;|,|$)/.test(h)) return 'gzip';
  return null;
}

function compressedStatic(dir) {
  const root = path.resolve(dir);
  const cache = new Map(); // "enc:file" -> { mtimeMs, size, buf, etag }
  const pending = new Map(); // "enc:file" -> Promise (so a burst of requests compresses once)

  function entry(enc, file, st) {
    const key = `${enc}:${file}`;
    const hit = cache.get(key);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return Promise.resolve(hit);
    const wait = pending.get(key);
    if (wait) return wait;
    const p = fs.promises
      .readFile(file)
      .then((data) => compress(enc, data))
      .then((buf) => {
        const e = { mtimeMs: st.mtimeMs, size: st.size, buf, etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"` };
        cache.set(key, e);
        return e;
      })
      .finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }

  function middleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p;
    try {
      p = decodeURIComponent(req.path);
    } catch (e) {
      return next();
    }
    if (p.includes('\0')) return next();
    if (p.endsWith('/')) p += 'index.html';
    const type = TYPES[path.extname(p).toLowerCase()];
    if (!type) return next();
    const file = path.join(root, p);
    if (!file.startsWith(root + path.sep)) return next(); // never leave public/
    const enc = pickEncoding(req.headers['accept-encoding']);
    if (!enc) return next();
    fs.stat(file, (err, st) => {
      if (err || !st.isFile() || st.size > MAX_FILE) return next();
      entry(enc, file, st).then(
        (e) => {
          res.setHeader('Content-Type', type);
          res.setHeader('Content-Encoding', enc);
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('ETag', e.etag);
          if (req.headers['if-none-match'] === e.etag) {
            res.statusCode = 304;
            return res.end();
          }
          res.setHeader('Content-Length', e.buf.length);
          res.end(req.method === 'HEAD' ? undefined : e.buf);
        },
        () => next() // anything odd: plain file instead
      );
    });
  }

  // Compress everything once in the background so even the first visitor gets the small files.
  middleware.warm = function warm() {
    const todo = [];
    (function walk(d) {
      let list = [];
      try {
        list = fs.readdirSync(d, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const f of list) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) walk(full);
        else if (TYPES[path.extname(f.name).toLowerCase()]) todo.push(full);
      }
    })(root);
    return (async () => {
      for (const file of todo) {
        try {
          const st = await fs.promises.stat(file);
          if (st.size > MAX_FILE) continue;
          await entry('br', file, st);
          await entry('gzip', file, st);
        } catch (e) {
          /* a file vanished: fine */
        }
      }
    })();
  };
  return middleware;
}

module.exports = { compressedStatic, pickEncoding };

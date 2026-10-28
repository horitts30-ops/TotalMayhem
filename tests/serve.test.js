// Web file serving: compression, caching headers, and that the page has its "could not start" safety net.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { createGameServer } = require('../server/app');
const { pickEncoding } = require('../server/static');

const PUBLIC = path.join(__dirname, '..', 'public');

function get(port, url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
async function withServer(fn) {
  const server = createGameServer({ quiet: true });
  const port = await server.start(0, '127.0.0.1');
  try {
    await fn(port);
  } finally {
    await server.stop();
  }
}

test('serve: picks brotli, then gzip, otherwise nothing', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('gzip;q=1.0, identity'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding('brotli-ish'), null);
});

test('serve: every script and style comes back compressed, identical once unpacked, and much smaller', async () => {
  await withServer(async (port) => {
    let plain = 0;
    let small = 0;
    for (const f of ['/', '/style.css', '/js/main.js', '/js/renderer.js', '/js/wardrobe.js', '/js/shop.js']) {
      const file = path.join(PUBLIC, f === '/' ? 'index.html' : f);
      const original = fs.readFileSync(file);
      const gz = await get(port, f, { 'accept-encoding': 'gzip' });
      assert.equal(gz.status, 200, f);
      assert.equal(gz.headers['content-encoding'], 'gzip', f);
      assert.equal(gz.headers.vary, 'Accept-Encoding');
      assert.equal(gz.headers['cache-control'], 'no-cache');
      assert.ok(zlib.gunzipSync(gz.body).equals(original), `${f} gzip round trip`);
      const br = await get(port, f, { 'accept-encoding': 'gzip, deflate, br' });
      assert.equal(br.headers['content-encoding'], 'br', f);
      assert.ok(zlib.brotliDecompressSync(br.body).equals(original), `${f} brotli round trip`);
      plain += original.length;
      small += br.body.length;
    }
    assert.ok(small < plain * 0.4, `compressed is much smaller (${small} of ${plain})`);
  });
});

test('serve: a browser that accepts no compression still gets the plain file; types are right', async () => {
  await withServer(async (port) => {
    const r = await get(port, '/js/main.js', { 'accept-encoding': 'identity' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-encoding'], undefined);
    assert.ok(r.body.equals(fs.readFileSync(path.join(PUBLIC, 'js', 'main.js'))));
    assert.match(r.headers['content-type'], /javascript/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    const c = await get(port, '/style.css', { 'accept-encoding': 'gzip' });
    assert.match(c.headers['content-type'], /text\/css/);
    const h = await get(port, '/health');
    assert.equal(h.body.toString(), 'ok');
  });
});

test('serve: "not modified" answers (ETag) so a changed file is never stale and an unchanged one is not re-sent', async () => {
  await withServer(async (port) => {
    const first = await get(port, '/js/shop.js', { 'accept-encoding': 'gzip' });
    assert.ok(first.headers.etag);
    const again = await get(port, '/js/shop.js', { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const other = await get(port, '/js/shop.js', { 'accept-encoding': 'gzip', 'if-none-match': 'W/"nope"' });
    assert.equal(other.status, 200);
    const head = await get(port, '/js/shop.js', { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    // the plain path revalidates too
    const p = await get(port, '/js/shop.js', {});
    assert.equal(p.headers['cache-control'], 'no-cache');
    assert.equal((await get(port, '/js/shop.js', { 'if-none-match': p.headers.etag })).status, 304);
  });
});

test('serve: cannot read files outside public/, and missing files are a plain 404', async () => {
  await withServer(async (port) => {
    for (const bad of ['/..%2fpackage.json', '/%2e%2e/package.json', '/js/..%2f..%2fpackage.json', '/..%2f..%2f..%2fetc%2fpasswd', '/%00.js', '/js/%E0%A4%A.js', '/server/app.js', '/nope.js']) {
      const r = await get(port, bad, { 'accept-encoding': 'gzip' });
      assert.ok(r.status === 404 || r.status === 400 || r.status === 403, `${bad} -> ${r.status}`);
      assert.ok(!r.body.toString().includes('"name": "total-mayhem"'), bad);
      assert.ok(!r.body.toString().includes('createGameServer'), bad);
    }
  });
});

test('serve: the page has its safety net - an on-screen error box if the game cannot start', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.ok(html.includes('__tmBooted') && html.includes('boot-error'), 'watchdog present');
  const main = fs.readFileSync(path.join(PUBLIC, 'js', 'main.js'), 'utf8');
  assert.ok(main.includes('window.__tmBooted = true'), 'main.js reports that it started');
  assert.ok(html.indexOf('boot-error') < html.indexOf('type="module"'), 'the watchdog loads before the game scripts');
  // every preloaded module really exists
  for (const m of html.matchAll(/rel="modulepreload" href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(PUBLIC, m[1])), m[1]);
});

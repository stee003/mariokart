// Smoke-tests the `npm start` static server: boots it on an ephemeral port
// and checks that the game, its CSS and its ES modules are served with the
// MIME types a browser needs (modules must not come back as octet-stream).
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal GET that sends `rawPath` exactly as given (fetch/WHATWG URL would
// collapse "../" segments client-side, hiding a server-side traversal bug).
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

function waitForUrl(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const m = log.match(/http:\/\/localhost:(\d+)/);
      if (m) return resolve(Number(m[1]));
      if (child.exitCode !== null) return reject(new Error(`server exited\n${log}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`server never printed a URL\n${log}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

try {
  const port = await waitForUrl();
  const base = `http://127.0.0.1:${port}`;

  console.log('--- Static server ---');
  check('server binds an ephemeral port', Number.isInteger(port) && port > 0);

  const index = await fetch(`${base}/`);
  check('GET / -> 200', index.status === 200, `status=${index.status}`);
  check('GET / -> text/html', (index.headers.get('content-type') || '').includes('text/html'));
  const html = await index.text();
  check('body mentions the game', html.includes('Sunforge Racers'));

  const css = await fetch(`${base}/css/style.css`);
  check('GET /css/style.css -> text/css',
    css.status === 200 && (css.headers.get('content-type') || '').includes('text/css'),
    `status=${css.status} type=${css.headers.get('content-type')}`);

  const mainJs = await fetch(`${base}/src/main.js`);
  check('GET /src/main.js -> 200', mainJs.status === 200);
  check('GET /src/main.js -> JS MIME (ES modules need it)',
    /text\/javascript|application\/javascript/.test(mainJs.headers.get('content-type') || ''),
    `type=${mainJs.headers.get('content-type')}`);

  const three = await fetch(`${base}/lib/three.module.js`);
  check('GET /lib/three.module.js -> 200', three.status === 200);
  check('three.module.js non-empty', Number(three.headers.get('content-length')) > 1000);

  const head = await fetch(`${base}/`, { method: 'HEAD' });
  check('HEAD / -> 200 with no body', head.status === 200 && (await head.text()) === '');

  const missing = await fetch(`${base}/does-not-exist.js`);
  check('missing file -> 404', missing.status === 404, `status=${missing.status}`);

  // raw request so the client does not normalise "../" away before sending
  const traversal = await rawGet(port, '/../package.json');
  check('path traversal is blocked', traversal.status === 403 || !traversal.body.includes('"scripts"'),
    `status=${traversal.status}`);

  const encodedTraversal = await rawGet(port, '/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
  check('encoded traversal is blocked', encodedTraversal.status === 403 || encodedTraversal.status === 404,
    `status=${encodedTraversal.status}`);

  const nope = await fetch(`${base}/`, { method: 'POST' }).catch(() => null);
  check('POST -> 405', nope !== null && nope.status === 405, `status=${nope && nope.status}`);
} catch (err) {
  failed++;
  console.log(`  FAIL server smoke test threw: ${err.message}`);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

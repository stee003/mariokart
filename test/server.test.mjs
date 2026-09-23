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

// --- Port parsing: a malformed $PORT must warn and fall back, not crash
// with the cryptic ERR_SOCKET_BAD_PORT RangeError ---

function spawnServer(extraEnv, args) {
  const proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  return {
    proc,
    get log() { return log; },
    // Resolves with the port once the server prints its URL.
    ready: (timeoutMs = 10000) => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const m = log.match(/http:\/\/localhost:(\d+)/);
        if (m) return resolve(Number(m[1]));
        if (proc.exitCode !== null) return reject(new Error(`server exited early (code ${proc.exitCode})\n${log}`));
        if (Date.now() - started > timeoutMs) return reject(new Error(`server never printed a URL\n${log}`));
        setTimeout(tick, 50);
      };
      tick();
    }),
    // Resolves with the exit code once the server exits (or timeout).
    exit: (timeoutMs = 10000) => new Promise((resolve) => {
      const t = setTimeout(() => resolve(-1), timeoutMs);
      proc.once('exit', (code) => { clearTimeout(t); resolve(code); });
    }),
  };
}

async function portParsingCase(name, extraEnv, args) {
  const srv = spawnServer(extraEnv, args);
  try {
    const port = await srv.ready();
    check(`${name}: server still boots (no ERR_SOCKET_BAD_PORT)`, Number.isInteger(port) && port > 0, `port=${port}`);
    check(`${name}: invalid value is reported`, /not a valid port/i.test(srv.log), srv.log.trim());
    check(`${name}: warning names the offending value`, srv.log.includes(extraEnv.PORT), srv.log.trim());
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}: ${err.message}`);
  } finally {
    srv.proc.kill('SIGTERM');
    await new Promise((r) => srv.proc.once('exit', r));
  }
}

console.log('--- Port parsing ---');
// $PORT is garbage, the CLI argument is fine -> use the argument.
await portParsingCase('garbage $PORT with valid argv', { PORT: 'not-a-port', HOST: '127.0.0.1' }, ['server.mjs', '0']);
// Out-of-range $PORT with a valid argv -> use the argument.
await portParsingCase('out-of-range $PORT with valid argv', { PORT: '99999', HOST: '127.0.0.1' }, ['server.mjs', '0']);
// Whitespace-padded $PORT is accepted, not rejected.
{
  const srv = spawnServer({ PORT: ' 0 ', HOST: '127.0.0.1' }, ['server.mjs']);
  try {
    const port = await srv.ready();
    check('whitespace-padded $PORT is accepted', Number.isInteger(port) && port > 0 && !/not a valid port/i.test(srv.log), `port=${port}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL whitespace-padded $PORT: ${err.message}`);
  } finally {
    srv.proc.kill('SIGTERM');
    await new Promise((r) => srv.proc.once('exit', r));
  }
}
// Both sources garbage -> must fall back to 8000. Occupy 8000 first so the
// fallback attempt is observable via the friendly EADDRINUSE message.
{
  const blocker = http.createServer();
  const got8000 = await new Promise((r) => {
    blocker.once('error', () => r(false));
    blocker.listen(8000, '127.0.0.1', () => r(true));
  });
  if (got8000) {
    const srv = spawnServer({ PORT: 'garbage', HOST: '127.0.0.1' }, ['server.mjs']);
    const code = await srv.exit();
    check('all-garbage sources fall back to port 8000',
      code === 1 && srv.log.includes('Port 8000 is already in use'), `code=${code}`);
    check('all-garbage sources explain the rejection', /not a valid port/i.test(srv.log) && /Falling back to default port 8000/i.test(srv.log));
  } else {
    console.log('  SKIP 8000-fallback test (port 8000 already in use)');
  }
  await new Promise((r) => { blocker.close(() => r()); });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

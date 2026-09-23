#!/usr/bin/env node
// Zero-dependency game server for Sunforge Racers: static files + the online
// API + the netplay relay (all in-process, no npm packages).
//
// Replaces `python3 -m http.server 8000`, which fails on Windows machines
// without Python installed (the `python3` name hits the Microsoft Store
// app-execution alias stub instead of a real interpreter). Node is already
// required for `npm test`, so this serves the game on every platform.
//
// Usage:
//   npm start              # http://localhost:8000
//   PORT=8080 npm start    # custom port
//   node server.mjs 8080   # custom port via argument
//
// Binds 0.0.0.0 so it also works inside containers / sandboxes / previews.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OnlineStore } from './src/net/store.js';
import { createApi } from './src/net/api.js';
import { WsServer } from './src/net/ws.js';
import { RoomManager } from './src/net/rooms.js';
import { createRelay } from './src/net/relay.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || process.argv[2] || 8000);
const HOST = process.env.HOST || '0.0.0.0';

// Online state lives in data/online.json (git-ignored, atomic writes). Set
// DATA_DIR to a temp directory for throw-away servers (tests do this).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'online.json');

function loadStore() {
  if (process.env.ONLINE_OFF === '1') return new OnlineStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return OnlineStore.fromJSON(JSON.parse(raw), { dataFile: DATA_FILE });
  } catch {
    return new OnlineStore({ dataFile: DATA_FILE });
  }
}

const store = loadStore();
store.setPersister((data) => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);       // atomic swap: never a half-written file
  } catch (err) {
    console.warn('  [online] could not persist state:', err.message);
  }
});

const rooms = new RoomManager();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

function sendError(res, status, message) {
  const body = `<!DOCTYPE html><meta charset="utf-8"><title>${status}</title>` +
    `<body style="font-family:system-ui;background:#1b1206;color:#f6e0b5;padding:2rem">` +
    `<h1>${status} ${message}</h1><p><a style="color:#ffb347" href="/">Back to the game</a></p>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

// Resolve a request URL to a file inside ROOT. Returns null if it escapes ROOT.
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  // Reject any ".." segment outright; the clamp below is only a safety net.
  if (decoded.split(/[/\\]+/).includes('..')) return null;
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

const api = createApi({ store, rooms });

const server = http.createServer((req, res) => {
  // Online API first: it owns /api/* and is method-aware (GET + POST).
  const url = req.url || '/';
  if (url === '/api' || url.startsWith('/api/')) {
    api.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server-error' }));
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed\n');
  }

  let target = resolvePath(req.url || '/');
  if (target === null) return sendError(res, 403, 'Forbidden');

  let info = statOrNull(target);
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html');
    info = statOrNull(target);
  }
  // "/index" -> "/index.html", "/" -> "/index.html" (URLs without extensions)
  if (!info && !path.extname(target)) {
    const withHtml = `${target}.html`;
    if (statOrNull(withHtml)?.isFile()) {
      target = withHtml;
      info = statOrNull(target);
    }
  }
  if (!info?.isFile()) return sendError(res, 404, 'Not Found');

  const headers = {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache, no-store, must-revalidate', // always serve fresh files
    'X-Content-Type-Options': 'nosniff',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(target);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// Netplay relay: lobby join/leave, kart state broadcast, race start/finish.
const ws = new WsServer(server, { path: '/ws' });
const relay = createRelay({ ws, rooms });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Try another one:  PORT=${PORT + 1} npm start\n`);
  } else {
    console.error(`\n  Server error: ${err.message}\n`);
  }
  process.exit(1);
});

function shutdown() {
  relay.stop();
  ws.close();
  store.flush();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`\n  Sunforge Racers is running!`);
  console.log(`  Local:   http://localhost:${port}`);
  console.log(`  Network: http://${HOST}:${port}   (bound to ${HOST})`);
  console.log(`\n  Serving ${ROOT}`);
  console.log(`  Online API: /api/*   Netplay relay: /ws   State: ${DATA_FILE}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

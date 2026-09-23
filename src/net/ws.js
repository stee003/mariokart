// ============================================================================
// Minimal WebSocket server (RFC 6455) - zero dependencies.
//
// The project ships without npm packages, so the netplay relay implements just
// the subset a game needs: text frames, ping/pong, close, and a hard payload
// cap. No extensions, no permessage-deflate, no continuation chains (all game
// messages are small, single-frame JSON).
// ============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;      // one game message, generously
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

// --------------------------------------------------------------- frame encode
export function encodeFrame(payload, opcode = OP.TEXT) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;          // FIN + opcode
  return Buffer.concat([header, data]);
}

// --------------------------------------------------------------- frame decode
// Returns { frames: [{opcode, payload}], rest } - `rest` holds a partial frame.
export function decodeFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buf.length) break;
      len = buf.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(cursor));
      cursor += 8;
    }
    if (len > MAX_PAYLOAD) throw new Error('payload too large');
    let maskKey = null;
    if (masked) {
      if (cursor + 4 > buf.length) break;
      maskKey = buf.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + len > buf.length) break;
    const payload = Buffer.from(buf.subarray(cursor, cursor + len));
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }
    frames.push({ opcode, payload });
    offset = cursor + len;
  }
  return { frames, rest: buf.subarray(offset) };
}

// ------------------------------------------------------------- connection
export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.id = randomBytes(6).toString('hex');
    this.alive = true;
    this.closed = false;
    this.data = Object.create(null);      // scratch space for the relay
    this._buf = Buffer.alloc(0);

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => this.close(1011));
    socket.on('close', () => {
      this.closed = true;
      this.emit('close');
    });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    let decoded;
    try {
      decoded = decodeFrames(this._buf);
    } catch (e) {
      this.close(1009);      // message too big
      return;
    }
    this._buf = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.opcode === OP.TEXT) {
        let msg = null;
        try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { msg = null; }
        this.emit('message', msg, frame.payload);
      } else if (frame.opcode === OP.PING) {
        this._raw(encodeFrame(frame.payload, OP.PONG));
      } else if (frame.opcode === OP.PONG) {
        this.alive = true;
        this.emit('pong');
      } else if (frame.opcode === OP.CLOSE) {
        this.close(1000);
      }
      // binary/continuation frames are ignored: the relay is JSON-only
    }
  }

  _raw(buf) {
    if (this.closed) return false;
    try { return this.socket.write(buf); } catch { return false; }
  }

  send(obj) {
    if (typeof obj === 'string') return this._raw(encodeFrame(obj, OP.TEXT));
    return this._raw(encodeFrame(JSON.stringify(obj), OP.TEXT));
  }

  ping() { this._raw(encodeFrame('', OP.PING)); }

  close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    try {
      const buf = Buffer.alloc(4);
      buf.writeUInt16BE(code, 0);
      this.socket.write(encodeFrame(buf, OP.CLOSE));
      this.socket.end();
    } catch { /* socket already gone */ }
    this.emit('close');
  }
}

// ------------------------------------------------------------------ server
export class WsServer extends EventEmitter {
  constructor(httpServer, { path = '/ws', onConnection = null } = {}) {
    super();
    this.path = path;
    this.connections = new Set();
    this.onConnection = onConnection;
    httpServer.on('upgrade', (req, socket) => this._upgrade(req, socket));
  }

  _upgrade(req, socket) {
    const url = req.url || '';
    const path = url.split('?')[0];
    if (path !== this.path || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    const conn = new WsConnection(socket, req);
    this.connections.add(conn);
    conn.on('close', () => this.connections.delete(conn));
    this.emit('connection', conn);
    if (this.onConnection) this.onConnection(conn);
  }

  broadcast(obj, filter = null) {
    for (const conn of this.connections) {
      if (!conn.closed && (!filter || filter(conn))) conn.send(obj);
    }
  }

  close() {
    for (const conn of this.connections) conn.close(1001);
    this.connections.clear();
  }
}

export { OP, MAX_PAYLOAD };

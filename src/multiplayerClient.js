import { validateInput } from './multiplayer.js';

// Transport-agnostic client: WebSocket when supplied, polling fallback keeps
// races playable when a proxy or a packet-lossy connection drops the socket.
export class MultiplayerClient {
  constructor({ url, fetchImpl = fetch, onSnapshot = () => {}, onEvent = () => {} } = {}) { this.url = url; this.fetch = fetchImpl; this.onSnapshot = onSnapshot; this.onEvent = onEvent; this.seq = 0; this.connected = false; }
  async join({ mode = 'casual', region = 'auto', track, laps = 3, rules = {} } = {}) { const r = await this.fetch(`${this.url}/api/multiplayer/races`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, region, track, laps, rules }) }); if (!r.ok) throw new Error(`join failed: ${r.status}`); this.session = await r.json(); this.connected = true; return this.session; }
  async sendInput(input) { if (!this.session) return; const payload = validateInput({ ...input, seq: ++this.seq }); await this.fetch(`${this.url}/api/multiplayer/races/${this.session.raceId}/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => { this.connected = false; }); }
  async poll() { if (!this.session) return null; const r = await this.fetch(`${this.url}/api/multiplayer/races/${this.session.raceId}/snapshot`); if (!r.ok) return null; const snapshot = await r.json(); this.onSnapshot(snapshot); return snapshot; }
  async reconnect() { if (!this.session) return false; const r = await this.fetch(`${this.url}/api/multiplayer/races/${this.session.raceId}/reconnect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: this.session.reconnectToken }) }); this.connected = r.ok; return r.ok; }
}

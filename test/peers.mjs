// Run with: node test/peers.mjs
// Simulates two clients using Foundry 14.369's SimplePeerAVClient connection logic (copied below) on a virtual
// clock, with a fake SimplePeer that fails the way the real one does, first unpatched and then with this
// module's workaround applied.
import { EventEmitter } from "node:events";

const POLL_MS = 8000;// CONFIG.WebRTC.connectedUserPollIntervalS
const FAIL_DETECT_MS = 5000;// how long a connected peer takes to notice its partner is gone
let now = 0;
Date.now = () => now;
let errors = [];
let all_peers = [];
let seq = 0;

class FakePeer extends EventEmitter {
  constructor({ initiator }) {
    super();
    this.initiator = initiator;
    this.fp = "fp" + (++seq);
    this.destroyed = false;
    this._connected = false;
    this._pc = { connectionState: "new", iceConnectionState: "new" };
    this.remoteFp = null;
    this.negotiatedAt = null;
    this.partnerLostAt = null;
    all_peers.push(this);
  }
  get connected() { return this._connected; }
  start() {
    if (this.initiator && !this.destroyed && !this.started) {
      this.started = true;
      this.emit("signal", { type: "offer", sdp: "v=0\na=fingerprint:sha-256 " + this.fp + "\n" });
    }
  }
  signal(data) {
    if (this.destroyed) return;
    const fp = data.sdp?.match(/fingerprint:sha-256 (\S+)/)?.[1];
    if (data.type === "offer") {
      if (this.initiator) return this.fail("Called in wrong state: have-local-offer");
      if (this.remoteFp && this.remoteFp !== fp) return this.fail("The order of m-lines in subsequent offer doesn't match");
      this.remoteFp = fp;
      this.negotiatedAt = now;
      this.emit("signal", { type: "answer", sdp: "a=fingerprint:sha-256 " + this.fp + "\n" });
      this.emit("signal", { candidate: { candidate: "host " + this.fp } });
    } else if (data.type === "answer") {
      if (!this.initiator || this.remoteFp) return this.fail("Called in wrong state: have-remote-offer");
      this.remoteFp = fp;
      this.negotiatedAt = now;
    } else if (data.candidate) {
      if (!this.remoteFp) return;// queued until the offer arrives
      if (!data.candidate.candidate.endsWith(this.remoteFp)) return this.fail("Unknown ufrag");
    }
  }
  partner() {
    return all_peers.find(p => p.fp === this.remoteFp && p.remoteFp === this.fp && !p.destroyed);
  }
  tick(connect_ms) {
    if (this.destroyed) return;
    const partner = this.partner();
    if (this._connected) {
      if (partner) return;
      this.partnerLostAt ??= now;
      if (now - this.partnerLostAt >= FAIL_DETECT_MS) this.fail("Connection failed.");
    } else if (partner && this.negotiatedAt !== null && now - this.negotiatedAt >= connect_ms) {
      this._connected = true;
      this._pc.connectionState = "connected";
      this.emit("stream", { getTracks: () => [], fp: this.fp });
    }
  }
  fail(message) {
    this.emit("error", new Error(message));
    this.destroy();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

// --- Foundry 14.369 SimplePeerAVClient peer management, minus media setup
let queue = [];
class SimplePeerAVClient {
  constructor(id) {
    this.id = id;
    this.peers = new Map();
    this.remoteStreams = new Map();
    this.master = { render() {}, settings: { handleUserActivity() {}, getUser: () => ({}) } };
  }
  async initializePeerStream(userId) {
    const peer = this.peers.get(userId);
    if (peer?.connected || peer?._connecting) return peer;
    return this.connectPeer(userId, true);
  }
  receiveSignal(userId, data) {
    let peer = this.peers.get(userId);
    if (!peer) peer = this.connectPeer(userId, false);
    peer.signal(data);
  }
  connectPeer(userId, isInitiator = false) {
    const peer = new FakePeer({ initiator: isInitiator });
    this.peers.set(userId, peer);
    peer.on("signal", data => queue.push({ from: this.id, to: userId, data }));
    peer.on("stream", stream => { this.remoteStreams.set(userId, stream); });
    peer.on("close", () => this.disconnectPeer(userId));
    peer.on("error", err => {
      errors.push(this.id + ": " + err.message);
      if (peer.connected) return this.disconnectPeer(userId);
    });
    return peer;
  }
  async disconnectPeer(userId) {
    const remoteStream = this.remoteStreams.get(userId);
    if (remoteStream) {
      this.remoteStreams.delete(userId);
      for (const track of remoteStream.getTracks()) await track.stop();
    }
    const peer = this.peers.get(userId);
    if (peer) {
      this.peers.delete(userId);
      await peer.destroy();
    }
  }
}

// --- minimal Foundry globals so the module can load and run its init hook
const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), callAll: (n, ...a) => (hooks[n] ?? []).forEach(f => f(...a)) };
const el = () => ({ classList: { add() {}, toggle() {} }, setAttribute() {}, getAttribute() {}, appendChild() {}, append() {} });
globalThis.document = { hidden: false, createElement: el, addEventListener() {}, querySelector: () => null };
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { footer: {} } });
const settings = {};
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() } },
  av: { clients: { SimplePeerAVClient }, AVSettings: { AV_MODES: { AUDIO: 1, AUDIO_VIDEO: 3 } } },
};
globalThis.game = {
  userId: null,
  keybindings: { register() {}, get: () => [] },
  users: { get: id => ({ name: id }) },
  modules: new Map([["proximity-voice-chat", {}]]),
  settings: { register: (m, k, c) => settings[k] ??= c.default, get: (m, k) => settings[k] },
};
globalThis.setInterval = () => 0;

const as = (client, fn) => { game.userId = client.id; return fn(); };
function deliver(clients) {
  for (let guard = 0; queue.length && guard < 1000; guard++) {
    const { from, to, data } = queue.shift();
    as(clients[to], () => clients[to].receiveSignal(from, data));
  }
}

/**
 * @returns {{connectedAt: number | null, stable: boolean, errors: string[]}}
 */
async function simulate({ connect_ms, duration_ms = 180000, offsets = { a: 0, b: 0 }, reload = null }) {
  now = 0; errors = []; all_peers = []; queue = [];
  const clients = { a: new SimplePeerAVClient("a"), b: new SimplePeerAVClient("b") };
  let connectedAt = null;
  let reconnectedAt = null;
  for (now = 0; now <= duration_ms; now += 500) {
    if (reload && now === reload.at) {
      // a reload destroys every connection without telling the other side, then starts a fresh client
      for (const peer of clients[reload.who].peers.values()) { peer.removeAllListeners(); peer.destroyed = true; }
      clients[reload.who] = new SimplePeerAVClient(reload.who);
    }
    for (const id of ["a", "b"]) {
      const other = id === "a" ? "b" : "a";
      if ((now - offsets[id]) % POLL_MS === 0 && now >= offsets[id]) await as(clients[id], () => clients[id].initializePeerStream(other));
    }
    await Promise.resolve();
    for (const peer of [...all_peers]) peer.start();
    deliver(clients);
    for (const peer of [...all_peers]) peer.tick(connect_ms);
    deliver(clients);
    await Promise.resolve();
    const pa = clients.a.peers.get("b"), pb = clients.b.peers.get("a");
    const up = pa && pb && pa.connected && pb.connected && pa.partner() === pb && clients.a.remoteStreams.has("b") && clients.b.remoteStreams.has("a");
    if (up && connectedAt === null) connectedAt = now;
    if (up && reload && now > reload.at && reconnectedAt === null) reconnectedAt = now;
    if (!up && connectedAt !== null && (!reload || now < reload.at)) connectedAt = -1;// dropped after connecting
  }
  const pa = clients.a.peers.get("b"), pb = clients.b.peers.get("a");
  const final_up = !!(pa?.connected && pb?.connected && pa.partner() === pb);
  return { connectedAt, reconnectedAt, final_up, errors };
}

const scenarios = [
  { name: "fast network (2s setup), both poll together", connect_ms: 2000 },
  { name: "slow network (12s setup), both poll together", connect_ms: 12000 },
  { name: "slow network (12s setup), polls 3s apart", connect_ms: 12000, offsets: { a: 0, b: 3000 } },
  { name: "caller reloads after connecting", connect_ms: 2000, offsets: { a: 0, b: 3000 }, reload: { who: "a", at: 60000 } },
  { name: "answerer reloads after connecting", connect_ms: 2000, offsets: { a: 0, b: 3000 }, reload: { who: "b", at: 60000 } },
];

const fmt = r => (r.final_up ? "connected" : "NOT connected") +
  (r.connectedAt > 0 ? " (first at " + r.connectedAt / 1000 + "s)" : r.connectedAt === -1 ? " (dropped)" : "") +
  (r.reconnectedAt ? ", back after reload at " + r.reconnectedAt / 1000 + "s" : "") +
  ", " + r.errors.length + " errors" + (r.errors.length ? " e.g. " + JSON.stringify(r.errors[0]) : "");

console.log("--- unpatched Foundry 14.369");
const baseline = [];
for (const s of scenarios) { const r = await simulate(s); baseline.push(r); console.log("  " + s.name + ": " + fmt(r)); }

await import(process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href);
Hooks.callAll("init");
await Promise.resolve();

console.log("--- with proximity-voice-chat workaround");
let failures = 0;
for (const s of scenarios) {
  const r = await simulate(s);
  const ok = r.final_up && r.connectedAt > 0 && (!s.reload || r.reconnectedAt !== null);
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + s.name + ": " + fmt(r));
}
const reproduced = baseline.some(r => !r.final_up);
console.log(reproduced ? "baseline reproduces the bug" : "WARNING: baseline did not reproduce the bug");
console.log(failures ? failures + " FAILURES" : "ALL PASSED");
process.exit(failures || !reproduced ? 1 : 0);

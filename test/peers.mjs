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
    // like RTCPeerConnection: "have-local-offer" between sending an offer and getting its answer, otherwise "stable"
    this._pc = { connectionState: "new", iceConnectionState: "new", signalingState: "stable" };
    this.remoteFp = null;
    this.negotiatedAt = null;
    this.partnerLostAt = null;
    all_peers.push(this);
  }
  get connected() { return this._connected; }
  start() {
    if (this.initiator && !this.destroyed && !this.started) {
      this.started = true;
      this._pc.signalingState = "have-local-offer";
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
      // what Chrome and Firefox both refuse, and SimplePeer destroys the connection over
      if (this._pc.signalingState !== "have-local-offer") return this.fail("Cannot set remote answer in state stable");
      this.remoteFp = fp;
      this._pc.signalingState = "stable";
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
let lastAnswer = null;
class SimplePeerAVClient {
  constructor(id) {
    this.id = id;
    this.peers = new Map();
    this.remoteStreams = new Map();
    this.master = { render() {}, settings: { handleUserActivity() {}, getUser: () => ({}) } };
  }
  // Foundry's connect() runs one connection pass immediately, then polls every 8 seconds
  async connect() {
    for (const other of ["a", "b"]) if (other !== this.id) await this.initializePeerStream(other);
    return true;
  }
  async disconnect() { return true; }
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
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), callAll: (n, ...a) => (hooks[n] ?? []).forEach(f => f(...a)) };
const el = () => ({ classList: { add() {}, toggle() {} }, setAttribute() {}, getAttribute() {}, appendChild() {}, append() {} });
globalThis.document = { hidden: false, createElement: el, addEventListener() {}, querySelector: () => null, body: { classList: { toggle() {} } } };
globalThis.ui = { notifications: { error() {}, info() {} } };
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { footer: {} } });
const settings = {};
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() } },
  av: { clients: { SimplePeerAVClient }, AVSettings: { AV_MODES: { AUDIO: 1, AUDIO_VIDEO: 3 } } },
  canvas: { loadTexture: async () => ({}) },
};
globalThis.game = {
  userId: null,
  keybindings: { register() {}, get: () => [] },
  i18n: { localize: s => s, format: s => s },
  users: Object.assign(["a", "b"].map(id => ({ id, name: id, active: true, get isSelf() { return game.userId === id; } })),
    { get: id => ({ name: id }) }),
  socket: { on: (name, fn) => socketHandlers.push(fn), emit: (name, data) => moduleQueue.push({ from: game.userId, data }) },
  modules: new Map([["proximity-voice-chat", {}]]),
  settings: { register: (m, k, c) => settings[k] ??= c.default, get: (m, k) => settings[k] },
};
const intervals = [];
globalThis.setInterval = fn => (intervals.push(fn), 0);
const socketHandlers = [];
let moduleQueue = [];

const as = (client, fn) => { game.userId = client.id; game.webrtc = { client }; return fn(); };
function deliver(clients) {
  for (let guard = 0; (queue.length || moduleQueue.length) && guard < 1000; guard++) {
    if (queue.length) {
      const { from, to, data } = queue.shift();
      if (data.type === "answer") lastAnswer = { from, to, data };
      as(clients[to], () => clients[to].receiveSignal(from, data));
    } else {
      // module socket messages go to every other client
      const { from, data } = moduleQueue.shift();
      for (const id of Object.keys(clients)) if (id !== from) as(clients[id], () => socketHandlers.forEach(fn => fn(data)));
    }
  }
}

/**
 * @returns {{connectedAt: number | null, stable: boolean, errors: string[]}}
 */
async function simulate({ connect_ms, duration_ms = 180000, offsets = { a: 0, b: 0 }, reload = null, repeat_answer_at = null }) {
  now = 0; errors = []; all_peers = []; queue = []; moduleQueue = [];
  const clients = { a: new SimplePeerAVClient("a"), b: new SimplePeerAVClient("b") };
  let connectedAt = null;
  let reconnectedAt = null;
  lastAnswer = null;
  for (now = 0; now <= duration_ms; now += 500) {
    // a reply turns up a second time, e.g. queued while a page was loading
    if (repeat_answer_at !== null && now === repeat_answer_at && lastAnswer) queue.push(lastAnswer);
    if (reload && now === reload.at) {
      // a reload destroys every connection without telling the other side, then starts a fresh client
      for (const peer of clients[reload.who].peers.values()) { peer.removeAllListeners(); peer.destroyed = true; }
      clients[reload.who] = new SimplePeerAVClient(reload.who);
    }
    for (const id of ["a", "b"]) {
      const other = id === "a" ? "b" : "a";
      const reloaded = reload && id === reload.who && now === reload.at + 500;
      if (now === offsets[id] || reloaded) await as(clients[id], () => clients[id].connect());
      else if ((now - offsets[id]) % POLL_MS === 0 && now > offsets[id]) await as(clients[id], () => clients[id].initializePeerStream(other));
    }
    if (now % 1000 === 0) for (const id of ["a", "b"]) as(clients[id], () => intervals.forEach(fn => fn()));
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
  { name: "a leftover answer arrives after connecting", connect_ms: 2000, offsets: { a: 0, b: 3000 }, repeat_answer_at: 60000 },
];

// --- Foundry 14.369 voice detection (AVMaster) and SimplePeerAVClient's mute handling, as far as muting goes.
// Speaking is simplified to "level above the threshold"; the rest follows foundry.mjs.
const levelReports = new Map();
class MuteClient {
  constructor(master) {
    this.master = master;
    this.settings = master.settings;
    this.audioBroadcastEnabled = false;
    const track = () => ({ enabled: true });
    this.localStream = { tracks: [track()], getAudioTracks() { return this.tracks; } };
    // Foundry's levels stream is a clone, so muting (which disables the local tracks) leaves its tracks alone
    this.levelsStream = { tracks: [track()], getAudioTracks() { return this.tracks; } };
  }
  get isMuted() { return this.settings.client.users[game.user.id]?.muted; }
  get isVoicePTT() { return this.settings.client.voice.mode === "ptt"; }
  get isVoiceActivated() { return this.settings.client.voice.mode === "activity"; }
  getLevelsStreamForUser() { return this.levelsStream; }
  toggleAudio(enabled) {
    if (!this.localStream) return;
    if (!this.audioBroadcastEnabled || this.isVoicePTT) return;
    return this.toggleBroadcast(enabled);
  }
  toggleBroadcast(enabled) {
    this.audioBroadcastEnabled = enabled;
    for (const t of this.localStream.getAudioTracks()) t.enabled = enabled;
  }
  async onSettingsChanged(changed) {
    const keys = new Set(Object.keys(flatten(changed)));
    const modeChange = ["client.voice.mode", `client.users.${game.user.id}.muted`].some(k => keys.has(k));
    if (modeChange) {
      const isAlways = this.settings.client.voice.mode === "always";
      this.toggleAudio(isAlways && this.master.canUserShareAudio(game.user.id));
      this.master.broadcast(isAlways);
      this.master._initializeUserVoiceDetection(changed.client.voice?.mode);
    }
  }
}
class AVMaster {
  constructor(mode) {
    this.settings = { client: { voice: { mode, activityThreshold: -45 }, users: { a: { muted: false } } } };
    this.broadcasting = false;
    this._speakingData = { speaking: false };
    this.client = new MuteClient(this);
  }
  _initializeUserVoiceDetection(mode) {
    game.audio.stopLevelReports(game.user.id);
    if (!["always", "activity"].includes(mode)) return;
    this.activateVoiceDetection(this.client.getLevelsStreamForUser(game.user.id));
  }
  activateVoiceDetection(stream) {
    game.audio.stopLevelReports(game.user.id);
    if (!stream || !stream.getAudioTracks().some(t => t.enabled)) return;
    game.audio.startLevelReports(game.user.id, stream, db => this.onAudioLevel(db));
  }
  onAudioLevel(db) {
    const wasSpeaking = this._speakingData.speaking;
    const isSpeaking = db >= this.settings.client.voice.activityThreshold && !this.client.isMuted;
    this._speakingData.speaking = isSpeaking;
    if (isSpeaking === wasSpeaking) return;
    if (this.client.isVoiceActivated) return this.broadcast(isSpeaking);
  }
  canUserShareAudio(id) {
    const user = this.settings.client.users[id];
    return !!user && !user.muted;
  }
  broadcast(intent) {
    this.broadcasting = intent && this.canUserShareAudio(game.user.id);
    this.client.toggleBroadcast(this.broadcasting);
  }
  onSettingsChanged(changed) {
    const sharing = changed.client?.users?.[game.user.id] ?? {};
    if ("muted" in sharing) this.client.toggleAudio(this.canUserShareAudio(game.user.id));
    this.client.onSettingsChanged(changed);
  }
}
const flatten = (obj, prefix = "") => Object.entries(obj).reduce((out, [k, v]) =>
  (v && typeof v === "object" ? Object.assign(out, flatten(v, prefix + k + ".")) : (out[prefix + k] = v), out), {});

/**
 * Talks, toggles mute (as the hotkey does: a client setting change), and talks again
 * @param {string} mode Foundry's voice broadcasting mode
 * @param {boolean} mute_while_talking toggle mute in the middle of a sentence
 * @returns {{before: boolean, whileMuted: boolean, after: boolean, detecting: boolean}} whether the mic was open
 */
function muteScenario(mode, mute_while_talking = false) {
  const saved = { webrtc: game.webrtc, user: game.user, audio: game.audio };
  levelReports.clear();
  game.user = { id: "a" };
  game.audio = { startLevelReports: (id, _stream, fn) => levelReports.set(id, fn), stopLevelReports: id => levelReports.delete(id) };
  const master = new AVMaster(mode);
  game.webrtc = master;
  const level = db => levelReports.get("a")?.(db);
  const ptt = (down) => { if (mode === "ptt") master.broadcast(down); };
  const setMuted = (muted) => {
    master.settings.client.users.a.muted = muted;
    master.onSettingsChanged({ client: { users: { a: { muted } } } });
  };
  // Foundry's AVMaster.connect: start detection, set the outbound tracks, declare the broadcast intent
  master._initializeUserVoiceDetection(mode);
  master.client.toggleAudio(mode === "always");
  master.broadcast(mode === "always");
  ptt(true); level(-20);
  const before = master.broadcasting;
  if (!mute_while_talking) { level(-80); ptt(false); }
  setMuted(true);
  ptt(true); level(-20);
  const whileMuted = master.broadcasting;
  level(-80); ptt(false);
  setMuted(false);
  if (mute_while_talking) level(-20);// still talking when unmuting
  level(-80);
  ptt(true); level(-20);
  const after = master.broadcasting;
  const detecting = levelReports.has("a");
  Object.assign(game, saved);
  return { before, whileMuted, after, detecting };
}
const muteCases = [
  { name: "Voice Activation: mute, unmute, talk", mode: "activity", want: { after: true, detecting: true } },
  { name: "Voice Activation: mute in mid-sentence, unmute, talk", mode: "activity", talking: true, want: { after: true, detecting: true } },
  { name: "Always On: mute, unmute, talk", mode: "always", want: { after: true } },
  { name: "Push-to-talk: mute, unmute, talk (no detector needed)", mode: "ptt", want: { after: true, detecting: false } },
];
foundry.av.AVMaster = AVMaster;
const runMuteCases = () => muteCases.map(c => ({ c, r: muteScenario(c.mode, c.talking) }));
const muteOk = ({ c, r }) => r.before && !r.whileMuted && Object.entries(c.want).every(([k, v]) => r[k] === v);
const fmtMute = r => "open before " + r.before + ", while muted " + r.whileMuted + ", after " + r.after + ", detecting " + r.detecting;

const fmt = r => (r.final_up ? "connected" : "NOT connected") +
  (r.connectedAt > 0 ? " (first at " + r.connectedAt / 1000 + "s)" : r.connectedAt === -1 ? " (dropped)" : "") +
  (r.reconnectedAt ? ", back after reload at " + r.reconnectedAt / 1000 + "s" : "") +
  ", " + r.errors.length + " errors" + (r.errors.length ? " e.g. " + JSON.stringify(r.errors[0]) : "");

console.log("--- unpatched Foundry 14.369");
const baseline = [];
for (const s of scenarios) { const r = await simulate(s); baseline.push(r); console.log("  " + s.name + ": " + fmt(r)); }
const muteBaseline = runMuteCases();
for (const { c, r } of muteBaseline) console.log("  " + c.name + ": " + fmtMute(r));

await import(process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href);
Hooks.callAll("init");
Hooks.callAll("ready");
await Promise.resolve();

console.log("--- with proximity-voice-chat workaround");
let failures = 0;
for (const s of scenarios) {
  const r = await simulate(s);
  // with the call-me handshake, a reload should reconnect within a few seconds rather than a poll cycle or more
  const ok = r.final_up && r.connectedAt > 0 && (!s.reload || (r.reconnectedAt !== null && r.reconnectedAt - s.reload.at <= 5000));
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + s.name + ": " + fmt(r));
}
for (const result of runMuteCases()) {
  const ok = muteOk(result);
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + result.c.name + ": " + fmtMute(result.r));
}
const muteReproduced = !muteOk(muteBaseline[0]) && muteBaseline.slice(2).every(muteOk);
console.log(muteReproduced ? "baseline reproduces the mute bug, and only in Voice Activation" : "WARNING: baseline did not reproduce the mute bug as expected");
const reproduced = baseline.some(r => !r.final_up) && muteReproduced;
console.log(reproduced ? "baseline reproduces the bug" : "WARNING: baseline did not reproduce the bug");
console.log(failures ? failures + " FAILURES" : "ALL PASSED");
process.exit(failures || !reproduced ? 1 : 0);

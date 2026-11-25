// Run with: node test/input.mjs [path/to/proximity-voice-chat.js]
// The microphone cleanup. First the worklet's own logic (scripts/voice-input-worklet.js): the gate, the delays and
// fades, and the real RNNoise file on noises. Then the page's side (scripts/voice-input.js) as the module applies
// it, through Foundry 14.369's SimplePeerAVClient and AVMaster (the parts that matter, following foundry.mjs), as
// Alice (a player), with a fake Web Audio (test/fake-audio.mjs) in place of the browser's.
import { readFileSync } from "node:fs";
import { FakeAudioContext, FakeAudioElement, FakeTrack, FakeMediaStream, FakeWorkletNode } from "./fake-audio.mjs";

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log((ok ? "ok  " : "FAIL") + " " + label + (detail !== "" ? "  [" + detail + "]" : "")); };

const mainScript = process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href;
const scriptsDir = new URL(".", mainScript.startsWith("file:") ? mainScript : "file://" + mainScript);
let W = null;
try {
  W = await import(new URL("voice-input-worklet.js", scriptsDir).href);
} catch (error) {
  check("the cleanup worklet exists", false, error.message);
}

/* -------------------------------------------- */
/*  The worklet's logic                         */
/* -------------------------------------------- */

const FRAME = 480;
/** Runs the gate on a list of frames: [raw dB, filtered dB, speech score] */
const run_gate = (gate, frames) => frames.map(([raw, out, vad]) => gate.step(raw, out, vad));
const repeat = (n, frame) => Array.from({ length: n }, () => frame);
const ROOM = [-65, -100, 0.01];
const SPEECH = [-25, -25, 0.97];

if (W) {
  const settle = gate => run_gate(gate, repeat(400, ROOM));// 4 s of quiet room first, so it knows the room

  {
    const gate = new W.VoiceGate(W.gate_params({}));
    settle(gate);
    check("the gate learns the room's background level while nobody speaks", Math.abs(gate.floor - -65) < 1.5, gate.floor.toFixed(1));
    check("breathing (quiet, not speech) never opens the gate", !run_gate(gate, repeat(150, [-42, -90, 0.05])).some(Boolean));
    check("a loud bird (as loud as a voice, but not speech) never opens it", !run_gate(gate, repeat(100, [-25, -60, 0.1])).some(Boolean));
    check("a 10 ms click that looks like speech doesn't open it", !run_gate(gate, [SPEECH, ROOM, ROOM, ROOM]).some(Boolean));
    const opened = run_gate(gate, repeat(5, SPEECH));
    check("speech opens it on its second frame", !opened[0] && opened[1], opened.join(","));
    check("it stays open through a quarter-second pause between words", run_gate(gate, repeat(25, ROOM)).every(Boolean));
    run_gate(gate, repeat(50, SPEECH));
    const closing = run_gate(gate, repeat(40, ROOM));
    const closed_at = closing.indexOf(false);
    check("after the last word it holds about 300 ms, then closes", closed_at >= 28 && closed_at <= 31, String(closed_at));
  }
  {
    // the room gets louder (a fan goes on): what counts as background follows, about 1 dB a second
    const gate = new W.VoiceGate(W.gate_params({}));
    settle(gate);
    run_gate(gate, repeat(1500, [-50, -100, 0.02]));
    check("the background level follows a louder room", gate.floor > -56 && gate.floor <= -50, gate.floor.toFixed(1));
    run_gate(gate, repeat(20, [-56, -56, 0.95]));
    check("...so speech barely above the new noise doesn't open it", !gate.open);
  }
  {
    // the player speaks, then someone across the room does, 26 dB quieter
    const gate = new W.VoiceGate(W.gate_params({}));
    settle(gate);
    run_gate(gate, repeat(300, SPEECH));
    run_gate(gate, repeat(60, ROOM));
    check("another voice in the room, 26 dB quieter than the player, doesn't open it", !run_gate(gate, repeat(100, [-51, -51, 0.95])).some(Boolean), "speaking level " + gate.speech.toFixed(1));
    const strict_gate = new W.VoiceGate(W.gate_params({ strictness: 5 }));
    const relaxed_gate = new W.VoiceGate(W.gate_params({ strictness: 1 }));
    for (const g of [strict_gate, relaxed_gate]) { settle(g); run_gate(g, repeat(300, SPEECH)); run_gate(g, repeat(60, ROOM)); }
    const quiet = repeat(50, [-41, -41, 0.95]);
    check("a word 16 dB quieter than usual opens Relaxed but not Strict", run_gate(relaxed_gate, quiet).some(Boolean) && !run_gate(strict_gate, quiet).some(Boolean));
  }
  {
    // a whisper: quiet, and RNNoise is unsure it's a voice at all
    const whisper = repeat(100, [-50, -70, 0.2]);
    const normal = new W.VoiceGate(W.gate_params({}));
    const whispering = new W.VoiceGate(W.gate_params({ whisper: true }));
    settle(normal); settle(whispering);
    check("a whisper doesn't open the gate in Normal mode", !run_gate(normal, whisper).some(Boolean));
    check("...but does in Whisper mode", run_gate(whispering, whisper).filter(Boolean).length > 80);
    check("Whisper mode mixes some unfiltered sound back in, since RNNoise filters whispers away", W.gate_params({ whisper: true }).dry === 0.5 && W.gate_params({}).dry === 0);
    check("...and holds longer between words", W.gate_params({ whisper: true }).hold > W.gate_params({}).hold);
    run_gate(whispering, repeat(100, ROOM));
    check("breathing still doesn't open it in Whisper mode", !run_gate(whispering, repeat(150, [-60, -90, 0.02])).some(Boolean));
  }
  {
    const gate = new W.VoiceGate(W.gate_params({ gate: "manual", threshold: -40 }));
    settle(gate);
    check("Manual: below the threshold stays closed, even if it's speech", !run_gate(gate, repeat(20, [-45, -45, 0.99])).some(Boolean));
    check("Manual: above it opens, whatever it is", run_gate(gate, repeat(5, [-35, -35, 0])).at(-1));
    const ptt = new W.VoiceGate(W.gate_params({ gate: "open" }));
    check("push-to-talk: the gate is always open", run_gate(ptt, repeat(10, ROOM)).every(Boolean));
    check("filter off: the unfiltered sound is sent", W.gate_params({ filter: false }).dry === 1);
    check("without RNNoise, going by level alone asks for more", W.gate_params({}, false).margin > W.gate_params({}).margin && W.gate_params({}, false).confirm === 3);
  }

  // --- the engine: framing, the delays, and the fades, with a stand-in for RNNoise that behaves like it does:
  // its output is two frames behind its input, while its speech score is for the newest frame
  const fake_denoiser = (is_speech) => {
    const queue = [new Float32Array(FRAME), new Float32Array(FRAME)];
    return { process(frame) { const vad = is_speech(frame) ? 0.97 : 0.01; queue.push(frame.slice()); frame.set(queue.shift()); return vad; } };
  };
  {
    const rate = 48000;
    const tone = (n, amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * 220 * i / rate));
    // 4 s of quiet, 1 s of "speech" (a loud tone), then 1 s of a quieter sound that isn't speech (a cough, a chair);
    // speech starts mid-frame
    const quiet = n => Float32Array.from({ length: n }, (_, i) => 0.0005 * Math.sin(i * 1.7));
    const parts = [quiet(rate * 4 + 200), tone(rate, 0.1), tone(rate, 0.03)];
    const input = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of parts) { input.set(p, o); o += p.length; }
    const onset = rate * 4 + 200, offset = onset + rate;
    const engine = new W.InputEngine(fake_denoiser(frame => W.level_db(frame) > -28), { gate: "auto" });
    const out = new Float32Array(input.length);
    const block = new Float32Array(128);
    for (let i = 0; i + 128 <= input.length; i += 128) { engine.process(input.subarray(i, i + 128), block); out.set(block, i); }
    const delay = 2400;// 10 ms of framing, 20 ms inside RNNoise, 20 ms of look-ahead
    const first = out.findIndex(v => Math.abs(v) > 1e-3);
    check("what's sent is 50 ms behind the microphone", first >= onset + delay - 5 && first <= onset + delay + 5, (first - onset) + " samples");
    const start = out.subarray(onset + delay, onset + delay + 480);
    const ratio = Math.max(...start.map(Math.abs)) / 0.1;
    check("the first syllable comes out whole: the gate was already open when it got there", ratio > 0.99, ratio.toFixed(3));
    // how much of the sound after the last word gets out, measured on the sound as it was before the gate
    const after = ms => Math.max(...out.subarray(offset + delay + ms * 48, offset + delay + ms * 48 + 480).map(Math.abs)) / 0.03;
    check("after the last word it holds about 250 ms, then fades out over about 120 ms instead of cutting off",
      after(0) > 0.99 && after(200) > 0.99 && after(320) > 0.2 && after(320) < 0.8 && after(400) === 0,
      [0, 200, 320, 400].map(ms => after(ms).toFixed(2)).join(" "));
    check("the quiet before speech is silenced", out.subarray(rate, onset).every(v => v === 0));
    const decisions = engine.events.filter(e => e.type === "decision");
    const gates = engine.events.filter(e => e.type === "gate");
    check("it reports deciding to open before the sound starts going out, and closing once it has faded",
      decisions[0]?.open === true && gates[0]?.open === true && gates.at(-1)?.open === false && engine.events.indexOf(decisions[0]) < engine.events.indexOf(gates[0]));
  }
  {
    // the browser may use blocks other than 128 samples; nothing may be lost or run dry
    const engine = new W.InputEngine(null, { gate: "open" });
    const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i / 10) * 0.2);
    const out = new Float32Array(input.length); let i = 0;
    for (const size of [128, 256, 100, 512, 128]) for (let k = 0; k < 30 && i + size <= input.length; k++) { const b = new Float32Array(size); engine.process(input.subarray(i, i + size), b); out.set(b, i); i += size; }
    const lag = 480;// framing only: no RNNoise, no look-ahead hold needed when it's open
    let worst = 0; for (let k = lag + 1000; k < i; k++) worst = Math.max(worst, Math.abs(out[k] - input[k - lag - 960]));
    check("without RNNoise and gate open, sound passes unchanged whatever the block size", worst < 1e-6, worst.toExponential(2));
  }

  // --- the real RNNoise on noises (no recording of speech is shipped with the tests; see the README's notes)
  const wasm = readFileSync(new URL("vendor/rnnoise/rnnoise.wasm", scriptsDir));
  let rnnoise = null;
  try {
    rnnoise = await W.load_rnnoise(wasm);
  } catch (error) {
    check("RNNoise loads without its JavaScript glue", false, error.message);
  }
  if (rnnoise) {
    check("RNNoise loads without its JavaScript glue", true);
    let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const SR = 48000;
    const scale = (a, db) => { let s = 0; for (const v of a) s += v * v; const g = 10 ** (db / 20) / Math.sqrt(s / a.length); return a.map(v => v * g); };
    const room = n => { const a = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { y = 0.995 * y + 0.05 * rnd(); a[i] = y; } return scale(a, -62); };
    const noises = {
      "breathing": n => { const a = new Float32Array(n); let lp = 0, lp2 = 0; for (let i = 0; i < n; i++) { const w = rnd(); lp += 0.25 * (w - lp); lp2 += 0.02 * (lp - lp2); a[i] = (lp - lp2) * Math.sin(Math.PI * (i % (SR * 2)) / (SR * 2)) ** 2; } return scale(a, -40); },
      "birdsong": n => { const a = new Float32Array(n), c = 0.08 * SR, p = 0.2 * SR; let ph = 0; for (let i = 0; i < n; i++) { const k = i % p; if (k < c) { ph += 2 * Math.PI * (3000 + 2000 * k / c) / SR; a[i] = Math.sin(Math.PI * k / c) * (Math.sin(ph) + 0.3 * Math.sin(2 * ph)); } } return scale(a, -30); },
      "gulps and clicks": n => { const a = new Float32Array(n), len = 0.015 * SR, p = 0.7 * SR; for (let i = 0; i < n; i++) { const k = i % p; if (k < len) a[i] = Math.exp(-k / (0.004 * SR)) * (Math.sin(2 * Math.PI * 180 * k / SR) + 0.5 * rnd()); } return scale(a, -30); },
      "typing": n => { const a = new Float32Array(n); for (let i = 0; i < n; i += Math.round(0.15 * SR)) for (let j = 0; j < 0.005 * SR && i + j < n; j++) a[i + j] = rnd() * Math.exp(-j / (0.0015 * SR)); return scale(a, -35); },
    };
    for (const [name, make] of Object.entries(noises)) {
      const n = SR * 6, lead = SR * 3;
      const input = new Float32Array(lead + n); input.set(room(lead + n)); const noise = make(n); for (let i = 0; i < n; i++) input[lead + i] += noise[i];
      const engine = new W.InputEngine(rnnoise.create(), { gate: "auto" });
      const block = new Float32Array(128); let sent = 0;
      for (let i = 0; i + 128 <= input.length; i += 128) { engine.process(input.subarray(i, i + 128), block); if (i >= lead) for (const v of block) sent += v * v; }
      check("with the real RNNoise, " + name + " sends nothing", sent === 0, sent.toExponential(2));
    }
  }
}

/* -------------------------------------------- */
/*  The page's side, through Foundry            */
/* -------------------------------------------- */

const hooks = {};
globalThis.Hooks = {
  on: (n, f) => (hooks[n] ??= []).push(f),
  once: (n, f) => { const w = (...a) => { hooks[n] = hooks[n].filter(x => x !== w); return f(...a); }; (hooks[n] ??= []).push(w); },
  callAll: (n, ...a) => [...(hooks[n] ?? [])].forEach(f => f(...a)),
};
const el = () => ({ classList: { add() {}, toggle() {} }, style: {}, setAttribute() {}, getAttribute() {}, appendChild() {}, append() {} });
const pageListeners = {};
const body = { classList: { toggle() {} }, children: [], append(node) { node.attached = true; this.children.push(node); } };
globalThis.document = {
  hidden: false, body, querySelector: () => null,
  createElement: tag => tag === "audio" ? new FakeAudioElement() : el(),
  addEventListener: (type, fn) => (pageListeners[type] ??= []).push(fn),
};
const click = () => (pageListeners.click ?? []).forEach(fn => fn({ type: "click" }));
globalThis.AudioContext = FakeAudioContext;
globalThis.AudioWorkletNode = FakeWorkletNode;
globalThis.MediaStream = FakeMediaStream;
const fetched = [];
globalThis.fetch = async url => { fetched.push(String(url)); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) }; };

// timers: short ones run for real; long ones wait to be fired by hand, by how long they are
const realTimeout = globalThis.setTimeout;
let longTimers = [];
globalThis.setTimeout = (fn, ms, ...args) => ms >= 1000 ? (longTimers.push({ fn, ms }), -longTimers.length) : realTimeout(fn, ms, ...args);
const fireTimers = ms => { const due = longTimers.filter(t => t.ms === ms); longTimers = longTimers.filter(t => t.ms !== ms); due.forEach(t => t.fn()); };
globalThis.setInterval = () => 0;
const tick = (ms = 8) => new Promise(r => realTimeout(r, ms));

// --- Foundry 14.369's A/V, as far as the microphone goes (foundry.mjs: SimplePeerAVClient, AVMaster)
const levelReports = new Map();
/** SimplePeer as far as sending tracks goes: one sender per track; replaceTrack needs the track it was given */
class FakePeer {
  constructor(stream) { this.senders = new Map(); this.connected = true; if (stream) this.addStream(stream); }
  addStream(stream) { for (const track of stream.getTracks()) this.senders.set(track, { track, stream }); }
  // like SimplePeer: removing a track removes its sender, whichever track it was swapped to or from
  removeStream(stream) {
    for (const track of stream.getTracks()) {
      const sender = this.senders.get(track);
      if (!sender || sender.stream !== stream) continue;
      for (const [key, value] of this.senders) if (value === sender) this.senders.delete(key);
    }
  }
  replaceTrack(oldTrack, newTrack, stream) {
    const sender = this.senders.get(oldTrack);
    if (!sender || sender.stream !== stream) { const error = new Error("Cannot replace track that was never added."); error.code = "ERR_TRACK_NOT_ADDED"; throw error; }
    this.senders.set(newTrack, sender);
    sender.track = newTrack;
  }
  /** the audio tracks this connection is sending right now */
  sending() { return [...new Set([...this.senders.values()].map(s => s.track))].filter(t => t.kind === "audio"); }
}
const mics = [];
class SimplePeerAVClient {
  constructor(master) { this.master = master; this.settings = master.settings; this.peers = new Map(); this.localStream = null; this.levelsStream = null; this.audioBroadcastEnabled = false; }
  get isVoicePTT() { return this.settings.client.voice.mode === "ptt"; }
  get isMuted() { return this.settings.client.users[game.user.id]?.muted; }
  async initializeLocalStream() {
    if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
    this.localStream = null;
    if (this.levelsStream) this.levelsStream.getTracks().forEach(t => t.stop());
    this.levelsStream = null;
    await Promise.resolve();// getUserMedia
    const mic = new FakeTrack("audio", "microphone " + (mics.length + 1));
    mics.push(mic);
    const stream = new FakeMediaStream([mic, new FakeTrack("video", "camera")]);
    this.localStream = stream;
    this.levelsStream = stream.clone();
    this.levelsStream.getVideoTracks().forEach(t => this.levelsStream.removeTrack(t));
    return stream;
  }
  getLevelsStreamForUser(userId) { return userId === game.user.id ? this.levelsStream : this.getMediaStreamForUser(userId); }
  getMediaStreamForUser(userId) { return userId === game.user.id ? this.localStream : null; }
  connectPeer(userId) { const peer = new FakePeer(this.localStream); this.peers.set(userId, peer); return peer; }
  toggleAudio(enabled) { if (!this.localStream || !this.audioBroadcastEnabled || this.isVoicePTT) return; return this.toggleBroadcast(enabled); }
  toggleBroadcast(enabled) { if (!this.localStream) return; this.audioBroadcastEnabled = enabled; for (const t of this.localStream.getAudioTracks()) t.enabled = enabled; }
  async updateLocalStream() {
    const oldStream = this.localStream;
    await this.initializeLocalStream();
    for (const peer of this.peers.values()) { if (oldStream) peer.removeStream(oldStream); if (this.localStream) peer.addStream(this.localStream); }
    this.master._initializeUserVoiceDetection(this.settings.client.voice.mode);
  }
  async onSettingsChanged(changed) {
    const keys = Object.keys(flatten(changed));
    if (keys.some(k => k === "client.voice.mode" || k === "client.users." + game.user.id + ".muted")) {
      const isAlways = this.settings.client.voice.mode === "always";
      this.toggleAudio(isAlways && this.master.canUserShareAudio(game.user.id));
      this.master.broadcast(isAlways);
      this.master._initializeUserVoiceDetection(changed.client.voice?.mode);
    }
  }
}
const flatten = (obj, prefix = "") => Object.entries(obj).reduce((out, [k, v]) =>
  (v && typeof v === "object" ? Object.assign(out, flatten(v, prefix + k + ".")) : (out[prefix + k] = v), out), {});
class AVMaster {
  constructor(settings) { this.settings = settings; this.broadcasting = false; this.client = new SimplePeerAVClient(this); }
  canUserShareAudio(userId) { const user = this.settings.getUser(userId); return !!user && user.canBroadcastAudio && !(user.muted || user.blocked); }
  broadcast(intent) { this.broadcasting = intent && this.canUserShareAudio(game.user.id); this.client.toggleBroadcast(this.broadcasting); }
  _initializeUserVoiceDetection(mode) {
    game.audio.stopLevelReports(game.user.id);
    if (!["always", "activity"].includes(mode)) return;
    this.activateVoiceDetection(this.client.getLevelsStreamForUser(game.user.id));
  }
  activateVoiceDetection(stream) {
    this.deactivateVoiceDetection();
    if (!stream || !stream.getAudioTracks().some(t => t.enabled)) return;
    game.audio.startLevelReports(game.user.id, stream, () => {});
  }
  deactivateVoiceDetection() { game.audio.stopLevelReports(game.user.id); }
  async connect() {
    await this.client.initializeLocalStream();
    const mode = this.settings.client.voice.mode;
    this._initializeUserVoiceDetection(mode);
    this.client.toggleAudio(mode === "always");
    this.broadcast(mode === "always");
  }
}

// --- the rest of Foundry, as little as the module needs to start
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { a: {}, footer: {} } });
class PointSoundSource { constructor(o) { this.o = o; this.data = {}; } initialize(d) { Object.assign(this.data, d); this.shape = { points: [] }; } getVolumeMultiplier() { return 1; } }
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() } },
  canvas: { sources: { PointSoundSource } },
  av: { AVSettings: { AV_MODES: { DISABLED: 0, AUDIO: 1, VIDEO: 2, AUDIO_VIDEO: 3 } }, AVMaster, clients: { SimplePeerAVClient } },
  audio: { AudioHelper: { volumeToInput: v => Math.pow(v, 1 / 1.5), inputToVolume: v => Math.pow(v, 1.5) } },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
const settings = {}, settingConfigs = {};
const mkUser = (id, name, isGM) => ({ id, name, isGM, uuid: "User." + id, active: true, isSelf: false, flags: {},
  getFlag(m, k) { return this.flags[k]; }, async setFlag(m, k, v) { this.flags[k] = v; Hooks.callAll("updateUser", this, { flags: { [m]: { [k]: v } } }); } });
const users = [mkUser("gm", "GM", true), mkUser("p1", "Alice", false), mkUser("p2", "Bob", false)];
const rtc = {
  world: { mode: 1 }, client: { audioSink: "default", muteAll: false, voice: { mode: "always", activityThreshold: -45 }, users: {} }, activity: {},
  getUser: id => ({ volume: 1, muted: !!rtc.client.users[id]?.muted, blocked: false, canBroadcastAudio: true }),
  set: async (scope, key, value) => {
    const path = key.split("."); let o = rtc[scope];
    for (const p of path.slice(0, -1)) o = o[p] ??= {};
    o[path.at(-1)] = value;
    const changed = {}; let c = changed; for (const p of [scope, ...path.slice(0, -1)]) c = c[p] = {}; c[path.at(-1)] = value;
    // like Foundry: the client acts on the change, then the hook runs
    await game.webrtc?.client?.onSettingsChanged(changed);
    Hooks.callAll("rtcSettingsChanged", rtc, changed);
  }
};
globalThis.game = {
  version: "14.369",
  modules: new Map([["proximity-voice-chat", { version: "test", active: true }]]),
  settings: { register: (m, k, c) => { settings[k] ??= c.default; settingConfigs[k] = c; }, get: (m, k) => settings[k],
    set: async (m, k, v) => { settings[k] = v; settingConfigs[k]?.onChange?.(v); }, registerMenu() {} },
  i18n: { localize: s => s, format: (s, d) => s + " " + JSON.stringify(d) },
  socket: { on() {}, emit() {} },
  keybindings: { register() {}, get: () => [] },
  users: Object.assign(users, { get: id => users.find(u => u.id === id) }),
  audio: { startLevelReports: (id, stream, cb) => { levelReports.set(id, { stream, cb }); return true; }, stopLevelReports: id => { levelReports.delete(id); } },
};
globalThis.canvas = { ready: false, tokens: { controlled: [] } };
globalThis.ui = { webrtc: { render() {}, setUserIsSpeaking() {}, getUserVideoElement: () => null }, notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuid = async () => null;

await import(mainScript);
Hooks.callAll("init"); await tick(); Hooks.callAll("i18nInit");
const api = game.modules.get("proximity-voice-chat").api;
const set = (key, value) => game.settings.set("proximity-voice-chat", key, value);
users.forEach(u => u.isSelf = u.id === "p1"); game.user = game.users.get("p1"); game.userId = "p1";
const master = new AVMaster(rtc);
game.webrtc = master;
Hooks.callAll("ready"); await tick();

const client = master.client;
const sentTrack = () => client.localStream?.getAudioTracks()[0];
const worklet = () => FakeWorkletNode.instances.at(-1);
const mic = () => mics.at(-1);
const status = () => api.get_mic_status?.() ?? {};
/** Foundry connecting, with the cleanup's worklet starting up as a browser's would */
async function connect({ ready = true } = {}) {
  const connecting = master.connect();
  await tick();
  if (ready) await worklet()?.emit({ type: "ready", version: "test", denoiser: true, error: null });
  await connecting; await tick();
}

check("the filter is fetched early, with the version in its address against stale caches", fetched.some(url => url.includes("vendor/rnnoise/rnnoise.wasm?v=")), fetched.join(" "));
check("cleanup is on by default (the GM's default, which is on)", settings.micCleanupDefault === true && settings.micCleanup === "default");

// --- a page that has already been clicked: the cleanup starts with the first connection
FakeAudioContext.startState = "running";
await connect();
check("Foundry's outgoing stream now carries the cleaned-up track, not the microphone", !!sentTrack() && sentTrack() !== mic() && sentTrack().label === "destination", sentTrack()?.label);
check("...the camera track is untouched", client.localStream.getVideoTracks().length === 1);
check("...the context runs at RNNoise's 48 kHz", FakeAudioContext.instances.at(-1).sampleRate === 48000);
check("...the worklet is the module's, loaded with the version in its address", FakeAudioContext.instances.at(-1).audioWorklet.modules.some(u => u.includes("voice-input-worklet.js?v=")));
check("...and it's fed a copy of the microphone, so Foundry muting the sent track can't deafen the gate", FakeAudioContext.instances.at(-1).sources.at(-1)?.stream.getAudioTracks()[0]?.original === mic());
check("...through a high-pass filter", FakeAudioContext.instances.at(-1).sources.at(-1)?.outputs[0]?.type === "highpass");
check("Foundry's level readings measure what's sent", client.levelsStream.getAudioTracks()[0]?.original === sentTrack());
check("status says it's active", status().state === "active", JSON.stringify(status()));
/** A connection Foundry makes from its outgoing stream as it is at that moment */
const newPeer = id => { const peer = new FakePeer(client.localStream); client.peers.set(id, peer); return peer; };
const firstPeer = newPeer("p2");
check("a connection made now sends the cleaned-up track", firstPeer.sending()[0] === sentTrack());
check("Always Enabled: the sent track stays on; the gate shapes the sound", sentTrack().enabled === true && master.broadcasting === true);
check("the worklet was told: automatic, Balanced, filter on, not whispering", JSON.stringify(worklet().settings) === JSON.stringify({ gate: "auto", strictness: 3, threshold: -45, whisper: false, filter: true }), JSON.stringify(worklet().settings));

// --- muting still works on the track Foundry sends
await rtc.set("client", "users.p1.muted", true);
check("muting switches the sent track off", sentTrack().enabled === false);
await rtc.set("client", "users.p1.muted", false);
check("unmuting switches it back on", sentTrack().enabled === true);

// --- Voice Activation: the gate decides when you transmit
await rtc.set("client", "voice.mode", "activity");
check("Voice Activation: Foundry's own detector isn't running", !levelReports.has("p1"));
check("...and nothing is sent while the gate is closed", master.broadcasting === false && sentTrack().enabled === false);
await worklet().emit({ type: "decision", open: true }); await tick();
check("the gate deciding to open (ahead of the sound) starts the transmission", master.broadcasting === true && sentTrack().enabled === true);
await worklet().emit({ type: "gate", open: true });
await worklet().emit({ type: "decision", open: false }); await tick();
check("...it keeps going while the last word fades out", master.broadcasting === true);
await worklet().emit({ type: "gate", open: false }); await tick();
check("...and stops once the fade has finished", master.broadcasting === false && sentTrack().enabled === false);
await rtc.set("client", "users.p1.muted", true);
await worklet().emit({ type: "decision", open: true }); await tick();
check("muted: speaking doesn't transmit", master.broadcasting === false && sentTrack().enabled === false);
await worklet().emit({ type: "decision", open: false }); await worklet().emit({ type: "gate", open: false });
await rtc.set("client", "users.p1.muted", false);
check("...unmuted, still nothing until you speak", master.broadcasting === false);
await worklet().emit({ type: "decision", open: true }); await tick();
check("...and speaking transmits again", master.broadcasting === true);
await worklet().emit({ type: "decision", open: false }); await worklet().emit({ type: "gate", open: false }); await tick();

// --- push-to-talk: the key is the gate
await rtc.set("client", "voice.mode", "ptt");
check("push-to-talk: the worklet's gate stays open", worklet().settings.gate === "open");
master.broadcast(true);
check("...and holding the key transmits as usual", master.broadcasting === true && sentTrack().enabled === true);
master.broadcast(false);
await rtc.set("client", "voice.mode", "always");
check("back to Always Enabled: the automatic gate again", worklet().settings.gate === "auto");

// --- Whisper mode and the Mic Setup settings reach the worklet
api.set_voice_mode("whisper"); await tick();
check("Whisper mode tells the gate to ask for less", worklet().settings.whisper === true);
api.set_voice_mode("normal"); await tick();
check("...and Normal mode back", worklet().settings.whisper === false);
await set("micStrictness", 5); await set("micGateAuto", false); await set("micThreshold", -38); await set("micNoiseFilter", false);
check("Mic Setup's settings apply at once", JSON.stringify(worklet().settings) === JSON.stringify({ gate: "manual", strictness: 5, threshold: -38, whisper: false, filter: false }), JSON.stringify(worklet().settings));
await set("micStrictness", 3); await set("micGateAuto", true); await set("micThreshold", -45); await set("micNoiseFilter", true);

// --- turning it off and on while connected
const liveTrack = sentTrack();
await set("micCleanup", "off"); await tick();
check("turning it off puts the microphone back, on connections that are up too", sentTrack() === mic() && firstPeer.sending()[0] === mic(), firstPeer.sending()[0]?.label);
check("...switched on, as the cleaned-up track was", mic().enabled === true);
check("...Foundry's readings measure the microphone again", client.levelsStream.getAudioTracks()[0]?.original === mic());
check("...and the cleanup is stopped", liveTrack.readyState === "ended" && FakeAudioContext.instances.at(-1).state === "closed" && status().state === "off");
await set("micCleanup", "default"); await tick();
await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null }); await tick();
check("turning it back on swaps the cleaned-up track in again, without reconnecting", sentTrack()?.label === "destination" && firstPeer.sending()[0] === sentTrack());

// --- the GM's default and the player's own choice
await set("micCleanupDefault", false); await tick();
check("the GM turning the default off turns it off for a player who follows it", sentTrack() === mic() && status().state === "off");
await set("micCleanup", "on"); await tick();
await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null }); await tick();
check("...a player can still turn it on for themselves", sentTrack()?.label === "destination");
await set("micCleanupDefault", true); await set("micCleanup", "off"); await tick();
check("...or off, when the GM's default is on", sentTrack() === mic());
await set("micCleanup", "default"); await tick();
await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null }); await tick();

// --- the microphone device changes: Foundry replaces its stream
const oldMic = mic(), oldTrack = sentTrack(), oldContext = FakeAudioContext.instances.at(-1);
const changing = client.updateLocalStream();
await tick(); await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null });
await changing; await tick();
check("a new microphone: the old one and its cleanup are stopped", oldMic.readyState === "ended" && oldTrack.readyState === "ended" && oldContext.state === "closed");
check("...the new one is cleaned up and sent on the existing connection", mic() !== oldMic && sentTrack()?.label === "destination" && firstPeer.sending().length === 1 && firstPeer.sending()[0] === sentTrack());

// --- a page nobody has clicked yet: the microphone is sent as it is until a click
FakeAudioContext.startState = "suspended";
const unclicked = client.updateLocalStream();
await tick(); await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null });
await unclicked; await tick();
check("before a click the microphone is sent as it is", sentTrack() === mic() && status().state === "waiting", status().state);
const secondPeer = newPeer("gm");
check("...on new connections too", secondPeer.sending()[0] === mic());
Object.defineProperty(globalThis.navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
click(); await tick();
check("after a click the cleaned-up track replaces it on every connection, without reconnecting",
  sentTrack()?.label === "destination" && firstPeer.sending()[0] === sentTrack() && secondPeer.sending()[0] === sentTrack(), [firstPeer, secondPeer].map(p => p.sending()[0]?.label).join(", "));
const context = FakeAudioContext.instances.at(-1);
context._state("suspended"); await tick();
check("if the browser stops the audio (another app took the device), the microphone is sent again", sentTrack() === mic() && firstPeer.sending()[0] === mic());
click(); await tick();
check("...and the cleanup comes back after the next click", sentTrack()?.label === "destination");

// --- the worklet loading slowly: Foundry isn't held up
FakeAudioContext.startState = "running";
let done = false;
const slow = client.updateLocalStream().then(() => (done = true));
await tick(30);
check("while the filter loads, Foundry waits a moment for it", !done);
fireTimers(1500); await slow; await tick();
check("...then goes ahead with the microphone as it is", done && sentTrack() === mic() && status().state === "starting", status().state);
await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null }); await tick();
check("...and swaps in the cleanup when it's ready", sentTrack()?.label === "destination");

// --- failures put the microphone back, with a reason
await worklet().emit({ type: "error", error: "boom" }); await tick();
check("an error in the worklet puts the microphone back", sentTrack() === mic() && firstPeer.sending()[0] === mic());
check("...and says why", status().state === "failed" && status().reason === "error" && status().detail === "boom", JSON.stringify(status()));
const report = await api.collect_diagnostics();
check("Voice Diagnostics reports it", report.self.mic.cleanup?.state === "failed" && report.self.mic.cleanup?.reason === "error");
await set("micCleanup", "on"); await tick();
await worklet().emit({ type: "ready", version: "test", denoiser: true, error: null }); await tick();
check("changing the setting tries again", sentTrack()?.label === "destination" && status().state === "active");
await worklet().emit({ type: "ready", version: "test", denoiser: false, error: "no RNNoise file" }); await tick();
FakeAudioContext.workletMode = "reject";
await client.updateLocalStream(); await tick();
check("a worklet that won't load: the microphone is sent as it is", sentTrack() === mic() && status().state === "failed" && status().reason === "worklet", JSON.stringify(status()));
FakeAudioContext.workletMode = "ok";
await set("micCleanup", "default"); await tick();
await worklet().emit({ type: "ready", version: "test", denoiser: false, error: "the noise filter file couldn't be loaded (404)" }); await tick();
check("without the filter file, the gate still runs, going by loudness", sentTrack()?.label === "destination" && status().filter === false && /404/.test(status().filterError), JSON.stringify(status()));
FakeAudioContext.deviceRate = 44100;
const RealContext = globalThis.AudioContext;
globalThis.AudioContext = class extends RealContext { constructor(o) { super({ ...o, sampleRate: 44100 }); } };// a browser ignoring the rate asked for
await client.updateLocalStream(); await tick();
check("a browser that won't run at 48 kHz: the microphone is sent as it is", sentTrack() === mic() && status().reason === "rate", JSON.stringify(status()));
globalThis.AudioContext = RealContext;
const savedNode = globalThis.AudioWorkletNode; delete globalThis.AudioWorkletNode;
await set("micCleanup", "on"); await tick();
await client.updateLocalStream(); await tick();
check("a browser without AudioWorklet: the microphone is sent as it is", sentTrack() === mic() && status().reason === "unsupported", JSON.stringify(status()));
globalThis.AudioWorkletNode = savedNode;

console.log(fails ? fails + " FAILURES" : "ALL PASSED");
process.exit(fails ? 1 : 0);

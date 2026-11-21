// Run with: node test/audio.mjs
// The advanced voice path (scripts/voice-audio.js) and sound propagation as the module applies them, driven through
// Foundry's hooks as Alice (a player), with a fake Web Audio (test/fake-audio.mjs) in place of the browser's.
import { FakeAudioContext, FakeAudioElement } from "./fake-audio.mjs";

const hooks = {};
globalThis.Hooks = {
  on: (n, f) => (hooks[n] ??= []).push(f),
  once: (n, f) => { const w = (...a) => { hooks[n] = hooks[n].filter(x => x !== w); return f(...a); }; (hooks[n] ??= []).push(w); },
  callAll: (n, ...a) => [...(hooks[n] ?? [])].forEach(f => f(...a)),
};

// --- a page: just enough DOM for the module's buttons, its hidden <audio> element, and clicks
const el = () => ({ classList: { add() {}, toggle() {} }, style: {}, setAttribute() {}, getAttribute() {}, appendChild() {}, append() {} });
const pageListeners = {};
const body = { classList: { toggle() {} }, children: [], append(node) { node.attached = true; this.children.push(node); } };
globalThis.document = {
  hidden: false, body, querySelector: () => null,
  createElement: tag => tag === "audio" ? new FakeAudioElement() : el(),
  addEventListener: (type, fn) => (pageListeners[type] ??= []).push(fn),
};
/** A click on the page, which is what lets a browser start audio */
const click = () => (pageListeners.click ?? []).forEach(fn => fn({ type: "click" }));
globalThis.AudioContext = FakeAudioContext;

// timers: short ones run for real; long ones (the 5 second "audio never started" check) wait to be fired by hand
const realTimeout = globalThis.setTimeout;
let longTimers = [];
globalThis.setTimeout = (fn, ms, ...args) => ms >= 1000 ? (longTimers.push(fn), -longTimers.length) : realTimeout(fn, ms, ...args);
const fireLongTimers = () => { const due = longTimers; longTimers = []; due.forEach(fn => fn()); };
const intervals = []; globalThis.setInterval = fn => (intervals.push(fn), 0);
const tick = (ms = 8) => new Promise(r => realTimeout(r, ms));

// --- Foundry stubs
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { a: {}, footer: {} } });
// like Foundry's sound source without walls in the way: these scenes' walls are handled by the module's own maths
class PointSoundSource {
  constructor(o) { this.o = o; this.data = {}; }
  initialize(d) { Object.assign(this.data, d); this.shape = { points: [] }; }
  getVolumeMultiplier(l) { const d = Math.hypot(l.x - this.data.x, l.y - this.data.y); return d > this.data.radius ? 0 : (Math.cos(Math.PI * d / this.data.radius) + 1) / 2; }
}
// Foundry's real volume curve (AudioHelper, order 1.5)
const inputToVolume = v => Math.pow(v, 1.5), volumeToInput = v => Math.pow(v, 1 / 1.5);
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() } },
  canvas: { sources: { PointSoundSource } },
  av: { AVSettings: { AV_MODES: { DISABLED: 0, AUDIO: 1, VIDEO: 2, AUDIO_VIDEO: 3 } } },
  audio: { AudioHelper: { volumeToInput, inputToVolume } },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
const settings = {}, settingConfigs = {};
const mkUser = (id, name, isGM) => ({ id, name, isGM, uuid: "User." + id, active: true, isSelf: false, flags: {},
  getFlag(m, k) { return this.flags[k]; }, async setFlag(m, k, v) { this.flags[k] = v; Hooks.callAll("updateUser", this, { flags: { [m]: { [k]: v } } }); } });
const users = [mkUser("gm", "GM", true), mkUser("p1", "Alice", false), mkUser("p2", "Bob", false)];
const mkToken = (id, x, y, userlist, owner) => {
  const doc = { id, name: "Token " + id, uuid: "Scene.s.Token." + id, x, y, elevation: 0, level: "L1", _source: { x, y, elevation: 0 }, parent: null, flags: { "proximity-voice-chat": { userlist } },
    getFlag(m, k) { return this.flags[m]?.[k]; }, getSoundOrigin(d = {}) { return { x: (d.x ?? this.x) + 50, y: (d.y ?? this.y) + 50, elevation: 0 }; },
    getListenerPosition(d = {}) { return this.getSoundOrigin(d); }, testUserPermission: () => true };
  return { document: doc, owners: owner, visible: true };
};
// Alice's token centre is (50, 50); Bob's is 6 tiles to her right at (650, 50). Voices carry 12 tiles.
const tokens = [mkToken("alice", 0, 0, "User.p1", "p1"), mkToken("bob", 600, 0, "User.p2", "p2")];
// Foundry keeps a level's walls as edges, with the scene's outer bounds among them
const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 };
const edge = (ax, ay, bx, by, extra = {}) => ({ type: "wall", a: { x: ax, y: ay }, b: { x: bx, y: by }, sound: SENSE.NORMAL, direction: 0, threshold: { sound: 0 }, object: { door: 0, ds: 0 }, ...extra });
const bounds = { type: "outerBounds", a: { x: 350, y: -5000 }, b: { x: 350, y: 5000 }, sound: SENSE.NORMAL, direction: 0 };
const level = { id: "L1", edges: new Map([["bounds", bounds]]) };
const scene = { tokens: tokens.map(t => t.document), grid: { size: 100 }, flags: {}, getFlag(m, k) { return this.flags[k]; }, levels: new Map([["L1", level]]) };
tokens.forEach(t => t.document.parent = scene);
/** Replaces the scene's walls, as when a GM draws one or anyone opens a door, and waits for the module to catch up */
const setWalls = async (...walls) => {
  level.edges = new Map([["bounds", bounds], ...walls.map((w, i) => ["wall." + i, w])]);
  Hooks.callAll("updateWall", {}, {}); await tick(80);
};

// each user's incoming stream, and the camera element Foundry plays it through
const liveTrack = () => ({ kind: "audio", enabled: true, readyState: "live", muted: false });
const mkStream = id => { const tracks = [liveTrack()]; return { id, getAudioTracks: () => tracks }; };
const streams = { gm: mkStream("gm"), p2: mkStream("p2") };
const media = {};
const hidden = new Set();
const mkMedia = id => (media[id] = { tagName: "VIDEO", volume: 1, paused: false, muted: false, srcObject: streams[id], plays: 0, play() { this.plays++; this.paused = false; return Promise.resolve(); } });
const rtc = {
  world: { mode: 1 }, client: { audioSink: "default", muteAll: false, users: {} }, activity: {},
  getUser: id => ({ volume: rtc.client.users[id]?.volume ?? 1, muted: false, blocked: hidden.has(id), canBroadcastAudio: true }),
  set: async (scope, key, value) => {
    const path = key.split("."); let o = rtc[scope];
    for (const p of path.slice(0, -1)) o = o[p] ??= {};
    o[path.at(-1)] = value;
    Hooks.callAll("rtcSettingsChanged", rtc, {});
  }
};
const socketHandlers = [], emitted = [];
const receive = message => socketHandlers.forEach(fn => fn(message));
globalThis.game = {
  version: "14.369",
  modules: new Map([["proximity-voice-chat", { version: "test", active: true }]]),
  // like Foundry: set() runs the setting's onChange
  settings: { register: (m, k, c) => { settings[k] ??= c.default; settingConfigs[k] = c; }, get: (m, k) => settings[k],
    set: async (m, k, v) => { settings[k] = v; settingConfigs[k]?.onChange?.(v); }, registerMenu() {} },
  i18n: { localize: s => s, format: (s, d) => s + " " + JSON.stringify(d) },
  socket: { on: (n, fn) => socketHandlers.push(fn), emit: (n, data) => emitted.push(data) },
  keybindings: { register() {}, get: () => [] },
  users: Object.assign(users, { get: id => users.find(u => u.id === id) }),
  // Foundry makes no camera element for a user you've hidden
  webrtc: { settings: rtc, client: { getMediaStreamForUser: id => streams[id] ?? null, peers: new Map() } },
};
globalThis.canvas = { ready: true, scene, level, dimensions: { distancePixels: 20 }, tokens: { controlled: [] } };
const notices = [];
globalThis.ui = { webrtc: { render() {}, getUserVideoElement: id => hidden.has(id) ? null : (media[id] ?? mkMedia(id)) },
  notifications: { info: m => notices.push("INFO " + m), warn: m => notices.push("WARN " + m), error: m => notices.push("ERROR " + m) } };
globalThis.fromUuid = async () => null;

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log((ok ? "ok  " : "FAIL") + " " + label + (detail !== "" ? "  [" + detail + "]" : "")); };
const near = (label, got, want, tolerance = 0.005) => check(label, typeof got === "number" && Math.abs(got - want) <= tolerance, got + " (want " + (typeof want === "number" ? Number(want.toFixed(4)) : want) + ")");

const mainScript = process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href;
await import(mainScript);
const P = await import(new URL("./voice-propagation.js", mainScript.startsWith("file:") ? mainScript : "file://" + mainScript).href);
// the module's init hook is async; Foundry is long done with it before "ready"
Hooks.callAll("init"); await tick(); Hooks.callAll("i18nInit");
const api = game.modules.get("proximity-voice-chat").api;
const set = (key, value) => game.settings.set("proximity-voice-chat", key, value);

function becomeUser(id) {
  users.forEach(u => u.isSelf = u.id === id); game.user = game.users.get(id);
  canvas.tokens.ownedTokens = tokens.filter(t => game.user.isGM || t.owners === id).map(t => ({ document: t.document, isOwner: true }));
  canvas.tokens.controlled = [];
  canvas.tokens.placeables = tokens.map(t => ({ document: t.document, isOwner: game.user.isGM || t.owners === id, visible: true }));
  Hooks.callAll("canvasReady", canvas);
}
const moveBob = async (x, y = 0) => { const d = tokens[1].document; d.x = d._source.x = x; d.y = d._source.y = y; Hooks.callAll("refreshToken", { document: d, isOwner: false }, { refreshPosition: true }); await tick(); };
const eased = (d, r = 1200) => d >= r ? 0 : (Math.cos(Math.PI * d / r) + 1) / 2;
const context = () => FakeAudioContext.instances.at(-1);
const output = () => FakeAudioElement.instances.at(-1);
/** The nodes a user's voice runs through, found the way sound would flow: from their stream's source node onwards */
const chain = id => {
  const source = context()?.sources.findLast(node => node.stream === streams[id] && !node.disconnected);
  if (!source) return null;
  const gain = source.outputs[0], filter = gain?.outputs[0], panner = filter?.outputs[0], limiter = panner?.outputs[0];
  return { source, gain, filter, panner, limiter, destination: limiter?.outputs[0] };
};
/** A voice's gain as the module was asked for it: the node also carries the make-up for mixing down to mono */
const gainOf = id => chain(id).gain.gain.value / Math.SQRT2;
const report = async (options) => api.collect_diagnostics(options);
const peer = async (id, options) => (await report(options)).peers.find(p => p.id === id);

becomeUser("p1");
Hooks.callAll("ready"); await tick(30);

// --- before the first click: the browser hasn't let audio start yet
check("a new browser tab's audio context starts suspended", context()?.state === "suspended");
check("until a click, the path is the old one, and it's waiting, not broken", api.get_audio_status().path === "old" && api.get_audio_status().reason === "waiting" && api.get_audio_status().problem === false, JSON.stringify(api.get_audio_status()));
near("...Bob plays through his camera element at his proximity volume", media.p2.volume, inputToVolume(eased(600)));
check("...which isn't muted", media.p2.muted === false);
check("...and nobody is warned about it", !notices.some(n => n.includes("Audio.Fallback")), notices.join(" | "));
check("...the self-test tells the GM which path is in use", emitted.some(m => m.action === "voice-self-test" && m.audio?.reason === "waiting"), JSON.stringify(emitted.filter(m => m.action === "voice-self-test")));

// --- input that doesn't count as a gesture (the browser says so) starts nothing
Object.defineProperty(globalThis.navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true });
click(); await tick();
check("a key press the browser doesn't count as a gesture doesn't try to start audio", context().state === "suspended" && longTimers.length === 0);
Object.defineProperty(globalThis.navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });

// --- the first click starts the advanced path
click(); await tick();
check("a click resumes the audio context", context().state === "running");
check("...and the path is now the advanced one", api.get_audio_status().path === "advanced" && api.get_audio_status().reason === null, JSON.stringify(api.get_audio_status()));
{
  const c = chain("p2");
  check("Bob's stream runs source -> gain -> low-pass filter -> panner -> limiter -> output stream",
    !!c && c.gain?.kind === "gain" && c.filter?.kind === "filter" && c.filter.type === "lowpass" && c.panner?.kind === "panner" && c.limiter?.kind === "limiter" && c.destination?.kind === "destination",
    c ? [c.gain?.kind, c.filter?.kind, c.panner?.kind, c.limiter?.kind, c.destination?.kind].join(" > ") : "no chain");
  check("the source is the stream on Bob's camera element", c.source.stream === media.p2.srcObject);
  check("the GM's voice joins the same limiter", chain("gm")?.limiter === c.limiter && chain("gm").gain !== c.gain);
  check("one hidden <audio> element plays the output stream", FakeAudioElement.instances.length === 1 && output().srcObject === c.destination.stream && output().attached && output().style.display === "none" && output().plays >= 1);
  check("there's one audio context for all voices", FakeAudioContext.instances.length === 1);
  check("Bob's camera element is muted, so he isn't heard twice", media.p2.muted === true && media.gm.muted === true);
  check("...but still playing, which Chrome needs to feed Web Audio", media.p2.paused === false);
  near("Bob's gain is his proximity volume times the 150% boost", gainOf("p2"), inputToVolume(eased(600)) * 1.5);
  check("a new voice starts at its volume instead of fading from full", c.gain.gain.ramps.length === 0);
  check("a voice is mixed to one channel before it's placed, so placing it doesn't make it louder", c.gain.channelCount === 1 && c.gain.channelCountMode === "explicit");
  check("in the open there's no filtering", c.filter.frequency.value === 20000 && c.panner.pan.value === 0);
  const l = c.limiter;
  check("the limiter is gentle: it only catches peaks", l.threshold.value >= -12 && l.threshold.value <= 0 && l.ratio.value >= 4 && l.attack.value <= 0.01 && l.release.value >= 0.1,
    [l.threshold.value, l.knee.value, l.ratio.value, l.attack.value, l.release.value].join(", "));
  check("the default output device needs no setSinkId (Firefox refuses \"default\")", output().sinkCalls.length === 0, output().sinkCalls.join(","));
}
near("the GM, a global speaker, is at full volume times the boost", gainOf("gm"), 1.5);
{
  const p = await peer("p2");
  check("diagnostics: Bob is on the advanced path, with gain, filter and pan", p.audio.path === "advanced" && Math.abs(p.audio.gain - inputToVolume(eased(600)) * 1.5) < 0.01 && p.audio.cutoff === 20000 && p.audio.pan === 0, JSON.stringify(p.audio));
  check("diagnostics: he's heard in the open", p.heard === "in the open" && p.via === "open" && p.muffle === 0, p.heard);
  const self = (await report()).self;
  check("diagnostics: this browser's path and the boost", self.audio.path === "advanced" && self.audio.boost === 1.5 && self.soundPropagation === true && self.directional === 0, JSON.stringify(self.audio));
  check("diagnostics: the scripts' versions include the two new files", typeof self.scripts === "string" && !self.scripts.includes("undefined"));
}

// --- boost, per-person volume, smooth changes
await set("voiceBoost", 300); await tick();
{
  const g = chain("p2").gain.gain;
  near("raising the boost to 300% doubles Bob's gain", g.value / Math.SQRT2, inputToVolume(eased(600)) * 3);
  check("...eased in over a few hundredths of a second, not jumped", g.ramps.length === 1 && g.ramps[0].constant > 0 && g.ramps[0].constant <= 0.2, JSON.stringify(g.ramps));
  await tick(); intervals.forEach(fn => fn()); await tick();
  check("the once-a-second re-apply doesn't schedule the same change again", g.ramps.length === 1);
}
await set("voiceBoost", 150); await tick();
await api.set_user_voice_volume("p2", 1.5); await tick();
near("a per-person volume of 150% goes past what Foundry's own volume can hold", gainOf("p2"), inputToVolume(1.5 * eased(600)) * 1.5);
check("...Foundry's own per-user volume stays at its 100% maximum", rtc.client.users.p2.volume === 1 && api.get_user_voice_volume("p2") === 1.5);
await api.set_user_voice_volume("p2", 0.5); await tick();
near("a per-person volume under 100% is Foundry's own, as before", gainOf("p2"), inputToVolume(0.5 * eased(600)) * 1.5);
near("...stored where Foundry keeps it", rtc.client.users.p2.volume, inputToVolume(0.5));
await api.set_user_voice_volume("p2", 1); await tick();

// --- deafen, global speakers, voice modes: the same on this path
rtc.client.muteAll = true; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
check("deafen silences everyone on the advanced path", gainOf("p2") === 0 && gainOf("gm") === 0);
check("...and their camera elements stay muted", media.p2.muted && media.gm.muted);
rtc.client.muteAll = false; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
near("undeafened, Bob is back", gainOf("p2"), inputToVolume(eased(600)) * 1.5);
await moveBob(1500);
check("out of range, Bob's gain is 0", gainOf("p2") === 0 && api.get_user_volume("p2") === 0);
receive({ action: "voice-mode", from: "p2", mode: "yell" }); await tick();
near("yelling carries twice as far on this path too", gainOf("p2"), inputToVolume(eased(1500, 2400)) * 1.5);
receive({ action: "voice-mode", from: "p2", mode: "normal" }); await tick();
await api.set_global_listener(users[1], true); await tick();
near("Global Listening hears far-away Bob at full volume", gainOf("p2"), 1.5);
await api.set_global_listener(users[1], false); await tick();
await moveBob(600);

// --- a hidden user gets no audio, whatever the browser would do
hidden.add("p2"); Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
check("a user you've hidden isn't played: their voice is disconnected", chain("p2") === null && context().sources.filter(n => n.stream === streams.p2).every(n => n.disconnected));
check("...and diagnostics still say hidden", (await peer("p2")).hidden === true && (await peer("p2")).audio.path === "old");
hidden.delete("p2"); delete media.p2; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
check("shown again, they're played again, on a muted element", !!chain("p2") && media.p2.muted === true);

// --- Foundry re-renders a camera tile: the replacement element must not be heard, even for a moment
{
  const old = media.p2; delete media.p2;
  Hooks.callAll("renderCameraViews", {}, {}, {}, {});
  check("a camera element Foundry has just replaced is muted at once, before the next update", media.p2 !== old && media.p2.muted === true);
  await tick();
  check("...and Bob's voice carries on through the advanced path", !!chain("p2") && chain("p2").source.stream === media.p2.srcObject);
}

// --- streams come and go
{
  const before = chain("p2").source;
  streams.p2 = mkStream("p2-reconnected"); media.p2.srcObject = streams.p2; intervals.forEach(fn => fn()); await tick();
  check("a new stream (they reconnected) replaces the old one's nodes", before.disconnected && !!chain("p2") && chain("p2").source !== before);
  const silent = { id: "no-mic", getAudioTracks: () => [] };
  streams.p2 = silent; media.p2.srcObject = silent; intervals.forEach(fn => fn()); await tick();
  check("someone sending no audio isn't routed, and that isn't a failure", chain("p2") === null && api.get_audio_status().path === "advanced" && (await peer("p2")).audio.reason === null);
  streams.p2 = mkStream("p2"); media.p2.srcObject = streams.p2; intervals.forEach(fn => fn()); await tick();
  users[2].active = false; Hooks.callAll("userConnected", users[2], false); await tick();
  check("someone who leaves is disconnected", chain("p2") === null);
  users[2].active = true; Hooks.callAll("userConnected", users[2], true); await tick();
  check("...and reconnected when they're back", !!chain("p2"));
}

// --- walls: muffled, not silent
await setWalls(edge(350, -300, 350, 400, { object: { door: 1, ds: 0 } }));
{
  const c = chain("p2");
  near("through a closed door Bob is filtered to the door's cutoff", c.filter.frequency.value, P.muffle_cutoff(0.5), 1);
  check("...which keeps speech intelligible", c.filter.frequency.value > 2000 && c.filter.frequency.value < 3000);
  check("...eased in", c.filter.frequency.ramps.length === 1 && c.filter.frequency.ramps[0].constant > 0);
  near("...and only a little quieter", gainOf("p2"), inputToVolume(eased(600)) * 1.5 * P.muffle_gain(0.5));
  near("the volume others see (speaking cues, API) is the distance volume", api.get_user_volume("p2"), eased(600));
  const p = await peer("p2");
  check("diagnostics say how he's heard", p.heard === "through 1 closed door (muffled 50%)" && p.walls.door === 1 && p.cutoff === Math.round(P.muffle_cutoff(0.5)), p.heard);
  check("the scene's outer bounds aren't walls", !p.heard.includes("wall"));
  const h = api.get_user_hearing("p2");
  check("api.get_user_hearing gives the same", h.via === "through" && h.muffle === 0.5 && h.walls.door === 1 && h.pan === 0 && h.from === undefined, JSON.stringify(h));
  check("...without internals", h.plainWalls === undefined);
}
await setWalls(edge(350, -300, 350, 400, { sound: SENSE.NONE, object: { door: 1, ds: 1 } }));
check("opening the door clears the filter", chain("p2").filter.frequency.value === 20000 && (await peer("p2")).heard === "in the open");
await setWalls(edge(350, -300, 350, 400, { object: { door: 1, ds: 2 } }));
near("a locked door muffles by its own setting", api.get_user_hearing("p2").muffle, 0.6);
await set("muffleLocked", 20); await tick();
near("...which the GM can change", api.get_user_hearing("p2").muffle, 0.2);
await set("muffleLocked", 60);
await setWalls(edge(350, -300, 350, 400, { sound: SENSE.LIMITED }));
near("a Limited wall muffles by its setting, where Foundry would let it through untouched", api.get_user_hearing("p2").muffle, 0.4);
// a long Normal wall: through it is clearer than the long way round
await setWalls(edge(350, -900, 350, 900));
{
  const p = await peer("p2");
  check("through a Normal wall: heavily muffled", p.heard === "through 1 wall (muffled 75%)" && p.cutoff < 1000, p.heard + " " + p.cutoff);
  check("...but audible", p.volume > 0 && gainOf("p2") > 0.3 * inputToVolume(eased(600)) * 1.5);
}
// a secret door in that wall, for a player and for the GM's copy of the report
await setWalls(edge(350, -900, 350, 900, { object: { door: 2, ds: 0 } }));
check("a secret door is named in the full report", (await peer("p2")).heard.includes("1 secret door"), (await peer("p2")).heard);
check("...nor to a player's macros through the API", api.get_user_hearing("p2").walls.secret === undefined && api.get_user_hearing("p2").walls.normal === 1, JSON.stringify(api.get_user_hearing("p2").walls));
check("...but not in a player's own view", (await peer("p2", { redact: true })).heard === "through 1 wall (muffled 75%)" && !JSON.stringify((await peer("p2", { redact: true })).walls).includes("secret"), (await peer("p2", { redact: true })).heard);
// a short wall: round its end
await setWalls(edge(350, -10, 350, 400));
{
  const p = await peer("p2");
  const route = 2 * Math.hypot(300, 70);
  check("round a corner: the route and its bends", p.via === "around" && p.bends === 1 && Math.abs(p.routeLength - route) < 3 && p.heard === "around a corner (route 6 tiles, 1 bend)", p.heard + " " + p.routeLength);
  near("...as loud as the route is long", p.volume, eased(route), 0.01);
  near("...and barely muffled", chain("p2").filter.frequency.value, P.muffle_cutoff(P.BEND_MUFFLE), 1);
}
// 100%: the wall blocks, so only the way round is left; boxed in, nothing
await set("muffleNormal", 100);
await setWalls(edge(350, -400, 350, 400));
check("a wall type at 100% is routed round", (await peer("p2")).via === "around" && api.get_user_volume("p2") > 0, (await peer("p2")).heard);
await setWalls(edge(500, -200, 800, -200), edge(800, -200, 800, 300), edge(800, 300, 500, 300), edge(500, 300, 500, -200));
{
  const p = await peer("p2");
  check("boxed in by 100% walls, Bob is silent", p.volume === 0 && gainOf("p2") === 0 && api.get_user_volume("p2") === 0);
  check("...and the reason is the walls, not the distance", p.reason === "walls block the sound from their tokens" && p.heard === "blocked by 1 wall", p.reason + " / " + p.heard);
}
await set("muffleNormal", 75); await tick();
check("back at 75% he's heard through the box", (await peer("p2")).via === "through");
// propagation off: Foundry's own sound source decides, as before 2.0
await set("soundPropagation", false); await tick();
check("with sound propagation off there's no muffling", api.get_user_hearing("p2").muffle === 0 && chain("p2").filter.frequency.value === 20000 && api.get_voice_range(users[2]).length === 0);
await set("soundPropagation", true); await tick();
{
  const range = api.get_voice_range(users[2]);
  check("api.get_voice_range gives how far a voice can travel", range.length === 1 && range[0].x === 650 && range[0].y === 50 && range[0].radius === 1200, JSON.stringify(range));
}

// --- if the propagation maths ever throws, voices fall back to walls blocking, not to silence or a broken page
{
  await setWalls(edge(350, -900, 350, 900));
  const errors = []; const realError = console.error; console.error = (...a) => errors.push(a.join(" "));
  scene.testSurfaceCollision = () => { throw new Error("surfaces exploded"); };
  intervals.forEach(fn => fn()); await tick(); intervals.forEach(fn => fn()); await tick();
  console.error = realError;
  near("a failure working out propagation leaves Foundry's own sound source in charge", api.get_user_volume("p2"), eased(600));
  check("...logged once, not every update", errors.filter(e => e.includes("sound propagation failed")).length === 1, errors.length);
  check("...and shown in diagnostics", (await report()).self.propagationError === "surfaces exploded");
  delete scene.testSurfaceCollision;
  // a floor or ceiling in between blocks outright, as it does for Foundry's own sounds
  scene.testSurfaceCollision = (origin, point, options) => options.type === "sound" && options.level === "L1";
  intervals.forEach(fn => fn()); await tick();
  check("a floor or ceiling between them blocks completely", api.get_user_volume("p2") === 0 && (await peer("p2")).via === "blocked");
  delete scene.testSurfaceCollision; intervals.forEach(fn => fn()); await tick();
}

// --- while a token moves, routes are searched for at most every 100 ms
await setWalls(edge(350, -10, 350, 400));
{
  await tick(120);
  const before = api.get_user_hearing("p2").length;
  await moveBob(600, 100);// the first move after a pause is searched at once
  const first = api.get_user_hearing("p2").length;
  await moveBob(600, 300);// another within 100 ms keeps the last route for now
  const held = api.get_user_hearing("p2").length;
  check("a moving token's route is searched straight away the first time", first > before + 5, before + " -> " + first);
  check("...then held for a moment while it keeps moving", held === first, first + " -> " + held);
  await tick(160);
  check("...and brought up to date by itself once it stops", api.get_user_hearing("p2").length > held + 5, held + " -> " + api.get_user_hearing("p2").length);
  await moveBob(600, 0); await tick(160);
}

// --- directional voice
await setWalls();
check("directional voice is off by default: centred", chain("p2").panner.pan.value === 0);
await set("directionalAudio", true); await tick();
near("on, Bob to the right is panned right by the strength (60%)", chain("p2").panner.pan.value, 0.6);
check("...eased in", chain("p2").panner.pan.ramps.at(-1).constant > 0);
check("a global speaker stays centred", chain("gm").panner.pan.value === 0);
await set("directionalStrength", 100); await tick();
near("at full strength he's all the way right", chain("p2").panner.pan.value, 1);
await moveBob(-600, 0);
near("to the left, all the way left", chain("p2").panner.pan.value, -1);
await moveBob(0, -600);
near("straight up the screen, centred", chain("p2").panner.pan.value, 0);
await moveBob(20, 0);
check("on top of you, nearly centred instead of hard to one side", Math.abs(chain("p2").panner.pan.value) <= 0.4, chain("p2").panner.pan.value);
// round a corner the voice comes from the corner: Bob is up and to the left, the gap is to the right
await moveBob(-300, -600);
await setWalls(edge(-1000, -250, 150, -250));
{
  const p = await peer("p2");
  check("round a corner the voice comes from where the corner is, not where the speaker is", p.via === "around" && chain("p2").panner.pan.value > 0.2 && p.audio.pan > 0.2, p.heard + ", pan " + chain("p2").panner.pan.value);
}
await setWalls(); await moveBob(600, 0);
await set("directionalAudio", false); await set("directionalStrength", 60); await tick();

// --- a player's own switch back to the old path
await set("legacyAudio", true); await tick();
check("\"Use the Old Audio Path\" turns the advanced path off here", api.get_audio_status().path === "old" && api.get_audio_status().reason === "opted-out" && api.get_audio_status().problem === false);
check("...closes the audio context and removes the output element", context().state === "closed" && output().attached === false && output().srcObject === null);
check("...unmutes the camera elements", media.p2.muted === false && media.gm.muted === false);
near("...and plays Bob at his proximity volume, with no boost", media.p2.volume, inputToVolume(eased(600)));
check("...without warning anyone: it's a choice", !notices.some(n => n.includes("Audio.Fallback")));
await setWalls(edge(350, -900, 350, 900, { object: { door: 1, ds: 0 } }));
near("on the old path a closed door can only make Bob quieter", media.p2.volume, inputToVolume(eased(600)) * P.muffle_gain_legacy(0.5));
await set("muffleDoor", 100); await tick();
await setWalls(edge(500, -200, 800, -200, { object: { door: 1, ds: 0 } }), edge(800, -200, 800, 300), edge(800, 300, 500, 300), edge(500, 300, 500, -200));
await set("muffleNormal", 100); await tick();
check("...and fully blocked is silent there too", media.p2.volume === 0);
await set("muffleDoor", 50); await set("muffleNormal", 75); await setWalls();
await api.set_user_voice_volume("p2", 2); await tick();
near("a per-person volume above 100% is capped at 100% on the old path", media.p2.volume, inputToVolume(eased(600)));
await api.set_user_voice_volume("p2", 1); await tick();
rtc.client.muteAll = true; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
check("deafen works on the old path", media.p2.volume === 0 && media.gm.volume === 0);
rtc.client.muteAll = false; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
await set("legacyAudio", false); await tick(); click(); await tick();
check("switching it back off starts the advanced path again", api.get_audio_status().path === "advanced" && !!chain("p2") && media.p2.muted === true && FakeAudioContext.instances.length === 2);
await set("advancedAudio", false); await tick();
check("the GM's world setting turns it off for everyone", api.get_audio_status().reason === "disabled" && media.p2.muted === false && chain("p2") === null);
await set("advancedAudio", true); await tick(); click(); await tick();

// --- the output device
rtc.client.audioSink = "headset"; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick();
check("choosing an output device in Foundry sends the output element there", output().sinkCalls.join() === "headset" && output().sinkId === "headset" && api.get_audio_status().path === "advanced");
FakeAudioElement.badSinks.add("unplugged");
notices.length = 0; emitted.length = 0;
rtc.client.audioSink = "unplugged"; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick(); await tick();
{
  const status = api.get_audio_status();
  check("a device the browser refuses drops this browser to the old path", status.path === "old" && status.reason === "sink" && status.problem === true && status.detail.includes("unplugged"), JSON.stringify(status));
  check("...with the camera elements playing again", media.p2.muted === false && Math.abs(media.p2.volume - inputToVolume(eased(600))) < 0.005);
  check("...a warning here", notices.filter(n => n.startsWith("WARN proximity-voice-chat.Audio.Fallback") && n.includes("Reason.sink")).length === 1, notices.join(" | "));
  check("...and a report to the GMs", emitted.some(m => m.action === "voice-self-test" && m.audio?.reason === "sink"), JSON.stringify(emitted));
  check("diagnostics say why Bob is on the old path", (await peer("p2")).audio.path === "old" && (await peer("p2")).audio.reason === "sink");
  intervals.forEach(fn => fn()); await tick();
  check("it stays on the old path instead of trying again every second", FakeAudioContext.instances.length === 3 && api.get_audio_status().reason === "sink", FakeAudioContext.instances.length);
}
rtc.client.audioSink = "default"; Hooks.callAll("rtcSettingsChanged", rtc, {}); await tick(); click(); await tick();
check("choosing another device tries again", api.get_audio_status().path === "advanced" && media.p2.muted === true);

// --- other ways it can fail: each ends on the old path with its reason
const restart = async (prepare) => {
  // off and on again is also how a player retries; then a fresh browser state for the case
  await set("legacyAudio", true); await tick();
  FakeAudioContext.reset(); FakeAudioElement.reset(); notices.length = 0; emitted.length = 0; longTimers = [];
  prepare();
  await set("legacyAudio", false); await tick(); click(); await tick(); await tick();
};
const onOldPath = (reason) => {
  const status = api.get_audio_status();
  return status.path === "old" && status.reason === reason && status.problem === true && media.p2.muted === false && media.p2.volume > 0
    && notices.some(n => n.includes("Audio.Fallback") && n.includes("Reason." + reason)) && emitted.some(m => m.audio?.reason === reason);
};
await restart(() => { delete globalThis.AudioContext; });
check("a browser without Web Audio: old path, 'unsupported', warned and reported", onOldPath("unsupported"), JSON.stringify(api.get_audio_status()) + notices.join("|"));
globalThis.AudioContext = FakeAudioContext;
await restart(() => { FakeAudioContext.prototype.createStereoPanner = undefined; });
check("a browser missing one of the nodes: 'unsupported'", onOldPath("unsupported") && api.get_audio_status().detail.includes("createStereoPanner"), JSON.stringify(api.get_audio_status()));
delete FakeAudioContext.prototype.createStereoPanner;
FakeAudioContext.prototype.createStereoPanner = function () { return new (Object.getPrototypeOf(this.createGain()).constructor)(this, "panner", { pan: 0 }); };
await restart(() => { FakeAudioContext.resumeMode = "reject"; });
check("an audio context that refuses to start: 'resume'", onOldPath("resume"), JSON.stringify(api.get_audio_status()));
await restart(() => { FakeAudioContext.resumeMode = "hang"; });
check("an audio context that hasn't started yet is still just waiting", api.get_audio_status().reason === "waiting" && !notices.some(n => n.includes("Audio.Fallback")));
fireLongTimers(); await tick();
check("...and after 5 seconds without starting: 'resume'", onOldPath("resume"), JSON.stringify(api.get_audio_status()));
await restart(() => { FakeAudioElement.playMode = "reject"; });
check("an output element the browser won't play: 'output'", onOldPath("output"), JSON.stringify(api.get_audio_status()));
await restart(() => { FakeAudioContext.refuseStream = stream => stream === streams.p2; });
{
  const p = await peer("p2");
  check("one person's stream failing puts only them on the old path", api.get_audio_status().path === "advanced" && chain("p2") === null && !!chain("gm") && media.p2.muted === false && media.gm.muted === true);
  check("...diagnostics say so for them", p.audio.path === "old" && p.audio.reason === "voice-error" && typeof p.audio.detail === "string", JSON.stringify(p.audio));
  const sources = context().sources.length;
  intervals.forEach(fn => fn()); await tick();
  check("...without retrying their stream every second", context().sources.length === sources);
}
{
  const good = streams.p2;
  await restart(() => { streams.p2 = media.p2.srcObject = { id: "broken", getAudioTracks() { throw new Error("boom"); } }; });
  check("anything unexpected going wrong: 'error', and voices carry on the old way", onOldPath("error") && api.get_audio_status().detail === "boom", JSON.stringify(api.get_audio_status()));
  streams.p2 = media.p2.srcObject = good;
}
await restart(() => {});
check("after all that, a working browser is back on the advanced path", api.get_audio_status().path === "advanced" && !!chain("p2") && !notices.some(n => n.includes("Audio.Fallback")));
// a context the browser suspends later (e.g. the audio device went away) falls back until the next click
context()._state("suspended"); await tick();
check("a context suspended mid-session: old path meanwhile, as 'waiting'", api.get_audio_status().reason === "waiting" && media.p2.muted === false && chain("p2") === null);
click(); await tick();
check("...and back after a click", api.get_audio_status().path === "advanced" && media.p2.muted === true);

// --- voice chat turned off
rtc.world.mode = 0; intervals.forEach(fn => fn()); await tick();
check("with voice chat off nothing is routed", chain("p2") === null && chain("gm") === null);
rtc.world.mode = 1; intervals.forEach(fn => fn()); await tick();

// --- the GM is told when a player's browser falls back, by name, once
becomeUser("gm"); await tick(); notices.length = 0;
receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1 }, audio: { path: "old", reason: "resume", detail: "x" } });
check("the GM is told a player's browser fell back, and why", notices.length === 1 && notices[0].startsWith("WARN proximity-voice-chat.Audio.Player.Fallback") && notices[0].includes("Bob") && notices[0].includes("Reason.resume"), notices.join(" | "));
receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1 }, audio: { path: "old", reason: "resume", detail: "x" } });
check("...once, not on every report", notices.length === 1);
for (const reason of ["waiting", "opted-out", "disabled", null]) receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1 }, audio: { path: reason ? "old" : "advanced", reason } });
check("...and not for a choice, or for not having clicked yet", notices.length === 1, notices.join(" | "));
receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1 } });
check("a report from a browser on an older version (no audio section) is fine", notices.length === 1);

console.log(fails ? fails + " FAILURES" : "ALL PASSED");
process.exit(fails ? 1 : 0);

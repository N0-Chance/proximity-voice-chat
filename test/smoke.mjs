// Run with: node test/smoke.mjs
// Stub just enough of Foundry v14 to load the module and drive its hooks.
const hooks = {};
globalThis.Hooks = {
  on: (n, f) => (hooks[n] ??= []).push(f),
  once: (n, f) => (hooks[n] ??= []).push(f),
  callAll: (n, ...a) => (hooks[n] ?? []).forEach(f => f(...a)),
};
const el = () => ({ classList: { add() {}, toggle(c, v) { this[c] = v; } }, setAttribute() {}, getAttribute() {}, appendChild() {}, append(...k) { this.kids = k; } });
const gmControls = el();
globalThis.document = { hidden: false, createElement: el, addEventListener() {}, querySelector: () => gmControls,
  body: { classList: { toggle() {} } } };
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { a: {}, footer: {} } });
const media = {};
const mkMedia = (id) => (media[id] = { tagName: "VIDEO", volume: 1, paused: false, muted: false, srcObject: null, plays: 0, play() { this.plays++; this.paused = false; return Promise.resolve(); } });
class PointSoundSource {
  constructor(o) { this.o = o; this.data = {}; }
  initialize(d) { Object.assign(this.data, d); if (!d.level) throw new Error("no level"); }
  getVolumeMultiplier(l) { const d = Math.hypot(l.x - this.data.x, l.y - this.data.y); return d > this.data.radius ? 0 : (Math.cos(Math.PI * d / this.data.radius) + 1) / 2; }
}
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() } },
  canvas: { sources: { PointSoundSource }, loadTexture: async () => ({}) },
  av: { AVSettings: { AV_MODES: { DISABLED: 0, AUDIO: 1, VIDEO: 2, AUDIO_VIDEO: 3 } } },
  audio: { AudioHelper: { volumeToInput: v => Math.sqrt(v), inputToVolume: v => v * v } },
};
const settings = {};
const mkUser = (id, name, isGM) => ({ id, name, isGM, uuid: "User." + id, active: true, isSelf: false, flags: {},
  getFlag(m, k) { return this.flags[k]; }, async setFlag(m, k, v) { this.flags[k] = v; Hooks.callAll("updateUser", this, { flags: { [m]: { [k]: v } } }); } });
const users = [mkUser("gm", "GM", true), mkUser("p1", "Alice", false), mkUser("p2", "Bob", false)];
const mkToken = (id, x, y, userlist, owner) => {
  const doc = { id, name: "Token " + id, uuid: "Scene.s.Token." + id, x, y, elevation: 0, level: "L1", _source: { x, y, elevation: 0 }, parent: null, flags: { "proximity-voice-chat": { userlist } },
    getFlag(m, k) { return this.flags[m]?.[k]; }, getSoundOrigin(d = {}) { return { x: (d.x ?? this.x) + 50, y: (d.y ?? this.y) + 50, elevation: 0 }; },
    getListenerPosition(d = {}) { return this.getSoundOrigin(d); } };
  return { document: doc, owners: owner };
};
const tokens = [mkToken("t1", 0, 0, "User.p1", "p1"), mkToken("t2", 500, 0, "User.p2", "p2"), mkToken("t3", 5000, 0, "", "gm")];
const scene = { tokens: tokens.map(t => t.document), grid: { size: 100 }, flags: {}, getFlag(m, k) { return this.flags[k]; } };
tokens.forEach(t => t.document.parent = scene);
globalThis.game = {
  version: "14.365",
  modules: new Map([["proximity-voice-chat", { version: "test", active: true }]]),
  settings: { register: (m, k, c) => settings[k] = c.default, get: (m, k) => settings[k] },
  i18n: { localize: s => s, format: (s, d) => s + " " + JSON.stringify(d) },
  users: Object.assign(users, { get: id => users.find(u => u.id === id) }),
  webrtc: { settings: { world: { mode: 3 }, client: {}, getUser: id => ({ volume: 0.64, muted: false, canBroadcastAudio: true }) }, client: { getConnectedUsers: () => users.map(u => u.id) } },
};
globalThis.canvas = { ready: true, scene, level: { id: "L1" }, tokens: { controlled: [] } };
const notices = [];
globalThis.ui = { webrtc: { getUserVideoElement: id => media[id] ?? mkMedia(id) }, notifications: { info: (msg) => notices.push(msg), error: (msg) => notices.push("ERROR " + msg) } };
const click = async (button) => { await button.onclick({ preventDefault() {}, stopPropagation() {} }); await new Promise(r => setTimeout(r, 5)); };
globalThis.fromUuid = async () => null;

let fails = 0;
const intervals = []; globalThis.setInterval = (fn) => (intervals.push(fn), 0); // keep node from hanging
// Foundry only creates the canvas global during setup, after module scripts have loaded and timers can fire
const stubCanvas = globalThis.canvas; delete globalThis.canvas;
await import(process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href);
const tick = () => new Promise(r => setTimeout(r, 5));
try { intervals.forEach(fn => fn()); await tick(); console.log("ok   timer before canvas exists doesn't throw"); }
catch (err) { console.log("FAIL timer before canvas exists: " + err); process.exit(1); }
globalThis.canvas = stubCanvas;
Hooks.callAll("init"); Hooks.callAll("i18nInit"); Hooks.callAll("ready");
{ const ok = notices.some(n => n.startsWith("ERROR proximity-voice-chat.UI.StaleScript")); if (!ok) fails++; console.log((ok ? "ok  " : "FAIL") + " version mismatch (module 'test' vs script) raises the stale-script error"); }
const api = game.modules.get("proximity-voice-chat").api;
const expect = (label, got, want) => { const ok = Math.abs(got - want) < 0.01; if (!ok) fails++; console.log((ok ? "ok  " : "FAIL") + " " + label + ": " + got.toFixed(3) + " (want " + want + ")"); };

function becomeUser(id) {
  users.forEach(u => u.isSelf = u.id === id); game.user = game.users.get(id);
  canvas.tokens.ownedTokens = tokens.filter(t => game.user.isGM || t.owners === id).map(t => ({ document: t.document, isOwner: true }));
  canvas.tokens.controlled = [];
  canvas.tokens.placeables = tokens.map(t => ({ document: t.document, isOwner: game.user.isGM || t.owners === id }));
  for (const k in media) delete media[k];
  Hooks.callAll("canvasReady", canvas);
}

// --- GM client: default narrator mode
becomeUser("gm"); Hooks.callAll("renderCameraViews"); await tick();
expect("GM hears Alice by default", media.p1.volume, 0.64);
expect("GM hears Bob by default", media.p2.volume, 0.64);
console.log("     GM buttons attached:", gmControls.kids?.length === 2, "listen active:", gmControls.kids?.[0].classList.active);
// GM opts into proximity listening (by clicking the real button) and selects a far-away monster
const [listenButton, speakButton] = gmControls.kids;
await click(listenButton);
console.log("     listen button now inactive:", listenButton.classList.active === false, "notice:", notices.at(-1));
canvas.tokens.controlled = [{ document: tokens[2].document, isOwner: true }]; Hooks.callAll("controlToken"); await tick();
await new Promise(r => setTimeout(r, 300));
{ const ok = JSON.stringify(users[0].flags.selected_tokens) === JSON.stringify([tokens[2].document.uuid]); if (!ok) fails++; console.log((ok ? "ok  " : "FAIL") + " GM selection is shared through the selected_tokens flag: " + JSON.stringify(users[0].flags.selected_tokens)); }
expect("GM (proximity, far monster) hears Alice", media.p1.volume, 0);
canvas.tokens.controlled = []; Hooks.callAll("controlToken"); await tick();
await new Promise(r => setTimeout(r, 300));// let the deselection be shared before this process switches users
expect("GM (proximity, nothing selected, speaks through nothing) hears nobody", media.p1.volume, 0);
// GM speaks through a token parked next to Alice, nothing selected: listens through that token
const setUserlist = (t, list) => { t.document.flags["proximity-voice-chat"].userlist = list; Hooks.callAll("updateToken", t.document, { flags: { "proximity-voice-chat": { userlist: list } } }); };
tokens[2].document.x = 0; tokens[2].document._source.x = 0;
setUserlist(tokens[2], "User.gm"); await tick();
expect("GM (proximity, nothing selected) hears Alice through the token they speak through", media.p1.volume, 0.64);
expect("GM (proximity, nothing selected) hears Bob at 5 tiles through that token", media.p2.volume, 0.64 * ((Math.cos(Math.PI * 500 / 1200) + 1) / 2) ** 2);
await click(listenButton);
expect("GM hears Bob again after re-enabling global listening", media.p2.volume, 0.64);
await click(speakButton);
console.log("     speak flag after click:", users[0].flags.global_speaker, "notice:", notices.at(-1));
await click(speakButton);
setUserlist(tokens[2], "User.gm");

// --- Alice's client
becomeUser("p1"); await tick();
expect("Alice hears GM (global speaker default)", media.gm.volume, 0.64);
const bobAtDist500 = (Math.cos(Math.PI * 500 / 1200) + 1) / 2;
expect("Alice hears Bob at 5 tiles", media.p2.volume, 0.64 * bobAtDist500 ** 2);
// GM turns global speak off -> Alice's client gets updateUser
users[0].flags.global_speaker = false; Hooks.callAll("updateUser", users[0], { flags: { "proximity-voice-chat": { global_speaker: false } } }); await tick();
expect("Alice hears GM (global speak off) through the GM's token next to her", media.gm.volume, 0.64);
setUserlist(tokens[2], ""); await tick();
expect("Alice hears GM after GM disables global speak and has no token", media.gm.volume, 0);
// the GM selects that token on their client; the shared selection makes them speak through it
users[0].flags.selected_tokens = [tokens[2].document.uuid];
Hooks.callAll("updateUser", users[0], { flags: { "proximity-voice-chat": { selected_tokens: users[0].flags.selected_tokens } } }); await tick();
expect("Alice hears GM through the token the GM has selected", media.gm.volume, 0.64);
users[0].flags.selected_tokens = [];
Hooks.callAll("updateUser", users[0], { flags: { "proximity-voice-chat": { selected_tokens: [] } } }); await tick();
expect("Alice stops hearing GM once the GM deselects it", media.gm.volume, 0);
// Bob walks out of range (simulate animation frame)
tokens[1].document.x = 3000; Hooks.callAll("refreshToken", { document: tokens[1].document, isOwner: false }, { refreshPosition: true }); await tick();
expect("Alice hears Bob after he walks away", media.p2.volume, 0);
// paused element gets resumed when volume returns
media.p2.paused = true; tokens[1].document.x = 0; Hooks.callAll("refreshToken", { document: tokens[1].document, isOwner: false }, { refreshPosition: true }); await tick();
expect("Alice hears Bob next to her", media.p2.volume, 0.64);
console.log("     paused element resumed:", media.p2.plays === 1);
// background tab: animated doc position stale, _source has destination
document.hidden = true; tokens[1].document.x = 0; tokens[1].document._source.x = 3000;
Hooks.callAll("canvasReady", canvas); await tick();
expect("hidden tab uses Bob's real destination", media.p2.volume, 0);
document.hidden = false;
// userlist removed via flag update
tokens[1].document.flags["proximity-voice-chat"].userlist = ""; Hooks.callAll("updateToken", tokens[1].document, { flags: { "proximity-voice-chat": { userlist: "" } } }); await tick();
const rows = game.modules.get("proximity-voice-chat").api.diagnose();
console.log(fails ? fails + " FAILURES" : "ALL PASSED");
process.exit(fails ? 1 : 0);

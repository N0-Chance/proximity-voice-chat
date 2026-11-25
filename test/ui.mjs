// Run with: node test/ui.mjs
// Drives the voice UI (scripts/voice-ui.js) through Foundry's hooks with a tiny fake DOM and fake PIXI, as
// Alice (a player) and then as the GM.

// --- a tiny DOM: elements with classes, dataset, children, and single compound selectors like li.a[data-x="y"]
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.style = {};
    this.classList = {
      add: (...c) => { const s = new Set(this._classes()); c.forEach(x => s.add(x)); this.className = [...s].join(" "); },
      remove: (...c) => { this.className = this._classes().filter(x => !c.includes(x)).join(" "); },
      contains: c => this._classes().includes(c),
      toggle: (c, force) => { const on = force ?? !this.classList.contains(c); on ? this.classList.add(c) : this.classList.remove(c); return on; }
    };
  }
  _classes() { return this.className.split(/\s+/).filter(Boolean); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const inner = this.children.length ? this.children.map(c => c.outerHTML).join("") : escapeText(this.textContent ?? "");
    return "<" + tag + (this.className ? ' class="' + this.className + '"' : "") + ">" + inner + "</" + tag + ">";
  }
  appendChild(k) { this.append(k); return k; }
  after(k) { const p = this.parentElement; const i = p.children.indexOf(this); k.parentElement = p; p.children.splice(i + 1, 0, k); }
  remove() { const p = this.parentElement; if (p) p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatchEvent(event) { (this.dispatched ??= []).push(event.type); }
  async dispatch(type, event = {}) { for (const fn of this.listeners[type] ?? []) await fn({ preventDefault() {}, stopPropagation() {}, target: this, ...event }); }
  _matches(sel) {
    const m = sel.match(/^([a-z]+)?(#[\w-]+)?((?:\.[\w-]+)*)((?:\[[\w-]+="[^"]*"\])*)$/i);
    if (!m) throw new Error("unsupported selector " + sel);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && this.attrs.id !== m[2].slice(1)) return false;
    m.splice(2, 1);
    for (const c of (m[2].match(/\.[\w-]+/g) ?? [])) if (!this.classList.contains(c.slice(1))) return false;
    for (const a of (m[3].match(/\[[\w-]+="[^"]*"\]/g) ?? [])) {
      const [, key, value] = a.match(/\[([\w-]+)="([^"]*)"\]/);
      const actual = key.startsWith("data-") ? this.dataset[key.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] : this.attrs[key];
      if (actual !== value) return false;
    }
    return true;
  }
  querySelectorAll(sel) { const out = []; const walk = e => { for (const c of e.children) { if (!(c instanceof El)) continue; if (c._matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const escapeText = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const allText = e => (e.children?.length ? e.children.map(allText).join(" ") : (e.textContent ?? ""));
const bodyClasses = new El("body");
globalThis.document = { hidden: false, createElement: t => new El(t), addEventListener() {}, querySelector: () => null, body: bodyClasses,
  createTextNode: text => ({ textContent: text, outerHTML: escapeText(text), children: [] }) };

// --- fake PIXI
class Container {
  constructor() {
    this.children = []; this.parent = null; this.destroyed = false; this.alpha = 1;
    this.position = { set: (x, y) => { this.x = x; this.y = y; } };
    this.scale = { set: v => { this.scaleValue = v; } };
  }
  addChild(c) { c.parent = this; this.children.push(c); return c; }
  destroy() { this.destroyed = true; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
class Graphics extends Container {
  lineStyle(o) { this.line = o; return this; }
  beginFill(c) { this.fill = c; (this.fills ??= []).push(c); return this; }
  endFill() { return this; }
  drawCircle(x, y, r) { (this.circles ??= []).push({ x, y, r }); return this; }
  drawPolygon(points) { (this.polygons ??= []).push(points); return this; }
  moveTo(x, y) { this.pen = { x, y }; return this; }
  lineTo(x, y) { this.pen = { x, y }; return this; }
  // like PIXI 7: an arc in the current line style and fill
  arc(x, y, r, start, end) { (this.arcs ??= []).push({ x, y, r, start, end, color: this.line?.color, width: this.line?.width, fill: this.fill }); return this; }
}
class Sprite extends Container {
  constructor(t) { super(); this.texture = t; this.anchor = { set() {} }; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; }
}
class Text extends Container {
  constructor(text, style) { super(); this.text = text; this.style = style; this.anchor = { set() {} }; }
}
globalThis.PIXI = { Container, Graphics, Sprite, Text };

// --- a fake <audio> element for the join and leave chimes: records what it was asked to play, and where
const chimes = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; this.volume = 1; this.sinkId = ""; }
  async setSinkId(id) { this.sinkId = id; }
  async play() { chimes.push(this); }
};

// --- a browser with Web Audio, already clicked in; the voice path itself is covered by test/audio.mjs
const { FakeAudioContext } = await import("./fake-audio.mjs");
FakeAudioContext.startState = "running";
globalThis.AudioContext = FakeAudioContext;

// --- Foundry stubs
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
const hooks = {};
// like Foundry: once() handlers run a single time
globalThis.Hooks = {
  on: (n, f) => (hooks[n] ??= []).push(f),
  once: (n, f) => { const w = (...a) => { hooks[n] = hooks[n].filter(x => x !== w); return f(...a); }; (hooks[n] ??= []).push(w); },
  callAll: (n, ...a) => [...(hooks[n] ?? [])].forEach(f => f(...a))
};
const intervals = [];
globalThis.setInterval = fn => (intervals.push(fn), 0);
let now = 1000;
Date.now = () => now;
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { footer: {} } });
class PointSoundSource {
  constructor() { this.data = {}; }
  initialize(d) { Object.assign(this.data, d); this.shape = { points: [this.data.x, this.data.y, this.data.x + this.data.radius, this.data.y] }; }
  getVolumeMultiplier(l) { const d = Math.hypot(l.x - this.data.x, l.y - this.data.y); return d > this.data.radius ? 0 : (Math.cos(Math.PI * d / this.data.radius) + 1) / 2; }
}
const dialogs = [];
class DialogV2 {
  constructor(o) { this.options = o; dialogs.push(this); }
  async render() { this.element = new El("div"); const input = new El("input"); input.className = "pvc-volume"; this.element.append(input); return this; }
}
const humanizeBinding = b => [...(b.modifiers ?? []), b.key].join(" + ");
const windows = [];
class FakeApplicationV2 {
  constructor(options = {}) { this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options }; windows.push(this); }
  async _prepareContext() { return {}; }
  async render() {
    const context = await this._prepareContext({});
    this.content ??= new El("section");
    this._replaceHTML(await this._renderHTML(context, {}), this.content, {});
    this.rendered = true;
    // like Foundry: after each render, then on closing
    this._onRender?.(context, {});
    return this;
  }
  async close() { this._onClose?.({}); this.closed = true; }
  async click(action) { await this.options.actions[action].call(this, {}, null); }
}
const menus = new Map();
const settingConfigs = {};
const created = [];
const copied = [];
globalThis.ChatMessage = { implementation: { create: async data => (created.push(data), data), getWhisperRecipients: () => users.filter(u => u.isGM) } };
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() }, api: { DialogV2, ApplicationV2: FakeApplicationV2 },
    sidebar: { apps: { ControlsConfig: { humanizeBinding } } } },
  canvas: { sources: { PointSoundSource }, loadTexture: async () => ({ fake: "texture" }) },
  av: { AVSettings: { AV_MODES: { DISABLED: 0, AUDIO: 1, VIDEO: 2, AUDIO_VIDEO: 3 } } },
  audio: { AudioHelper: { volumeToInput: v => Math.sqrt(v), inputToVolume: v => v * v } },
};
const settings = {};
const mkUser = (id, name, isGM, color) => ({ id, name, isGM, color, uuid: "User." + id, active: true, isSelf: false, flags: {},
  getFlag(m, k) { return this.flags[k]; }, async setFlag(m, k, v) { this.flags[k] = v; Hooks.callAll("updateUser", this, { flags: { [m]: { [k]: v } } }); },
  async update(d) { this.updates = (this.updates ?? []).concat(d); } });
const users = [mkUser("gm", "GM", true, 0xff0000), mkUser("p1", "Alice", false, 0x00ff00), mkUser("p2", "Bob", false, 0x0000ff)];
const mkToken = (id, x, y, userlist, owner) => {
  const doc = { id, name: id, uuid: "Scene.s.Token." + id, x, y, elevation: 0, level: "L1", _source: { x, y, elevation: 0 }, parent: null, flags: { "proximity-voice-chat": { userlist } },
    getFlag(m, k) { return this.flags[m]?.[k]; }, getSoundOrigin(d = {}) { return { x: (d.x ?? this.x) + 50, y: (d.y ?? this.y) + 50, elevation: 0 }; },
    getListenerPosition(d = {}) { return this.getSoundOrigin(d); } };
  const placeable = Object.assign(new Container(), { document: doc, owner, w: 100, h: 100 });
  return placeable;
};
const tokens = [mkToken("alice", 0, 0, "User.p1", "p1"), mkToken("bob", 300, 0, "User.p2", "p2")];
const scene = { tokens: tokens.map(t => t.document), grid: { size: 100 }, flags: {}, getFlag(m, k) { return this.flags[k]; } };
tokens.forEach(t => t.document.parent = scene);
const liveTrack = () => ({ kind: "audio", enabled: true, readyState: "live", muted: false });
const streams = { p1: { id: "s1", getAudioTracks: () => [liveTrack()] }, p2: { id: "s2", getAudioTracks: () => [liveTrack()] }, gm: { id: "sg", getAudioTracks: () => [liveTrack()] } };
const levelReports = new Map();
let levelReportsWork = true;
const media = {};
const rtc = {
  world: { mode: 1 }, client: { users: {}, muteAll: false, voice: { activityThreshold: -45 } }, activity: {},
  getUser: id => ({ volume: rtc.client.users[id]?.volume ?? 1, muted: !!rtc.client.users[id]?.muted, blocked: !!rtc.client.users[id]?.blocked,
    canBroadcastAudio: !users.find(u => u.id === id)?.blockedAudio }),
  set: async (scope, key, value) => {
    const path = key.split("."); let o = rtc[scope];
    for (const p of path.slice(0, -1)) o = o[p] ??= {};
    o[path.at(-1)] = value;
    Hooks.callAll("rtcSettingsChanged", rtc, {});
  }
};
let configOpened = 0;
const keybindings = new Map();
const bound = {};
globalThis.game = {
  version: "14.369",
  modules: new Map([["proximity-voice-chat", { version: "1.2.3", active: true }]]),
  // like Foundry: set() runs the setting's onChange
  settings: { register: (m, k, c) => { settings[k] ??= c.default; settingConfigs[k] = c; }, get: (m, k) => settings[k],
    set: async (m, k, v) => { settings[k] = v; settingConfigs[k]?.onChange?.(v); }, registerMenu: (m, k, data) => menus.set(k, data) },
  clipboard: { copyPlainText: async text => copied.push(text) },
  i18n: { localize: s => s, format: (s, d) => s + " " + JSON.stringify(d) },
  socket: { on: (n, fn) => socketHandlers.push(fn), emit: (n, data) => emitted.push(data) },
  users: Object.assign(users, { get: id => users.find(u => u.id === id) }),
  webrtc: { settings: rtc, broadcasting: true, config: { render: () => configOpened++ },
    client: { getMediaStreamForUser: id => streams[id] ?? null, getLevelsStreamForUser: id => streams[id] ?? null } },
  keybindings: {
    register: (ns, action, data) => keybindings.set(action, data),
    get: (ns, action) => bound[action] ?? []
  },
  audio: {
    startLevelReports: (id, stream, cb) => { if (!levelReportsWork) return false; levelReports.set(id, { stream, cb }); return true; },
    stopLevelReports: id => levelReports.delete(id)
  },
};
const tickers = new Set();
const socketHandlers = [];
const emitted = [];
const receive = message => socketHandlers.forEach(fn => fn(message));
globalThis.canvas = { interface: new Container(), ready: true, scene, level: { id: "L1" }, tokens: { controlled: [], ownedTokens: [], placeables: tokens }, app: { ticker: { add: f => tickers.add(f), remove: f => tickers.delete(f) } } };
const notices = [];
globalThis.ui = { webrtc: { render() {}, getUserVideoElement: id => media[id] ??= { volume: 1, paused: false, play() {} } }, notifications: { info: m => notices.push(m), warn: m => notices.push("WARN " + m), error: m => notices.push("ERROR " + m) } };
globalThis.fromUuid = async () => null;

const mainScript = process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href;
await import(mainScript);
const { self_issues } = await import(new URL("./diagnostics.js", mainScript.startsWith("file:") ? mainScript : "file://" + mainScript).href);
Hooks.callAll("init"); Hooks.callAll("i18nInit");
await new Promise(r => setTimeout(r, 0));

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + label + (detail ? "  [" + detail + "]" : "")); };
const tick = () => new Promise(r => setTimeout(r, 5));
const runIntervals = async () => { intervals.forEach(fn => fn()); await tick(); };

/** builds a fake players list shaped like v14's templates/ui/players.hbs and renders it through the hook */
function renderPlayers() {
  const element = new El("aside");
  element.attrs.id = "players";
  const inactive = new El("ol"); inactive.className = "players-list"; inactive.attrs.id = "players-inactive";
  const active = new El("ol"); active.className = "players-list"; active.attrs.id = "players-active";
  for (const u of users) { const li = new El("li"); li.className = "player"; li.dataset.userId = u.id; active.append(li); }
  element.append(inactive, active);
  ui.players = { element };
  Hooks.callAll("renderPlayers", ui.players, element, {}, {});
  return element;
}
const row = id => ui.players.element.querySelector(`li.player[data-user-id="${id}"]`);
/** delivers a change to a user's record as Foundry's server would: the hook's last argument is who wrote it */
const deliverUserUpdate = (user, flags, author) => {
  user.flags = { ...user.flags, ...flags };
  Hooks.callAll("updateUser", user, { flags: { "proximity-voice-chat": flags } }, {}, author);
};
const indicatorOn = token => token.children.find(c => c.pvcStyle && !c.destroyed);
const speak = async (id, db) => { levelReports.get("proximity-voice-chat." + id)?.cb(db); await tick(); };

function becomeUser(id) {
  users.forEach(u => u.isSelf = u.id === id);
  game.user = game.users.get(id);
  game.userId = id;
  canvas.tokens.ownedTokens = tokens.filter(t => game.user.isGM || t.owner === id);
  canvas.tokens.controlled = [];
  Hooks.callAll("canvasReady", canvas);
}

// ===== Alice's client
becomeUser("p1");
Hooks.callAll("ready");
await tick();
renderPlayers();
await runIntervals();

// --- join and leave alerts: nobody already in voice is announced when you load
const alertNotices = () => notices.filter(n => /JoinedVoice|LeftVoice/.test(n));
check("loading the page doesn't announce the people already in voice", alertNotices().length === 0 && chimes.length === 0, JSON.stringify(alertNotices()));

// --- dock
check("dock hidden by default (world setting on)", bodyClasses.classList.contains("pvc-hide-dock"));
await game.settings.set("proximity-voice-chat", "showCameraDock", true); await tick();
check("player override 'show dock anyway' brings it back", !bodyClasses.classList.contains("pvc-hide-dock"));
await game.settings.set("proximity-voice-chat", "showCameraDock", false); await tick();

// --- speaking detection and cues
check("level reports started for every active user", ["gm", "p1", "p2"].every(id => levelReports.has("proximity-voice-chat." + id)));
await speak("p2", -20);
check("Bob speaking (3 tiles away): his row glows", row("p2").classList.contains("pvc-speaking"));
check("Bob speaking: his row is not dimmed (audible)", !row("p2").classList.contains("pvc-inaudible"));
check("Bob speaking: ring on Bob's token", indicatorOn(tokens[1])?.pvcStyle === "ring");
check("ring uses Bob's colour", indicatorOn(tokens[1])?.children[0]?.line?.color === 0x0000ff);
check("pulse animation registered", tickers.size === 1);
now += 200; await speak("p2", -80);
check("Bob still 'speaking' within the 400ms hold", row("p2").classList.contains("pvc-speaking"));
now += 500; await speak("p2", -80);
check("Bob stops speaking after the hold", !row("p2").classList.contains("pvc-speaking") && !indicatorOn(tokens[1]));
check("pulse animation removed when nobody speaks", tickers.size === 0);

// out of earshot: Bob walks away
tokens[1].document.x = 5000; tokens[1].document._source.x = 5000;
Hooks.callAll("refreshToken", tokens[1], { refreshPosition: true }); await tick();
await speak("p2", -20);
check("Bob out of earshot: row shows speaking but dimmed", row("p2").classList.contains("pvc-speaking") && row("p2").classList.contains("pvc-inaudible"));
check("Bob out of earshot: the row shows the 'lips moving' speech bubble", row("p2").querySelector(".pvc-speaking-icon").className.includes("fa-comment-dots"));
const unheard = indicatorOn(tokens[1]);
check("Bob out of earshot: a thin ring on his token, in his colour", unheard?.pvcStyle === "ring" && unheard.pvcHeard === false
  && unheard.children[0]?.line?.color === 0x0000ff && unheard.children[0].line.width < 3, JSON.stringify(unheard?.children[0]?.line));
check("...without a ripple, and pulsing fainter than heard speech", !unheard?.children.some(c => c.pvcRipple) && unheard?.pvcPulse?.base < 0.6);
settings.speakingIndicatorOverride = "badge"; Hooks.callAll("drawToken"); await tick();
check("Bob out of earshot, badge style: a speech bubble with dots", indicatorOn(tokens[1])?.children.some(c => c.text === "\uf4ad"));
settings.speakingIndicatorOverride = "icon"; Hooks.callAll("drawToken"); await tick();
check("Bob out of earshot, icon style: a speech bubble with dots", indicatorOn(tokens[1])?.children.some(c => c.text === "\uf4ad"));
settings.speakingIndicatorOverride = "default"; Hooks.callAll("drawToken"); await tick();
// he walks back while still talking
tokens[1].document.x = 300; tokens[1].document._source.x = 300;
Hooks.callAll("refreshToken", tokens[1], { refreshPosition: true }); await runIntervals(); await speak("p2", -20);
await runIntervals();// cues catch up with volumes on the UI's one-second tick
check("Bob walks back into earshot: his cue turns into the full ring", indicatorOn(tokens[1])?.pvcHeard === true && indicatorOn(tokens[1]).children[0].line.width >= 3
  && !row("p2").classList.contains("pvc-inaudible"));
now += 1000; await speak("p2", -80);
tokens[1].document.x = 300; tokens[1].document._source.x = 300;
Hooks.callAll("refreshToken", tokens[1], { refreshPosition: true }); await tick();

// styles: personal override
settings.speakingIndicatorOverride = "badge"; await speak("p2", -20); Hooks.callAll("drawToken"); await tick();
check("personal override 'badge' draws a badge", indicatorOn(tokens[1])?.pvcStyle === "badge");
settings.speakingIndicatorOverride = "icon"; Hooks.callAll("drawToken"); await tick();
check("switching to 'icon' replaces the badge", indicatorOn(tokens[1])?.pvcStyle === "icon" && tokens[1].children.filter(c => !c.destroyed).length === 1);
settings.speakingIndicatorOverride = "none"; Hooks.callAll("drawToken"); await tick();
check("'off' shows no token cue", !indicatorOn(tokens[1]));
check("'off' still shows the players-list cue", row("p2").classList.contains("pvc-speaking"));
settings.speakingIndicatorOverride = "default";
now += 1000; await speak("p2", -80);

// speaking cue threshold (client setting, independent of Foundry's voice-activation threshold)
rtc.client.voice.activityThreshold = -10;// would hide every cue if it were still used
await speak("p2", -40);
check("default -45 dB threshold: -40 dB counts as speaking, ignoring Foundry's voice-activation threshold", row("p2").classList.contains("pvc-speaking"));
now += 1000; await speak("p2", -80);
settings.speakingThreshold = -30;
await speak("p2", -40);
check("raised to -30 dB: -40 dB no longer counts", !row("p2").classList.contains("pvc-speaking"));
await speak("p2", -25);
check("raised to -30 dB: -25 dB still counts", row("p2").classList.contains("pvc-speaking"));
now += 1000; await speak("p2", -80);
settings.speakingThreshold = -45; rtc.client.voice.activityThreshold = -45;

// someone whose microphone cleanup is on: their cue follows what's actually sent, not the threshold
check("a browser that has just loaded asks whose microphone is cleaned up", emitted.some(m => m.action === "mic-cleanup-request"));
receive({ action: "mic-cleanup", from: "p2", active: true });
await speak("p2", -95);
check("Bob's microphone is cleaned up: any sound arriving from him shows his cue, below the threshold too", row("p2").classList.contains("pvc-speaking"));
now += 100; await speak("p2", -140);
check("...it stays through the gap between two level readings", row("p2").classList.contains("pvc-speaking"));
now += 100; await speak("p2", -140);
check("...and the silence his gate sends clears it within a fifth of a second", !row("p2").classList.contains("pvc-speaking"));
receive({ action: "mic-cleanup", from: "p2", active: false });
now += 1000; await speak("p2", -95);
check("his cleanup off again: the threshold applies again", !row("p2").classList.contains("pvc-speaking"));
receive({ action: "mic-cleanup", from: "p2", active: true });
Hooks.callAll("userConnected", game.users.get("p2"), false); Hooks.callAll("userConnected", game.users.get("p2"), true);
now += 1000; await speak("p2", -95);
check("someone who leaves is forgotten until their browser says so again", !row("p2").classList.contains("pvc-speaking"));
now += 1000; await speak("p2", -140);

// own voice only counts while transmitting
await speak("p1", -20);
check("your own voice shows on your token while transmitting", indicatorOn(tokens[0])?.pvcStyle === "ring");
now += 1000; await speak("p1", -80);
game.webrtc.broadcasting = false; await speak("p1", -20);
check("your own voice is ignored while not transmitting (push-to-talk released)", !row("p1").classList.contains("pvc-speaking"));
game.webrtc.broadcasting = true; now += 1000; await speak("p1", -80);

// fallback when audio levels can't be measured
levelReportsWork = false; streams.p2 = { id: "s2b", getAudioTracks: () => [{}] };
rtc.activity.p2 = { speaking: true };
await runIntervals();
check("fallback to Foundry's speaking signal when levels can't be measured", row("p2").classList.contains("pvc-speaking"));
rtc.activity.p2 = { speaking: false }; await runIntervals();
levelReportsWork = true; streams.p2 = { id: "s2c", getAudioTracks: () => [{}] }; await runIntervals();

// --- voice bar (player)
const bar = ui.players.element.querySelector(".pvc-voice-bar");
const activeBox = ui.players.element.querySelector("#players-active");
check("voice bar is the last row of the active players box, not the inactive one", !!bar && activeBox.children.at(-1) === bar && !ui.players.element.querySelector("#players-inactive").children.includes(bar));
check("voice bar is a list item inside that list", bar.tagName === "LI");
const actions = bar.children.map(b => b.dataset.pvcAction).join(",");
check("player bar has mic, voice mode, deafen, settings, mic setup only", actions === "mic,mode,deafen,settings,micSetup", actions);
const button = a => bar.querySelector(`button[data-pvc-action="${a}"]`);
check("mic button shows active (unmuted)", button("mic").classList.contains("active"));
await button("mic").dispatch("click");
check("clicking mic mutes you", rtc.client.users.p1?.muted === true);
check("mic icon switches to slashed", button("mic").querySelector("i").className.includes("fa-microphone-slash"));
await button("mic").dispatch("click");
await button("deafen").dispatch("click"); await runIntervals();
check("deafen sets muteAll", rtc.client.muteAll === true);
check("deafen silences everyone (module applies it; core's is broken)", media.p2?.volume === 0 && media.gm?.volume === 0, JSON.stringify({ p2: media.p2?.volume, gm: media.gm?.volume }));
await button("deafen").dispatch("click"); await runIntervals();
check("undeafen restores volumes", media.gm?.volume === 1, String(media.gm?.volume));
await button("settings").dispatch("click");
check("settings button opens Foundry's A/V config", configOpened === 1);

// --- Mic Setup: the microphone cleanup's settings, from the voice bar
{
  const before = windows.length;
  await button("micSetup").dispatch("click"); await tick();
  const win = windows[before];
  check("the Mic Setup button opens Mic Setup", win?.constructor?.name === "MicSetup" && !!win.rendered, win?.constructor?.name);
  check("...which is also a settings menu button everyone can use", menus.get("micSetup")?.restricted === false && menus.get("micSetup")?.type === win?.constructor);
  const text = allText(win.content);
  check("...says in words what the cleanup is doing", /proximity-voice-chat\.MicSetup\.Status\.\w/.test(text), text.slice(0, 160));
  check("...offers the GM's default, on, and off", win.content.querySelectorAll("option").map(o => o.value).join(",") === "default,on,off");
  const boxes = () => win.content.querySelectorAll("input").filter(i => i.type === "checkbox");
  const slider = () => win.content.querySelectorAll("input").find(i => i.type === "range");
  check("...a noise filter and an automatic gate, both on", boxes().length === 2 && boxes().every(b => b.checked));
  check("...and a strictness slider from Relaxed to Strict", slider()?.min === "1" && slider()?.max === "5" && slider()?.value === "3");
  slider().value = "4"; await slider().dispatch("change");
  check("moving the slider saves the strictness", settings.micStrictness === 4);
  boxes()[1].checked = false; await boxes()[1].dispatch("change"); await tick();
  check("unticking Automatic turns the slider into a loudness threshold in dB", settings.micGateAuto === false && slider()?.min === "-70" && slider()?.value === "-45");
  const meter = win.content.querySelector(".pvc-mic-meter-marker");
  check("...whose line sits on the meter where the threshold is", meter?.style.left === "43.75%", meter?.style.left);
  boxes()[1].checked = true; await boxes()[1].dispatch("change"); await tick();
  await game.settings.set("proximity-voice-chat", "micStrictness", 3);
  const hear = win.content.querySelectorAll("button").find(b => allText(b).includes("MicSetup.Hear"));
  check("Hear Yourself is greyed out while the cleanup isn't running", hear?.disabled === true);
  await win.close();
}

// --- hotkeys
check("seven hotkeys registered, unbound by default", keybindings.size === 7 && [...keybindings.values()].every(k => k.editable.length === 0), [...keybindings.keys()].join(","));
check("Global Listen/Speak hotkeys are GM-only", keybindings.get("toggleGlobalListen").restricted && keybindings.get("toggleGlobalSpeak").restricted && !keybindings.get("toggleMic").restricted);
check("tooltip without a binding is just the label", button("mic").dataset.tooltip === "proximity-voice-chat.UI.Mic", button("mic").dataset.tooltip);
bound.toggleMic = [{ key: "KeyM", modifiers: ["Control"] }];
await runIntervals();
check("tooltip shows the bound hotkey once it's set", button("mic").dataset.tooltip === "proximity-voice-chat.UI.Mic (Control + KeyM)", button("mic").dataset.tooltip);
check("hotkey handler reports it handled the key", keybindings.get("toggleMic").onDown() === true);
await tick();
check("mic hotkey mutes you and updates the button", rtc.client.users.p1?.muted === true && !button("mic").classList.contains("active"));
keybindings.get("toggleMic").onDown(); await tick();
check("pressing it again unmutes", rtc.client.users.p1?.muted === false);
keybindings.get("toggleDeafen").onDown(); await tick();
check("deafen hotkey toggles deafen", rtc.client.muteAll === true);
keybindings.get("toggleDeafen").onDown(); await tick();

// --- voice modes
const modeButton = () => bar.querySelector('button[data-pvc-action="mode"]');
check("mode button sits next to the mic", bar.children.map(b => b.dataset.pvcAction).slice(0, 3).join(",") === "mic,mode,deafen");
await modeButton().dispatch("click"); await tick();
const api = game.modules.get("proximity-voice-chat").api;
check("clicking the mode button switches to Whisper", api.get_voice_mode(users[1]) === "whisper");
check("the change is announced to everyone", JSON.stringify(emitted.at(-1)) === JSON.stringify({ action: "voice-mode", from: "p1", mode: "whisper" }));
check("the mode button turns blue with the shush icon", modeButton().classList.contains("pvc-mode-whisper") && modeButton().querySelector("i").className.includes("fa-face-shush"));
check("your own row shows a persistent Whisper tag", row("p1").querySelector(".pvc-mode-tag")?.className.includes("pvc-mode-whisper"));
const preview = canvas.interface.children.at(-1);
check("switching shows your reach on your token, walls included", preview?.polygons?.length === 1 && preview.polygons[0][2] - preview.polygons[0][0] === 300, JSON.stringify(preview?.polygons));
check("...and a fainter circle for how far it can carry through and round walls", preview?.circles?.length === 1 && preview.circles[0].r === 300 && preview.circles[0].x === 50 && preview.line.alpha < 0.9, JSON.stringify(preview?.circles));
settings.soundPropagation = false; await modeButton().dispatch("click"); await modeButton().dispatch("click"); await modeButton().dispatch("click"); await tick();
check("with sound propagation off there's no circle: walls are the limit", !canvas.interface.children.at(-1).circles?.length && canvas.interface.children.at(-1).polygons.length === 1);
settings.soundPropagation = true;
await modeButton().dispatch("click"); await tick();
check("clicking again switches to Yell (orange, megaphone)", api.get_voice_mode(users[1]) === "yell" && modeButton().classList.contains("pvc-mode-yell") && modeButton().querySelector("i").className.includes("fa-megaphone"));
check("the reach preview follows the new range", canvas.interface.children.at(-1).polygons[0][2] - canvas.interface.children.at(-1).polygons[0][0] === 2400);
check("only one reach preview at a time", canvas.interface.children.filter(c => !c.destroyed).length === 1);
await modeButton().dispatch("contextmenu"); await tick();
check("right-click returns to Normal and clears the tag", api.get_voice_mode(users[1]) === "normal" && !row("p1").querySelector(".pvc-mode-tag"));
check("tooltip names the current mode", modeButton().dataset.tooltip.includes("proximity-voice-chat.UI.Mode.normal"), modeButton().dataset.tooltip);

// hotkeys: tap to switch and stay, tap again for Normal, hold to switch back on release
const whisperKey = keybindings.get("whisper");
check("Whisper and Yell hotkeys registered, unbound, with key-up handlers", !!whisperKey && !!keybindings.get("yell") && whisperKey.editable.length === 0 && typeof whisperKey.onUp === "function");
whisperKey.onDown(); now += 100; whisperKey.onUp(); await tick();
check("tapping Whisper switches and stays", api.get_voice_mode(users[1]) === "whisper");
whisperKey.onDown(); now += 100; whisperKey.onUp(); await tick();
check("tapping it again goes back to Normal", api.get_voice_mode(users[1]) === "normal");
const previews = canvas.interface.children.length;
keybindings.get("yell").onDown(); await tick();
check("holding Yell yells", api.get_voice_mode(users[1]) === "yell");
now += 600; keybindings.get("yell").onUp(); await tick();
check("releasing after a hold goes back to the previous mode", api.get_voice_mode(users[1]) === "normal");
check("the switch back doesn't flash the reach again", canvas.interface.children.filter(c => !c.destroyed).length <= 1 && canvas.interface.children.length <= previews + 1);

// others' modes arrive over the socket; a whisper you can't hear stays private
receive({ action: "voice-mode", from: "p2", mode: "whisper" }); await tick();
check("Bob's mode arrives over the socket", api.get_voice_mode(users[2]) === "whisper");
await runIntervals();
await speak("p2", -20);
check("Bob whispering 3 tiles away (reach 3 tiles) is silent for Alice", media.p2.volume === 0, String(media.p2.volume));
check("...and shows no cue at all in the players list", !row("p2").classList.contains("pvc-speaking"));
check("...but his token, in view, shows the faint 'can't hear' ring", indicatorOn(tokens[1])?.pvcHeard === false && indicatorOn(tokens[1]).children[0]?.line?.width < 3);
check("...which looks the same as any speech out of earshot: no dots giving the whisper away", indicatorOn(tokens[1])?.pvcMode === "normal" && indicatorOn(tokens[1]).children[0]?.circles?.length === 1);
now += 1000; await speak("p2", -80);
settings.whisperRange = 50; Hooks.callAll("canvasReady", canvas); await runIntervals();
await speak("p2", -20);
check("whisper range raised to 50%: Alice hears the whisper", media.p2.volume > 0);
check("audible whisper: row shows the quiet speaker icon", row("p2").classList.contains("pvc-speaking") && row("p2").querySelector(".pvc-speaking-icon").className.includes("fa-volume-low"));
check("audible whisper: dotted ring on his token", indicatorOn(tokens[1])?.pvcMode === "whisper" && indicatorOn(tokens[1]).children[0].circles?.length === 28);
receive({ action: "voice-mode", from: "p2", mode: "yell" }); await runIntervals(); await speak("p2", -20);
check("Bob yelling: megaphone in the list", row("p2").querySelector(".pvc-speaking-icon").className.includes("fa-megaphone"));
check("Bob yelling: thick ring plus a ripple", indicatorOn(tokens[1])?.pvcMode === "yell" && indicatorOn(tokens[1]).children.some(c => c.pvcRipple));
settings.speakingIndicatorOverride = "badge"; Hooks.callAll("drawToken"); await tick();
check("Bob yelling, badge style: megaphone glyph on a bigger badge", indicatorOn(tokens[1])?.children.some(c => c.text === "\uf675"));
settings.speakingIndicatorOverride = "icon"; Hooks.callAll("drawToken"); await tick();
check("Bob yelling, icon style: megaphone glyph in the icon font", indicatorOn(tokens[1])?.children.some(c => c.text === "\uf675" && c.style.fontFamily[0] === "Font Awesome 7 Pro"));
settings.speakingIndicatorOverride = "default"; settings.whisperRange = 25;
now += 1000; await speak("p2", -80);
receive({ action: "voice-mode", from: "p2", mode: "normal" }); await runIntervals();

// several people through one token: the GM selects Bob's token and talks while Bob does
deliverUserUpdate(users[0], { selected_tokens: [tokens[1].document.uuid] }, "gm"); await runIntervals();
await speak("p2", -20); await speak("gm", -20);
const shared = indicatorOn(tokens[1])?.children[0];
check("GM and Bob talking through Bob's token: a checkered ring in both colours, GM first as in the users list",
  shared?.arcs?.length === 24 && shared.arcs.every((a, i) => a.color === (i % 2 ? 0x0000ff : 0xff0000)) && !shared.circles?.length,
  JSON.stringify(shared?.arcs?.slice(0, 3)));
check("...with no gaps: the arcs go all the way round", Math.abs(shared?.arcs?.at(-1)?.end - shared?.arcs?.[0]?.start - Math.PI * 2) < 1e-9);
check("Alice's own token, with only her own speakers, is unaffected", !indicatorOn(tokens[0]));
settings.speakingIndicatorOverride = "badge"; Hooks.callAll("drawToken"); await tick();
const wedges = indicatorOn(tokens[1])?.children[0]?.arcs;
check("badge style, two speakers: one wedge each in their colours", wedges?.length === 2 && wedges[0].fill === 0xff0000 && wedges[1].fill === 0x0000ff, JSON.stringify(wedges));
settings.speakingIndicatorOverride = "icon"; Hooks.callAll("drawToken"); await tick();
const sharedIcon = indicatorOn(tokens[1]);
check("icon style, two speakers: a white glyph in a checkered rim", sharedIcon?.children.some(c => c.text && c.style.fill === 0xffffff)
  && sharedIcon.children[0].arcs?.length === 24);
settings.speakingIndicatorOverride = "default"; Hooks.callAll("drawToken"); await tick();
receive({ action: "voice-mode", from: "p2", mode: "yell" }); await runIntervals(); await speak("p2", -20); await speak("gm", -20);
const sharedYell = indicatorOn(tokens[1]);
check("one of them yelling: the shared cue takes the loudest mode, ripple checkered too", sharedYell?.pvcMode === "yell"
  && sharedYell.children.find(c => c.pvcRipple)?.arcs?.length === 24);
settings.whisperRange = 50; receive({ action: "voice-mode", from: "p2", mode: "whisper" }); receive({ action: "voice-mode", from: "gm", mode: "whisper" });
Hooks.callAll("canvasReady", canvas); await runIntervals(); await speak("p2", -20); await speak("gm", -20);
const dots = indicatorOn(tokens[1])?.children[0];
check("both whispering: the dots take turns between their colours", indicatorOn(tokens[1])?.pvcMode === "whisper" && dots?.circles?.length === 28
  && dots.fills?.every((c, i) => c === (i % 2 ? 0x0000ff : 0xff0000)), JSON.stringify(dots?.fills?.slice(0, 4)));
now += 1000; await speak("p2", -80); await speak("gm", -80);
check("when they stop, the shared cue goes", !indicatorOn(tokens[1]));
settings.whisperRange = 25;
receive({ action: "voice-mode", from: "p2", mode: "normal" }); receive({ action: "voice-mode", from: "gm", mode: "normal" });
deliverUserUpdate(users[0], { selected_tokens: [] }, "gm"); await runIntervals();

// --- join and leave alerts, once the first seconds after loading are over
{
  now += 20000;
  const bobStream = streams.p2;
  const reset = () => { notices.length = 0; chimes.length = 0; };
  const { chime_wav } = await import(new URL("./voice-ui.js", mainScript.startsWith("file:") ? mainScript : "file://" + mainScript).href);
  await runIntervals(); reset();
  // a replaced connection: Bob's audio drops for a few seconds and comes back
  delete streams.p2; await runIntervals();
  now += 5000; await runIntervals();
  streams.p2 = { ...bobStream, id: "s2r" }; await runIntervals();
  check("a voice that drops for a few seconds and comes back isn't announced", alertNotices().length === 0 && chimes.length === 0, JSON.stringify(alertNotices()));
  // his audio goes for good while he stays in Foundry
  delete streams.p2; await runIntervals();
  now += 10000; await runIntervals();
  check("...nor is one that's been gone for less than 15 seconds", alertNotices().length === 0);
  now += 6000; await runIntervals();
  check("gone for 15 seconds: 'Bob left voice' and a chime", alertNotices().length === 1 && alertNotices()[0].includes("LeftVoice") && alertNotices()[0].includes("Bob") && chimes.length === 1);
  const leaveSrc = chimes[0]?.src;
  reset();
  streams.p2 = { ...bobStream, id: "s2j" }; await runIntervals();
  check("Bob comes back: 'Bob joined voice' and a chime", alertNotices().length === 1 && alertNotices()[0].includes("JoinedVoice") && chimes.length === 1, JSON.stringify(alertNotices()));
  check("the join chime is a different sound from the leave chime", !!chimes[0]?.src && chimes[0].src !== leaveSrc);
  check("the chime plays at the default 50% volume", chimes[0]?.volume === 0.5);
  reset();
  // closing Foundry is announced at once
  users[2].active = false; Hooks.callAll("userConnected", users[2], false); await runIntervals();
  check("Bob closes Foundry: announced straight away", alertNotices().length === 1 && alertNotices()[0].includes("LeftVoice") && chimes.length === 1);
  now += 20000; await runIntervals();
  check("...and only once", alertNotices().length === 1 && chimes.length === 1);
  users[2].active = true; Hooks.callAll("userConnected", users[2], true); await runIntervals();
  check("Bob reconnects: announced as joining", alertNotices().length === 2 && alertNotices()[1].includes("JoinedVoice"));
  // the choices, the output device, the volume, and deafen
  const bobLeavesAndReturns = async () => {
    reset();
    users[2].active = false; Hooks.callAll("userConnected", users[2], false); await runIntervals();
    users[2].active = true; Hooks.callAll("userConnected", users[2], true); await runIntervals();
  };
  rtc.client.audioSink = "headphones-id"; settings.voiceAlertVolume = 80;
  await bobLeavesAndReturns();
  check("the chime goes to the output device chosen for voices, at the chosen volume", chimes.length === 2 && chimes.every(c => c.sinkId === "headphones-id" && c.volume === 0.8));
  rtc.client.audioSink = "default"; settings.voiceAlertVolume = 50;
  await bobLeavesAndReturns();
  check("Foundry's 'default' device is passed as the browser default", chimes.length === 2 && chimes.every(c => c.sinkId === ""));
  settings.voiceAlerts = "chime"; await bobLeavesAndReturns();
  check("'Chime only': chimes, no pop-ups", chimes.length === 2 && alertNotices().length === 0);
  settings.voiceAlerts = "popup"; await bobLeavesAndReturns();
  check("'Pop-up only': pop-ups, no chimes", chimes.length === 0 && alertNotices().length === 2);
  settings.voiceAlerts = "none"; await bobLeavesAndReturns();
  check("'Off': nothing", chimes.length === 0 && alertNotices().length === 0);
  settings.voiceAlerts = "all"; rtc.client.muteAll = true; await bobLeavesAndReturns();
  check("deafened: the pop-ups still show, but no chime", chimes.length === 0 && alertNotices().length === 2);
  rtc.client.muteAll = false; settings.voiceAlertVolume = 0; await bobLeavesAndReturns();
  check("chime volume 0: no chime", chimes.length === 0 && alertNotices().length === 2);
  settings.voiceAlertVolume = 50;
  // the chime itself
  const wav = chime_wav?.([660, 880]) ?? new Uint8Array(44);// before 2.1 there was no chime
  const ascii = (at, n) => String.fromCharCode(...wav.slice(at, at + n));
  const view = new DataView(wav.buffer);
  const pcm = Array.from({ length: (wav.length - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
  check("the chime is a valid mono 16-bit WAV", ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE" && ascii(36, 4) === "data"
    && view.getUint32(4, true) === wav.length - 8 && view.getUint32(40, true) === wav.length - 44 && view.getUint16(22, true) === 1 && view.getUint16(34, true) === 16);
  check("...about a third of a second long, audible, never clipping, and fading to silence", Math.abs(pcm.length / 24000 - 0.31) < 0.02
    && Math.max(...pcm.map(Math.abs)) > 8000 && Math.max(...pcm.map(Math.abs)) < 32767 && Math.max(...pcm.slice(-50).map(Math.abs)) < 50);
  reset();
}

// someone joining asks for the current modes; only non-Normal modes answer
api.set_voice_mode("whisper"); await tick();
const before = emitted.length;
receive({ action: "voice-mode-request", from: "p2" });
const answers = emitted.slice(before);
check("a join request is answered with your non-Normal mode", answers.length === 1 && JSON.stringify(answers[0]) === JSON.stringify({ action: "voice-mode", from: "p1", mode: "whisper" }));
api.set_voice_mode("normal"); await tick();
const afterNormal = emitted.length;
receive({ action: "voice-mode-request", from: "p2" });
check("on Normal, a join request gets no answer", emitted.length === afterNormal);

// --- right-click menu
const options = []; Hooks.callAll("getUserContextOptions", ui.players, options);
const li = id => ({ dataset: { userId: id } });
const volume = options.find(o => o.label === "proximity-voice-chat.UI.Volume");
check("volume entry shown for other users, not yourself", volume.visible(li("p2")) && !volume.visible(li("p1")));
check("player doesn't get Block Audio", options.filter(o => o.label.startsWith("WEBRTC.Tooltip")).every(o => !o.visible(li("p2"))));
volume.onClick({}, li("p2")); await tick();
const slider = dialogs.at(-1).element.querySelector(".pvc-volume");
slider.value = "0.5"; await slider.dispatch("input", { target: slider });
check("volume slider sets Bob's volume", Math.abs(rtc.client.users.p2.volume - 0.25) < 1e-9, String(rtc.client.users.p2?.volume));
// 2.0: on the advanced audio path a person can be turned up past 100%
check("on the advanced audio path the slider goes up to 200%", dialogs.at(-1).options.content.includes('max="2"') && dialogs.at(-1).options.content.includes("pvc-volume-value"), dialogs.at(-1).options.content);
slider.value = "1.5"; await slider.dispatch("input", { target: slider }); await tick();
check("above 100% is kept by the module, with Foundry's own volume at its maximum", api.get_user_voice_volume("p2") === 1.5 && rtc.client.users.p2.volume === 1 && settings.userVolumes.p2 === 1.5, JSON.stringify(settings.userVolumes));
volume.onClick({}, li("p2")); await tick();
check("the dialog reopens at 150%", dialogs.at(-1).options.content.includes('value="1.5"') && dialogs.at(-1).options.content.includes(">150%<"), dialogs.at(-1).options.content);
settings.legacyAudio = true;
volume.onClick({}, li("p2")); await tick();
check("on the old audio path the slider stops at 100%", dialogs.at(-1).options.content.includes('max="1"') && dialogs.at(-1).options.content.includes('value="1"'), dialogs.at(-1).options.content);
settings.legacyAudio = false;
slider.value = "0.5"; await slider.dispatch("input", { target: slider }); await tick();
check("back under 100% it's Foundry's own volume again", Math.abs(rtc.client.users.p2.volume - 0.25) < 1e-9 && settings.userVolumes.p2 === undefined);

// ===== GM's client
becomeUser("gm");
renderPlayers();
const gmBar = ui.players.element.querySelector(".pvc-voice-bar");
check("GM bar adds Global Listen and Global Speak", gmBar.children.map(b => b.dataset.pvcAction).join(",") === "mic,mode,deafen,settings,micSetup,listen,speak");
const gmButton = a => gmBar.querySelector(`button[data-pvc-action="${a}"]`);
check("GM toggles start active (narrator defaults)", gmButton("listen").classList.contains("active") && gmButton("speak").classList.contains("active"));
await gmButton("listen").dispatch("click"); await tick();
check("GM listen button turns Global Listening off", users[0].flags.global_listener === false && !gmButton("listen").classList.contains("active"));
await gmButton("speak").dispatch("click"); await tick();
check("GM speak button turns Global Speaking off", users[0].flags.global_speaker === false && !gmButton("speak").classList.contains("active"));
const gmOptions = []; Hooks.callAll("getUserContextOptions", ui.players, gmOptions);
const block = gmOptions.find(o => o.label === "WEBRTC.TooltipBlockUserAudio");
check("GM gets Block Audio for players", block.visible(li("p2")) && !block.visible(li("gm")));
block.onClick({}, li("p2"));
check("Block Audio removes the player's broadcast permission", JSON.stringify(users[2].updates?.at(-1)) === JSON.stringify({ "permissions.BROADCAST_AUDIO": false }));

// --- speaker list checkboxes (GM editing a token owned by Alice)
function renderTokenConfig(value, disabled, listenValue = "") {
  const element = new El("form");
  const tab = new El("div"); tab.className = "tab"; tab.dataset.tab = "proximity";
  const field = (name, v) => { const i = new El("input"); i.type = "text"; i.value = v; i.disabled = disabled; i.attrs.name = name; tab.append(i); return i; };
  const input = field("flags.proximity-voice-chat.userlist", value);
  const listenInput = field("flags.proximity-voice-chat.listenlist", listenValue);
  element.append(tab);
  const actor = { id: "amiri", ownership: { default: 0, p1: 3 } };
  Hooks.callAll("renderTokenConfig", { document: { baseActor: actor }, actor }, element, {}, {});
  const boxesAfter = i => i.parentElement.children[i.parentElement.children.indexOf(i) + 1].querySelectorAll("input");
  return { element, input, listenInput, boxes: boxesAfter(input), listenBoxes: boxesAfter(listenInput) };
}
{
  const { input, boxes } = renderTokenConfig("User.p2, User.deleted", false);
  const box = uuid => boxes.find(b => b.value === uuid);
  check("UUID field is hidden and replaced by a checkbox per user", input.type === "hidden" && boxes.length === 3);
  check("listed user (Bob) is ticked", box("User.p2").checked && !box("User.p2").disabled);
  check("owner (Alice) is ticked and locked", box("User.p1").checked && box("User.p1").disabled);
  check("owner is labelled", box("User.p1").parentElement.children.at(-1).textContent.includes("proximity-voice-chat.Token.Owner"));
  check("unlisted GM is unticked", !box("User.gm").checked);
  box("User.gm").checked = true; await box("User.gm").dispatch("change");
  check("ticking the GM rewrites the field, keeping unknown UUIDs and leaving owners implicit", input.value === "User.deleted, User.gm, User.p2", input.value);
  check("the change is announced to the form", (input.dispatched ?? []).includes("change"));
  box("User.p2").checked = false; await box("User.p2").dispatch("change");
  check("unticking Bob removes him", input.value === "User.deleted, User.gm", input.value);
}
{
  const { boxes, listenBoxes } = renderTokenConfig("User.p2", true);
  check("players see the checkboxes read-only", boxes.every(b => b.disabled) && listenBoxes.every(b => b.disabled));
}
{
  const { listenInput, listenBoxes } = renderTokenConfig("", false, "User.p2");
  const box = uuid => listenBoxes.find(b => b.value === uuid);
  check("listen list gets its own checkbox per user, with nothing locked (owners aren't implied)", listenInput.type === "hidden" && listenBoxes.length === 3 && listenBoxes.every(b => !b.disabled));
  check("listed listener (Bob) is ticked, owner (Alice) is not", box("User.p2").checked && !box("User.p1").checked);
  box("User.p1").checked = true; await box("User.p1").dispatch("change");
  check("ticking Alice adds her to the listen list", listenInput.value === "User.p1, User.p2", listenInput.value);
}

// --- GM sets Global Listening / Speaking for other users (e.g. a recording user)
{
  const menu = []; Hooks.callAll("getUserContextOptions", ui.players, menu);
  const entry = label => menu.find(o => o.label === label);
  check("GM can turn on Global Listening for a player, not for themselves", entry("proximity-voice-chat.UI.GlobalListenOn").visible(li("p2")) && !entry("proximity-voice-chat.UI.GlobalListenOn").visible(li("gm")));
  check("'turn off' isn't offered while it's off", !entry("proximity-voice-chat.UI.GlobalListenOff").visible(li("p2")));
  await entry("proximity-voice-chat.UI.GlobalListenOn").onClick({}, li("p2")); await tick();
  check("Bob is now a global listener", users[2].flags.global_listener === true);
  check("a notice names him", notices.at(-1).includes("GlobalListenOnNotice") && notices.at(-1).includes("Bob"));
  check("'turn off' is offered now", entry("proximity-voice-chat.UI.GlobalListenOff").visible(li("p2")) && !entry("proximity-voice-chat.UI.GlobalListenOn").visible(li("p2")));
  const markers = row("p2").querySelector(".pvc-global-markers");
  check("Bob's row shows he hears everyone", !!markers && markers.children.length === 1 && markers.children[0].className.includes("fa-ear-listen"));
  check("the GM's row has no markers (it's their default)", !row("gm").querySelector(".pvc-global-markers"));
  await entry("proximity-voice-chat.UI.GlobalListenOff").onClick({}, li("p2")); await tick();
  check("turning it off removes the marker", users[2].flags.global_listener === false && !row("p2").querySelector(".pvc-global-markers"));
  const playerMenu = []; becomeUser("p1"); Hooks.callAll("getUserContextOptions", ui.players, playerMenu);
  check("players don't get these entries", playerMenu.filter(o => o.label.includes("Global")).every(o => !o.visible(li("p2"))));
  becomeUser("gm");
}

// --- a GM with Global Speaking on is heard by everyone whatever the mode, and is told so instead of shown a reach
{
  becomeUser("gm"); renderPlayers();
  users[0].flags.global_speaker = true;
  const previewsBefore = canvas.interface.children.filter(c => !c.destroyed).length;
  game.modules.get("proximity-voice-chat").api.set_voice_mode("whisper"); await tick();
  check("GM whispering with Global Speaking on is told everyone still hears them", notices.at(-1) === "proximity-voice-chat.UI.ModeGlobalSpeaking", notices.at(-1));
  check("...and gets no reach preview", canvas.interface.children.filter(c => !c.destroyed).length <= previewsBefore);
  game.modules.get("proximity-voice-chat").api.set_voice_mode("normal"); await tick();
}

// --- connection self-test: this browser's network addresses, the relay, and telling the GM
{
  class FakePeerConnection {
    static candidates = [];
    constructor(config) { this.config = config; FakePeerConnection.last = this; }
    createDataChannel() {}
    async createOffer() { return {}; }
    async setLocalDescription() {
      setTimeout(() => {
        for (const type of FakePeerConnection.candidates) this.onicecandidate?.({ candidate: { type } });
        this.onicecandidate?.({ candidate: null });
      }, 0);
    }
    close() { this.closed = true; }
  }
  globalThis.RTCPeerConnection = FakePeerConnection;
  const settle = () => new Promise(r => setTimeout(r, 20));
  const relayChanged = async () => { Hooks.callAll("rtcSettingsChanged", rtc, { world: { turn: rtc.world.turn } }); await settle(); };

  becomeUser("gm");
  rtc.world.turn = { type: "server", url: "", username: "", password: "" };
  FakePeerConnection.candidates = ["host", "srflx"];
  let before = notices.length;
  await relayChanged();
  check("no relay configured, addresses found: no warnings", notices.length === before, notices.slice(before).join(" | "));
  check("the test connection is closed afterwards", FakePeerConnection.last.closed === true);

  rtc.world.turn = { type: "custom", url: "turn:turn.askew.us:3478", username: "u", password: "p" };
  before = notices.length;
  await relayChanged();
  const servers = FakePeerConnection.last.config.iceServers;
  check("with a custom relay, the test uses it the way Foundry does", servers.length === 1 && servers[0].urls === "turn:turn.askew.us:3478" && servers[0].credential === "p");
  check("relay configured but no relay address: the GM is warned it's unreachable", notices.slice(before).includes("WARN proximity-voice-chat.SelfTest.relay-unreachable"), notices.slice(before).join(" | "));

  FakePeerConnection.candidates = ["host", "srflx", "relay"];
  before = notices.length;
  await relayChanged();
  check("relay address found after a settings change: the GM is told it works", notices.slice(before).includes("proximity-voice-chat.SelfTest.relay-ok"), notices.slice(before).join(" | "));

  // a player whose browser offers no addresses at all (e.g. Firefox's default_address_only)
  becomeUser("p1");
  FakePeerConnection.candidates = [];
  before = notices.length;
  const sentBefore = emitted.length;
  await relayChanged();
  check("a browser offering no addresses gets an error that stays on screen", notices.slice(before).includes("ERROR proximity-voice-chat.SelfTest.no-addresses"), notices.slice(before).join(" | "));
  const report = emitted.slice(sentBefore).find(m => m.action === "voice-self-test");
  check("...and the failure is reported to the GMs", report?.problem === "no-addresses" && report.from === "p1", JSON.stringify(report));
  const rows = await game.modules.get("proximity-voice-chat").api.diagnose();
  check("diagnose blames this browser, not the connection", rows.every(r => r.problem.startsWith("YOUR BROWSER")), rows.map(r => r.problem).join(" | "));
  const afterReport = emitted.length;
  receive({ action: "voice-self-test-request", from: "gm" }); await tick();
  check("a GM loading later gets the result when they ask", emitted.slice(afterReport).some(m => m.action === "voice-self-test" && m.problem === "no-addresses"));

  // the GM's side: a named notice for the failing player
  becomeUser("gm");
  before = notices.length;
  receive({ action: "voice-self-test", from: "p2", problem: "no-addresses", types: {} });
  check("the GM gets a notice naming the player and the cause", notices.slice(before).some(n => n.startsWith("ERROR proximity-voice-chat.SelfTest.Player.no-addresses") && n.includes("Bob")), notices.slice(before).join(" | "));
  before = notices.length;
  receive({ action: "voice-self-test", from: "p2", problem: "no-addresses", types: {} });
  check("the same problem reported again (e.g. after a reload) isn't shown twice", notices.length === before);
  receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1 } });
  check("a passing report shows nothing", notices.length === before);
  receive({ action: "voice-self-test", from: "p2", problem: "no-addresses", types: {} });
  check("but if it breaks again after passing, the GM hears about it", notices.length > before);

  // diagnose: whether each connection is direct or relayed
  FakePeerConnection.candidates = ["host", "srflx"];
  await relayChanged();
  const stats = new Map([
    ["T1", { type: "transport", selectedCandidatePairId: "CP1" }],
    ["CP1", { type: "candidate-pair", localCandidateId: "L1", remoteCandidateId: "R1", state: "succeeded" }],
    ["L1", { type: "local-candidate", candidateType: "relay" }],
    ["R1", { type: "remote-candidate", candidateType: "srflx" }]
  ]);
  game.webrtc.client.peers = new Map([["p2", { _pc: { connectionState: "connected", iceConnectionState: "connected", getStats: async () => stats } }]]);
  let diag = await game.modules.get("proximity-voice-chat").api.diagnose();
  check("diagnose shows a relayed connection", diag.find(r => r.user === "Bob")?.route === "relayed (through your relay connection)", diag.find(r => r.user === "Bob")?.route);
  stats.set("L1", { type: "local-candidate", candidateType: "srflx" });
  diag = await game.modules.get("proximity-voice-chat").api.diagnose();
  check("...and a direct one", diag.find(r => r.user === "Bob")?.route === "direct");
  rtc.world.turn = { type: "server", url: "", username: "", password: "" };
  delete globalThis.RTCPeerConnection;
}

// --- voice diagnostics window, reports to the GM, and remote requests
{
  const api = game.modules.get("proximity-voice-chat").api;
  const menu = menus.get("diagnostics");
  check("Voice Diagnostics is a settings menu button everyone can use", !!menu && menu.restricted === false && menu.type.prototype instanceof FakeApplicationV2);

  // Alice opens it herself from her own row in the players list
  becomeUser("p1"); renderPlayers();
  tokens[1].document.x = 300; tokens[1].document._source.x = 300; Hooks.callAll("canvasReady", canvas); await runIntervals();
  tokens[1].visible = false;// Bob's token is hidden from Alice
  const menuEntries = []; Hooks.callAll("getUserContextOptions", ui.players, menuEntries);
  const own = menuEntries.find(o => o.label === "proximity-voice-chat.Diagnostics.Menu.Label");
  check("right-clicking your own row offers Voice Diagnostics, not on others' rows", own.visible(li("p1")) && !own.visible(li("p2")));
  const opened = windows.length;
  await own.onClick({}, li("p1")); await tick();
  const win = windows[opened];
  check("it opens the diagnostics window", !!win?.rendered);
  const text = allText(win.content);
  check("the window starts with a plain-language summary", text.includes("proximity-voice-chat.Diagnostics.Summary."), text.slice(0, 120));
  const bobRow = win.content.querySelectorAll("tr").find(r => r.dataset.userId === "p2");
  check("each player gets a row with a plain-language status", !!bobRow && allText(bobRow).includes("proximity-voice-chat.Diagnostics.Peer."), bobRow && allText(bobRow));
  check("a player's own view hides the name of a token they can't see", win.report.peers.find(p => p.id === "p2").reason.includes("you can't see") && !JSON.stringify(win.report).includes('"bob\\"'), win.report.peers.find(p => p.id === "p2").reason);
  check("...and is marked as redacted", win.report.redacted === true);
  const buttons = win.content.querySelectorAll("button").map(b => b.dataset.action).join(",");
  check("the player's window offers Run Again, Copy Report and Send to GM", buttons === "copyDetails,rerun,copy,send", buttons);
  tokens[1].visible = true;

  await win.click("copyDetails");
  check("Copy Details puts the full technical data on the clipboard", JSON.parse(copied.at(-1)).peers.length === win.report.peers.length);
  // the GM's browser is connected but sends no audio, like a recording client without a microphone
  game.webrtc.client.peers = new Map([["gm", { _pc: { connectionState: "connected", iceConnectionState: "connected", getStats: async () => new Map() } }]]);
  const gmStream = streams.gm; streams.gm = { id: "sg", getAudioTracks: () => [] };
  await win.click("rerun");
  const silent = win.report.peers.find(p => p.id === "gm");
  streams.gm = gmStream;
  check("a user sending no audio (no microphone, like a recording client) isn't flagged as paused",
    silent.receivingAudio === false && silent.problem === null && allText(win.content.querySelectorAll("tr").find(r => r.dataset.userId === "gm")).includes("Peer.NotSending"));
  // --- 1.6.4: hidden users, your microphone's real state, and audio in both directions
  const connectedPeer = (senders = [{ track: liveTrack() }]) => ({ _pc: { connectionState: "connected", iceConnectionState: "connected", getStats: async () => new Map(), getSenders: () => senders } });
  game.webrtc.client.localStream = { getAudioTracks: () => [liveTrack()] };
  game.webrtc.client.peers = new Map([["p2", connectedPeer()], ["gm", connectedPeer()]]);
  rtc.client.users.p2 = { ...(rtc.client.users.p2 ?? {}), blocked: true };
  await win.click("rerun");
  const hiddenRow = win.content.querySelectorAll("tr").find(r => r.dataset.userId === "p2");
  check("a user you've hidden is called out, not 'no audio player'", win.report.peers.find(p => p.id === "p2").problem === "hidden" && allText(hiddenRow).includes("Peer.Hidden"), allText(hiddenRow));
  const showAgain = hiddenRow.querySelector('button[data-action="unhide"]');
  check("...with a Show Again button", !!showAgain && showAgain.dataset.userId === "p2");
  await win.options.actions.unhide.call(win, {}, showAgain); await tick();
  check("Show Again undoes Hide User in this browser", rtc.client.users.p2.blocked === false && win.report.peers.find(p => p.id === "p2").problem !== "hidden");

  // your microphone: capturing, or why not
  const issues = () => self_issues(win.report.self).map(i => i.text).join(" | ");
  check("a capturing microphone raises no microphone warning", !issues().includes("Mic."), issues());
  game.webrtc.client.localStream = { getAudioTracks: () => [] };
  await win.click("rerun");
  check("a microphone that isn't capturing says so, instead of 'muted'", issues().includes("Mic.NotCapturing") && !issues().includes("MicMuted"), issues());
  rtc.client.audioSrc = "disabled"; await win.click("rerun");
  check("...and names the cause when the microphone is turned off in Foundry", issues().includes("Mic.Off"), issues());
  rtc.client.audioSrc = "default";
  Object.defineProperty(navigator, "permissions", { value: { query: async () => ({ state: "denied" }) }, configurable: true });
  await win.click("rerun");
  check("...or blocked by the browser", issues().includes("Mic.Denied") && win.report.self.mic.permission === "denied", issues());
  delete navigator.permissions;
  game.webrtc.client.localStream = { getAudioTracks: () => [liveTrack()] };
  rtc.client.voice.mode = "ptt"; game.webrtc.broadcasting = false;
  await win.click("rerun");
  check("push-to-talk while not holding the key is explained", issues().includes("Mic.PushToTalk"), issues());
  rtc.client.voice.mode = "always"; game.webrtc.broadcasting = true;
  settings.fixPeerConnections = false; await win.click("rerun");
  check("'Fix Voice Connection Drops' being off is flagged", issues().includes("FixOff"), issues());
  settings.fixPeerConnections = true;

  // audio in both directions: connected, your mic works, but nothing of yours goes out on this connection
  game.webrtc.client.peers.set("p2", connectedPeer([]));
  await win.click("rerun");
  const outRow = win.content.querySelectorAll("tr").find(r => r.dataset.userId === "p2");
  check("audio not reaching them is a warning on their row", outRow.className.includes("pvc-warn") && allText(outRow).includes("Peer.NotReachingThem"), allText(outRow));
  game.webrtc.client.peers = undefined; game.webrtc.client.localStream = undefined;
  await win.click("rerun");

  await win.click("copy");
  check("Copy Report puts a readable text report on the clipboard", copied.at(-1)?.includes("proximity-voice-chat.Diagnostics.Text.Heading") && copied.at(-1).includes("- Bob:"), copied.at(-1));

  game.users.activeGM = null;
  let before = notices.length;
  await win.click("send");
  check("Send to GM with no GM online says so", notices.slice(before).includes("WARN proximity-voice-chat.Diagnostics.NoGM"), notices.slice(before).join(" | "));
  game.users.activeGM = users[0];
  const sentBefore = emitted.length;
  await win.click("send");
  const sent = emitted.slice(sentBefore).find(m => m.action === "diagnostics-report");
  check("Send to GM sends the full, unredacted report over the socket (not a chat message the player could read)", sent?.to === null && sent.report.redacted === false && created.length === 0, JSON.stringify(sent && { to: sent.to, redacted: sent.report.redacted }));

  // the GM requests a player's diagnostics remotely: written to the player's user record, verified by its author
  becomeUser("p1");
  let socketBefore = emitted.length;
  receive({ action: "diagnostics-request", from: "gm", to: "p1" }); await tick(); await tick();
  check("a socket message claiming to be a GM's request does nothing", !emitted.slice(socketBefore).some(m => m.action === "diagnostics-report"));
  socketBefore = emitted.length;
  deliverUserUpdate(users[1], { gmRequest: { id: "forged-1", action: "diagnose", user: null } }, "p1"); await tick(); await tick();
  check("a request written by a player (not a GM) does nothing", !emitted.slice(socketBefore).some(m => m.action === "diagnostics-report"));
  before = notices.length;
  const replyBefore = emitted.length;
  deliverUserUpdate(users[1], { gmRequest: { id: "req-1", action: "diagnose", user: null } }, "gm"); await tick(); await tick();
  check("the player is told the GM ran diagnostics", notices.slice(before).some(n => n.includes("proximity-voice-chat.Diagnostics.RanByGM")), notices.slice(before).join(" | "));
  const reply = emitted.slice(replyBefore).find(m => m.action === "diagnostics-report");
  check("...and the report goes back to the GM who wrote the request", reply?.to === "gm" && reply.from === "p1");
  const replayBefore = emitted.length;
  Hooks.callAll("updateUser", users[1], { flags: { "proximity-voice-chat": { gmRequest: { id: "req-1" } } } }, {}, "gm"); await tick(); await tick();
  check("the same request isn't handled twice", !emitted.slice(replayBefore).some(m => m.action === "diagnostics-report"));

  becomeUser("gm"); renderPlayers();
  const gmEntries = []; Hooks.callAll("getUserContextOptions", ui.players, gmEntries);
  const request = gmEntries.find(o => o.label === "proximity-voice-chat.Diagnostics.Request");
  check("GMs can request diagnostics from another active player", request.visible(li("p2")) && !request.visible(li("gm")));
  const reqBefore = emitted.length;
  request.onClick({}, li("p2")); await tick();
  const written = users[2].flags.gmRequest;
  check("requesting writes the request onto that player's user record, not the socket", written?.action === "diagnose" && written.user === null && !!written.id && !emitted.slice(reqBefore).some(m => String(m.action).startsWith("diagnostics-")), JSON.stringify(written));

  // the requesting GM's browser posts the card, whispered to GMs, and opens the report
  const report = JSON.parse(JSON.stringify(reply.report));
  report.self.name = "<b>Alice</b>";
  const windowsBefore = windows.length;
  receive({ action: "diagnostics-report", from: "p1", to: "gm", report }); await tick(); await tick();
  const card = created.at(-1);
  check("the GM's browser posts a chat card whispered only to GMs", !!card && JSON.stringify(card.whisper) === JSON.stringify(["gm"]) && card.flags["proximity-voice-chat"].report === report);
  check("the card escapes the player's name", card.content.includes("&lt;b&gt;Alice&lt;/b&gt;") && !card.content.includes("<b>Alice"), card.content);
  check("the report window opens for the GM who asked", windows.length === windowsBefore + 1 && windows.at(-1).remote === true);
  const remoteButtons = windows.at(-1).content.querySelectorAll("button").map(b => b.dataset.action).join(",");
  check("a received report offers Copy and Request Again, not Run Again or Send", remoteButtons === "copyDetails,copy,request", remoteButtons);

  // a report another GM asked for is posted by that GM, not this one
  const createdBefore = created.length;
  receive({ action: "diagnostics-report", from: "p2", to: "other-gm", report }); await tick();
  check("only the GM who asked posts the card", created.length === createdBefore);
  // an unprompted report is posted by the active GM
  receive({ action: "diagnostics-report", from: "p2", to: null, report }); await tick();
  check("a report sent unprompted is posted by the active GM", created.length === createdBefore + 1);

  // the chat card's button opens the report it carries
  const html = new El("div"); const open = new El("button"); open.className = "pvc-open-report"; html.append(open);
  const message = { getFlag: (m, k) => (m === "proximity-voice-chat" && k === "report" ? report : undefined) };
  Hooks.callAll("renderChatMessageHTML", message, html);
  const fromCard = windows.length;
  await open.dispatch("click"); await tick();
  check("the chat card's Open Report button opens the stored report", windows.length === fromCard + 1 && windows.at(-1).report === report);
}

// --- a GM viewing a player's report can ask that player's browser to show someone again
{
  becomeUser("gm"); renderPlayers();
  const report = {
    at: Date.now(), redacted: false,
    self: { id: "p1", name: "Alice", foundry: "14.369", module: "x", scripts: "x", voiceActive: true, voiceMode: "normal", listeningThrough: [], speakingThrough: [], addresses: { host: 1 }, webrtcSupported: true, mic: { capturing: true }, connectionFix: true },
    peers: [{ id: "p2", name: "Bob", connected: true, problem: "hidden", hidden: true, receivingAudio: true, sendingAudio: true, volume: 1, route: "direct", reason: "" }]
  };
  const html = new El("div"); const open = new El("button"); open.className = "pvc-open-report"; html.append(open);
  Hooks.callAll("renderChatMessageHTML", { getFlag: (m, k) => (k === "report" ? report : undefined) }, html);
  await open.dispatch("click"); await tick();
  const win = windows.at(-1);
  const ask = win.content.querySelectorAll("button").find(b => b.dataset.action === "remoteUnhide");
  check("a GM viewing a player's report gets Ask to Show Again for someone they've hidden", !!ask && ask.dataset.userId === "p2");
  win.options.actions.remoteUnhide.call(win, {}, ask); await tick();
  const unhideRequest = users[1].flags.gmRequest;
  check("...which writes the request onto that player's user record", unhideRequest?.action === "unhide" && unhideRequest.user === "p2", JSON.stringify(unhideRequest));

  becomeUser("p1");
  rtc.client.users.p2 = { ...(rtc.client.users.p2 ?? {}), blocked: true };
  receive({ action: "diagnostics-unhide", from: "gm", to: "p1", user: "p2" }); await tick();
  check("a socket message claiming to be a GM can't show someone again", rtc.client.users.p2.blocked === true);
  deliverUserUpdate(users[1], { gmRequest: { id: "forged-2", action: "unhide", user: "p2" } }, "p2"); await tick();
  check("only a GM-written request can make a player's browser show someone again", rtc.client.users.p2.blocked === true);
  const before = notices.length, replyBefore = emitted.length;
  deliverUserUpdate(users[1], { gmRequest: unhideRequest }, "gm"); await tick(); await tick();
  check("the player's browser shows them again", rtc.client.users.p2.blocked === false);
  check("...tells the player why", notices.slice(before).some(n => n.includes("proximity-voice-chat.Diagnostics.Unhidden")), notices.slice(before).join(" | "));
  check("...and sends the GM a fresh report", emitted.slice(replyBefore).some(m => m.action === "diagnostics-report" && m.to === "gm"));

  // a diagnose request after an unhide must not carry the old "user" along (setFlag merges objects)
  becomeUser("gm");
  rtc.client.users.p2.blocked = true;
  const gmEntries2 = []; Hooks.callAll("getUserContextOptions", ui.players, gmEntries2);
  gmEntries2.find(o => o.label === "proximity-voice-chat.Diagnostics.Request").onClick({}, li("p1")); await tick();
  check("each request writes every field, so nothing is left over from the last one", users[1].flags.gmRequest.action === "diagnose" && users[1].flags.gmRequest.user === null, JSON.stringify(users[1].flags.gmRequest));
  becomeUser("p1");
  deliverUserUpdate(users[1], { gmRequest: users[1].flags.gmRequest }, "gm"); await tick(); await tick();
  check("...so a diagnose request doesn't also show someone again", rtc.client.users.p2.blocked === true);
  rtc.client.users.p2.blocked = false;
}

// --- end-to-end relay test: a relay-only connection from a player's browser to the GM's, over a simulated network
{
  const net = { relayOK: true, routeOK: true, errors: [], pcs: [] };
  class NetChannel {
    constructor(pc) { this.pc = pc; }
    send(data) { setTimeout(() => this.peer?.onmessage?.({ data }), 1); }
  }
  class NetPeerConnection {
    constructor(config = {}) { this.config = config; this.listeners = {}; this.iceGatheringState = "new"; net.pcs.push(this); this.id = net.pcs.length; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    emit(type, event) { (this.listeners[type] ?? []).forEach(fn => fn(event)); this["on" + type]?.(event); }
    createDataChannel() { this.channel = new NetChannel(this); return this.channel; }
    async createOffer() { return { type: "offer", sdp: "offer:" + this.id }; }
    async createAnswer() { return { type: "answer", sdp: "answer:" + this.id }; }
    async setLocalDescription(description) { this.localDescription = description; setTimeout(() => this.gather(), 0); }
    gather() {
      const usesRelay = (this.config.iceServers ?? []).some(server => /^turns?:/.test(String(server.urls)));
      if (this.config.iceTransportPolicy === "relay") {
        if (usesRelay && net.relayOK) this.emit("icecandidate", { candidate: { type: "relay" } });
        else for (const error of net.errors) this.emit("icecandidateerror", error);
      } else {
        this.emit("icecandidate", { candidate: { type: "host" } });
        this.emit("icecandidate", { candidate: { type: "srflx" } });
      }
      this.iceGatheringState = "complete";
      this.emit("icecandidate", { candidate: null });
    }
    async setRemoteDescription(description) {
      this.remoteDescription = description;
      if (description.type !== "answer") return;
      const far_end = net.pcs.find(pc => pc.localDescription?.sdp === description.sdp);
      if (!far_end || !net.routeOK || !this.channel) return;// a relay slot, but nothing gets through
      const remote = new NetChannel(far_end);
      this.channel.peer = remote; remote.peer = this.channel;
      setTimeout(() => { far_end.emit("datachannel", { channel: remote }); this.channel.onopen?.(); }, 0);
    }
    close() { this.closed = true; }
  }
  globalThis.RTCPeerConnection = NetPeerConnection;
  const api = game.modules.get("proximity-voice-chat").api;
  const quick = { gather: 100, answer: 300, open: 150, ping: 150 };
  const settle = (ms = 30) => new Promise(r => setTimeout(r, ms));
  rtc.world.turn = { type: "custom", url: "turn:turn.askew.us:3478", username: "u", password: "p" };
  game.users.activeGM = users[0];

  /** runs a relay test as Alice, delivering the socket messages between her browser and the GM's like the server would */
  async function relayTest({ deliverAnswer = true } = {}) {
    becomeUser("p1");
    const from = emitted.length;
    const running = api.run_relay_test(quick);
    await settle();
    const offer = emitted.slice(from).find(m => m.action === "relay-test-offer");
    if (offer && deliverAnswer) {
      becomeUser("gm"); receive(offer); await settle();
      const answer = emitted.slice(from).find(m => m.action === "relay-test-answer");
      becomeUser("p1"); if (answer) receive(answer);
    }
    return { result: await running, offer };
  }

  let { result, offer } = await relayTest();
  check("the relay test offers a connection to the active GM", offer?.to === "gm" && offer.from === "p1");
  check("Alice's side may only use the relay", net.pcs.find(pc => pc.localDescription?.sdp === offer.sdp)?.config.iceTransportPolicy === "relay");
  const gmSide = net.pcs.find(pc => pc.localDescription?.type === "answer");
  check("the GM's side doesn't reserve a relay slot of its own", !(gmSide?.config.iceServers ?? []).some(server => /^turns?:/.test(String(server.urls))));
  check("a working relay path passes, with a round-trip time", result.status === "ok" && typeof result.rttMs === "number", JSON.stringify(result));
  check("the test connections are closed afterwards", net.pcs.filter(pc => pc.config.iceTransportPolicy === "relay").every(pc => pc.closed));

  net.relayOK = false;
  net.errors = [
    { errorCode: 701, errorText: "", url: "turn:turn.askew.us:3478?transport=udp" },
    { errorCode: 486, errorText: "Allocation Bandwidth Quota Reached", url: "turn:turn.askew.us:3478" },
    { errorCode: 701, errorText: "", url: "stun:stun.l.google.com:19302" }
  ];
  ({ result } = await relayTest());
  check("no relay slot: the test says so and names the relay's error, 486 over the 701s", result.status === "no-allocation" && result.error?.code === 486 && result.error.reason === "full", JSON.stringify(result));
  net.errors = [{ errorCode: 701, errorText: "", url: "stun:stun.l.google.com:19302" }];
  ({ result } = await relayTest());
  check("STUN errors aren't blamed on the relay", result.status === "no-allocation" && result.error === null, JSON.stringify(result));
  net.relayOK = true; net.errors = [];

  net.routeOK = false;
  ({ result } = await relayTest());
  check("a relay slot that carries nothing fails as no-route (the game-day failure)", result.status === "no-route", JSON.stringify(result));
  net.routeOK = true;

  ({ result } = await relayTest({ deliverAnswer: false }));
  check("no answer from the GM's browser is inconclusive, not a failure", result.status === "no-answer");
  game.users.activeGM = null;
  ({ result } = await relayTest());
  check("with no GM online, the test waits", result.status === "no-gm");
  game.users.activeGM = users[0];
  becomeUser("gm");
  check("GMs aren't tested against themselves", (await api.run_relay_test(quick)).status === "is-gm");

  // the GM hears about a player's failing relay path, once, by name
  const before = notices.length;
  receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1, relay: 1 }, relayTest: { status: "no-route", error: null } });
  check("the GM is told by name when a player's relay path carries nothing", notices.slice(before).some(n => n.startsWith("WARN proximity-voice-chat.RelayTest.Player.no-route") && n.includes("Bob")), notices.slice(before).join(" | "));
  const again = notices.length;
  receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1, relay: 1 }, relayTest: { status: "no-route", error: null } });
  check("...and only once", notices.length === again);
  receive({ action: "voice-self-test", from: "p2", problem: null, types: { host: 1, relay: 1 }, relayTest: { status: "no-allocation", error: { code: 486, reason: "full", text: "" } } });
  check("a relay that's full names the cause", notices.at(-1).includes("RelayTest.Player.no-allocation") && notices.at(-1).includes("RelayTest.Because") && notices.at(-1).includes("486"), notices.at(-1));

  // and it shows in Voice Diagnostics
  becomeUser("p1");
  await relayTest();
  const report = await api.collect_diagnostics();
  const text = (await import(new URL("./diagnostics.js", mainScript.startsWith("file:") ? mainScript : "file://" + mainScript).href)).report_text(report);
  check("diagnostics report the relay test and its round trip", text.includes("Relay test: ") && text.includes("Relay.ok"), text.split("\n").find(l => l.startsWith("Relay test")));
  net.routeOK = false; await relayTest();
  const failing = self_issues((await api.collect_diagnostics()).self).map(i => i.text).join(" | ");
  check("a failing relay path is a warning in diagnostics", failing.includes("Diagnostics.Relay.no-route"), failing);
  net.routeOK = true;
  delete globalThis.RTCPeerConnection;
  rtc.world.turn = { type: "server", url: "", username: "", password: "" };
}

// --- 2.0: Voice Diagnostics says how each player sounds and which audio path is in use
{
  const D = await import(new URL("./diagnostics.js", mainScript.startsWith("file:") ? mainScript : "file://" + mainScript).href);
  becomeUser("p1"); await tick();
  const report = await api.collect_diagnostics();
  check("the report says which audio path this browser is on", report.self.audio?.path === "advanced" && report.self.audio.boost === 1.5 && report.self.soundPropagation === true, JSON.stringify(report.self.audio));
  const bob = report.peers.find(p => p.id === "p2");
  check("each peer carries how they're heard and their audio path", typeof bob.heard === "string" && typeof bob.muffle === "number" && typeof bob.cutoff === "number" && typeof bob.pan === "number" && !!bob.audio, JSON.stringify(bob));
  // a made-up peer, as a browser with working audio would report it
  const base = { ...bob, connected: true, problem: null, volume: 0.6, muted: false, receivingAudio: true };
  const corner = { ...base, heard: "around a corner (route 14 tiles, 1 bend)", audio: { path: "advanced", gain: 1.2, cutoff: 2449, pan: -0.3 } };
  const sound = D.peer_sound(corner);
  check("a peer's sound line: the route, then volume, filter and side", sound.startsWith("around a corner (route 14 tiles, 1 bend); ") && sound.includes("Audio.PeerAdvanced") && sound.includes('"gain":120') && sound.includes("Audio.Filter") && /khz\W+2\.4/.test(sound) && sound.includes("Audio.Left") && /percent\W+30/.test(sound), sound);
  const open = D.peer_sound({ ...base, heard: "in the open", audio: { path: "advanced", gain: 1.5, cutoff: 20000, pan: 0 } });
  check("unfiltered and centred are said in words", open.includes("Audio.NoFilter") && open.includes("Audio.Centre"), open);
  const old = D.peer_sound({ ...base, heard: "through 1 closed door (muffled 50%)", audio: { path: "old", reason: "sink", detail: "NotFoundError" } });
  check("a peer on the old path says why", old.includes("through 1 closed door") && old.includes("Audio.PeerOld") && old.includes("Audio.Reason.sink") && old.includes("NotFoundError"), old);
  check("a report from before 2.0 has no sound line", D.peer_sound({ ...base, heard: undefined, audio: undefined }) === "");
  const rendered = D.render_report({ ...report, peers: [corner] });
  check("the sound line shows under the player's status", allText(rendered.querySelector(".pvc-sound")).includes("around a corner"), allText(rendered));
  check("the facts list the audio path, propagation and directional voice", ["Fact.Audio", "Audio.Advanced", "Fact.Propagation", "Fact.Directional"].every(t => allText(rendered).includes(t)), allText(rendered.querySelector(".pvc-facts")));
  const text = D.report_text({ ...report, peers: [corner] });
  check("Copy Report includes them", text.includes("around a corner (route 14 tiles, 1 bend)") && text.includes("Voice audio: ") && text.includes("sound through and around walls: on"), text);
  const failed = { ...report.self, audio: { path: "old", reason: "resume", detail: "nope", problem: true, boost: 1.5 } };
  check("a browser that fell back gets a warning with the reason", self_issues(failed).some(i => i.level === "warn" && i.text.includes("Audio.Fallback") && i.text.includes("Audio.Reason.resume") && i.text.includes("nope")), JSON.stringify(self_issues(failed)));
  check("...and the facts say old path", allText(D.render_report({ ...report, self: failed })).includes("Audio.Old"));
  const waiting = { ...report.self, audio: { path: "old", reason: "waiting", detail: null, problem: false, boost: 1.5 } };
  check("not having clicked yet is a hint, not a warning", self_issues(waiting).some(i => i.level === "info" && i.text.includes("Audio.Waiting")) && !self_issues(waiting).some(i => i.text.includes("Audio.Fallback")));
  const chosen = { ...report.self, audio: { path: "old", reason: "opted-out", detail: null, problem: false, boost: 1.5 } };
  check("choosing the old path isn't flagged at all", !self_issues(chosen).some(i => i.text.includes("Audio.")));
  const { audio, soundPropagation, directional, muffle, ...before2 } = report.self;
  check("a report from before 2.0 still renders", !self_issues(before2).some(i => i.text.includes("Audio.")) && !allText(D.render_report({ ...report, self: before2 })).includes("Fact.Audio") && D.report_text({ ...report, self: before2 }).includes("Voice audio: "));
}

console.log(fails ? fails + " FAILURES" : "ALL PASSED");
process.exit(fails ? 1 : 0);

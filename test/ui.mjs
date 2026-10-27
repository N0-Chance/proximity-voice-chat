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
  querySelectorAll(sel) { const out = []; const walk = e => { for (const c of e.children) { if (c._matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const bodyClasses = new El("body");
globalThis.document = { hidden: false, createElement: t => new El(t), addEventListener() {}, querySelector: () => null, body: bodyClasses };

// --- fake PIXI
class Container {
  constructor() { this.children = []; this.parent = null; this.destroyed = false; this.alpha = 1; }
  addChild(c) { c.parent = this; this.children.push(c); return c; }
  destroy() { this.destroyed = true; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
class Graphics extends Container {
  lineStyle(o) { this.line = o; return this; }
  beginFill(c) { this.fill = c; return this; }
  endFill() { return this; }
  drawCircle(x, y, r) { (this.circles ??= []).push({ x, y, r }); return this; }
}
class Sprite extends Container {
  constructor(t) { super(); this.texture = t; this.anchor = { set() {} }; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; }
}
globalThis.PIXI = { Container, Graphics, Sprite };

// --- Foundry stubs
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), callAll: (n, ...a) => (hooks[n] ?? []).forEach(f => f(...a)) };
const intervals = [];
globalThis.setInterval = fn => (intervals.push(fn), 0);
let now = 1000;
Date.now = () => now;
const sheet = () => ({ TABS: { sheet: { tabs: [] } }, PARTS: { footer: {} } });
class PointSoundSource {
  constructor() { this.data = {}; }
  initialize(d) { Object.assign(this.data, d); }
  getVolumeMultiplier(l) { const d = Math.hypot(l.x - this.data.x, l.y - this.data.y); return d > this.data.radius ? 0 : (Math.cos(Math.PI * d / this.data.radius) + 1) / 2; }
}
const dialogs = [];
class DialogV2 {
  constructor(o) { this.options = o; dialogs.push(this); }
  async render() { this.element = new El("div"); const input = new El("input"); input.className = "pvc-volume"; this.element.append(input); return this; }
}
const humanizeBinding = b => [...(b.modifiers ?? []), b.key].join(" + ");
globalThis.foundry = {
  applications: { sheets: { TokenConfig: sheet(), PrototypeTokenConfig: sheet(), SceneConfig: sheet() }, api: { DialogV2 },
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
const streams = { p1: { id: "s1", getAudioTracks: () => [{}] }, p2: { id: "s2", getAudioTracks: () => [{}] }, gm: { id: "sg", getAudioTracks: () => [{}] } };
const levelReports = new Map();
let levelReportsWork = true;
const media = {};
const rtc = {
  world: { mode: 1 }, client: { users: {}, muteAll: false, voice: { activityThreshold: -45 } }, activity: {},
  getUser: id => ({ volume: rtc.client.users[id]?.volume ?? 1, muted: !!rtc.client.users[id]?.muted, canBroadcastAudio: !users.find(u => u.id === id)?.blockedAudio }),
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
  settings: { register: (m, k, c) => settings[k] ??= c.default, get: (m, k) => settings[k], set: async (m, k, v) => { settings[k] = v; } },
  i18n: { localize: s => s, format: (s, d) => s + " " + JSON.stringify(d) },
  socket: { on() {}, emit() {} },
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
globalThis.canvas = { ready: true, scene, level: { id: "L1" }, tokens: { controlled: [], ownedTokens: [], placeables: tokens }, app: { ticker: { add: f => tickers.add(f), remove: f => tickers.delete(f) } } };
const notices = [];
globalThis.ui = { webrtc: { getUserVideoElement: id => media[id] ??= { volume: 1, paused: false, play() {} } }, notifications: { info: m => notices.push(m), warn: m => notices.push("WARN " + m), error: m => notices.push("ERROR " + m) } };
globalThis.fromUuid = async () => null;

await import(process.argv[2] ?? new URL("../scripts/proximity-voice-chat.js", import.meta.url).href);
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
const indicatorOn = token => token.children.find(c => c.pvcStyle && !c.destroyed);
const speak = async (id, db) => { levelReports.get("proximity-voice-chat." + id)?.cb(db); await tick(); };

function becomeUser(id) {
  users.forEach(u => u.isSelf = u.id === id);
  game.user = game.users.get(id);
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

// --- dock
check("dock hidden by default (world setting on)", bodyClasses.classList.contains("pvc-hide-dock"));
settings.showCameraDock = true; Hooks.callAll("ready"); await tick();
check("player override 'show dock anyway' brings it back", !bodyClasses.classList.contains("pvc-hide-dock"));
settings.showCameraDock = false; Hooks.callAll("ready"); await tick();

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
check("Bob out of earshot: no cue on his token", !indicatorOn(tokens[1]));
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
check("player bar has mic, deafen, settings only", actions === "mic,deafen,settings", actions);
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

// --- hotkeys
check("five hotkeys registered, unbound by default", keybindings.size === 5 && [...keybindings.values()].every(k => k.editable.length === 0), [...keybindings.keys()].join(","));
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

// ===== GM's client
becomeUser("gm");
renderPlayers();
const gmBar = ui.players.element.querySelector(".pvc-voice-bar");
check("GM bar adds Global Listen and Global Speak", gmBar.children.map(b => b.dataset.pvcAction).join(",") === "mic,deafen,settings,listen,speak");
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
function renderTokenConfig(value, disabled) {
  const element = new El("form");
  const tab = new El("div"); tab.className = "tab"; tab.dataset.tab = "proximity";
  const input = new El("input"); input.type = "text"; input.value = value; input.disabled = disabled;
  input.attrs.name = "flags.proximity-voice-chat.userlist";
  tab.append(input); element.append(tab);
  const actor = { id: "amiri", ownership: { default: 0, p1: 3 } };
  Hooks.callAll("renderTokenConfig", { document: { baseActor: actor }, actor }, element, {}, {});
  return { element, input, boxes: element.querySelectorAll("input").filter(i => i.type === "checkbox") };
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
  const { boxes } = renderTokenConfig("User.p2", true);
  check("players see the checkboxes read-only", boxes.every(b => b.disabled));
}

console.log(fails ? fails + " FAILURES" : "ALL PASSED");
process.exit(fails ? 1 : 0);

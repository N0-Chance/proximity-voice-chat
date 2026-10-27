/**
 * Replaces Foundry's camera dock for audio-only proximity play: speaking cues on tokens and in the players list,
 * and voice controls at the bottom of the players list.
 *
 * Talks to proximity-voice-chat.js only through game.modules.get(MODULE_ID).api, at runtime, so there is no
 * circular import between the two files.
 */
const MODULE_ID = "proximity-voice-chat";

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const UI_SCRIPT_VERSION = "1.5.0";

export const SPEAKING_STYLES = {
  ring: "proximity-voice-chat.Settings.SpeakingIndicator.Ring",
  icon: "proximity-voice-chat.Settings.SpeakingIndicator.Icon",
  badge: "proximity-voice-chat.Settings.SpeakingIndicator.Badge",
  none: "proximity-voice-chat.Settings.SpeakingIndicator.None"
};

/** How long someone counts as still speaking after their audio drops below the threshold */
const SPEAKING_HOLD_MS = 400;
const LEVEL_REPORT_INTERVAL_MS = 100;
const SPEAKING_ICON = "icons/svg/sound.svg";

const api = () => game.modules.get(MODULE_ID).api;

export function register_voice_ui_settings() {
  game.settings.register(MODULE_ID, "hideCameraDock", {
    name: "proximity-voice-chat.Settings.HideCameraDock.Label",
    hint: "proximity-voice-chat.Settings.HideCameraDock.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => _apply_dock_visibility()
  });
  game.settings.register(MODULE_ID, "showCameraDock", {
    name: "proximity-voice-chat.Settings.ShowCameraDock.Label",
    hint: "proximity-voice-chat.Settings.ShowCameraDock.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => _apply_dock_visibility()
  });
  game.settings.register(MODULE_ID, "speakingThreshold", {
    name: "proximity-voice-chat.Settings.SpeakingThreshold.Label",
    hint: "proximity-voice-chat.Settings.SpeakingThreshold.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: -70, max: -20, step: 1 },
    default: -45
  });
  game.settings.register(MODULE_ID, "speakingIndicator", {
    name: "proximity-voice-chat.Settings.SpeakingIndicator.Label",
    hint: "proximity-voice-chat.Settings.SpeakingIndicator.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "ring",
    choices: SPEAKING_STYLES,
    onChange: () => _redraw_all_indicators()
  });
  game.settings.register(MODULE_ID, "speakingIndicatorOverride", {
    name: "proximity-voice-chat.Settings.SpeakingIndicatorOverride.Label",
    hint: "proximity-voice-chat.Settings.SpeakingIndicatorOverride.Hint",
    scope: "client",
    config: true,
    type: String,
    default: "default",
    choices: { default: "proximity-voice-chat.Settings.SpeakingIndicator.Default", ...SPEAKING_STYLES },
    onChange: () => _redraw_all_indicators()
  });
}

function _speaking_style() {
  const override = game.settings.get(MODULE_ID, "speakingIndicatorOverride");
  return override === "default" ? game.settings.get(MODULE_ID, "speakingIndicator") : override;
}

function _is_voice_active() {
  const mode = game.webrtc?.settings?.world?.mode;
  return mode === foundry.av.AVSettings.AV_MODES.AUDIO || mode === foundry.av.AVSettings.AV_MODES.AUDIO_VIDEO;
}

/* -------------------------------------------- */
/*  Camera dock                                 */
/* -------------------------------------------- */

/**
 * Hides the dock visually without removing it. Voice audio plays through the video elements inside the dock,
 * so it has to stay in the page and keep being managed by Foundry; it is moved off-screen rather than hidden
 * with display:none, which browsers may treat differently for media playback.
 */
function _apply_dock_visibility() {
  const hide = game.settings.get(MODULE_ID, "hideCameraDock") && !game.settings.get(MODULE_ID, "showCameraDock");
  document.body.classList.toggle("pvc-hide-dock", hide);
}

/* -------------------------------------------- */
/*  Speaking detection                          */
/* -------------------------------------------- */

/**
 * Per user: the stream being measured, whether they're speaking, and when they were last above the threshold.
 * Speaking is measured locally on the audio this client actually receives, because Foundry's own "speaking"
 * signal stays on permanently in always-on voice mode.
 * @type {Map<string, {stream: MediaStream | null, measured: boolean, speaking: boolean, last_loud: number}>}
 */
const _speakers = new Map();

function _report_id(user_id) {
  return MODULE_ID + "." + user_id;
}

function _get_stream(user_id) {
  const client = game.webrtc?.client;
  if (!client) return null;
  if (user_id === game.user.id) return client.getLevelsStreamForUser?.(user_id) ?? client.getMediaStreamForUser?.(user_id) ?? null;
  return client.getMediaStreamForUser?.(user_id) ?? null;
}

function _on_level(user_id, db_level) {
  const state = _speakers.get(user_id);
  if (!state) return;
  // separate from Foundry's voice-activation threshold, so tuning cues doesn't change when anyone transmits
  const threshold = game.settings.get(MODULE_ID, "speakingThreshold");
  const now = Date.now();
  if (db_level >= threshold) state.last_loud = now;
  let speaking = now - state.last_loud < SPEAKING_HOLD_MS;
  // your own mic only counts while it is actually transmitting (push-to-talk held, not muted)
  if (user_id === game.user.id) speaking &&= !!game.webrtc.broadcasting && !game.webrtc.settings.getUser(user_id)?.muted;
  _set_speaking(user_id, speaking);
}

/**
 * Starts or stops measuring each active user's audio as streams come and go
 */
function _reconcile_speakers() {
  if (!_is_voice_active() || !game.audio?.startLevelReports) return;
  for (const user of game.users) {
    const state = _speakers.get(user.id);
    if (!user.active) {
      if (state) _stop_speaker(user.id);
      continue;
    }
    const stream = _get_stream(user.id);
    if (state && state.stream === stream && stream?.getAudioTracks().length) continue;
    _stop_speaker(user.id);
    const next = { stream, measured: false, speaking: false, last_loud: 0 };
    _speakers.set(user.id, next);
    if (stream) {
      next.measured = game.audio.startLevelReports(_report_id(user.id), stream, (db) => _on_level(user.id, db), LEVEL_REPORT_INTERVAL_MS);
    }
  }
  // Without a measurable stream, fall back to Foundry's broadcast signal (accurate for activity and push-to-talk modes)
  for (const [user_id, state] of _speakers) {
    if (!state.measured) _set_speaking(user_id, !!game.webrtc.settings.activity[user_id]?.speaking);
  }
}

function _stop_speaker(user_id) {
  if (!_speakers.has(user_id)) return;
  game.audio.stopLevelReports(_report_id(user_id));
  _set_speaking(user_id, false);
  _speakers.delete(user_id);
}

function _set_speaking(user_id, speaking) {
  const state = _speakers.get(user_id);
  if (state && state.speaking === speaking) return;
  if (state) state.speaking = speaking;
  _update_player_row(user_id);
  _refresh_token_indicators();
}

export function is_speaking(user_id) {
  return _speakers.get(user_id)?.speaking ?? false;
}

/* -------------------------------------------- */
/*  Token indicators                            */
/* -------------------------------------------- */

/** @type {Map<string, PIXI.Container>} indicator containers by token document UUID */
const _indicators = new Map();
let _icon_texture = null;
let _pulse_ticker = null;

/**
 * Which tokens should currently show a speaking cue: tokens that someone speaking speaks through,
 * if this client can actually hear that person (or it's your own voice)
 * @returns {Map<string, foundry.documents.User>} token UUID -> speaking user
 */
function _speaking_tokens() {
  const tokens = new Map();
  for (const [user_id, state] of _speakers) {
    if (!state.speaking) continue;
    const user = game.users.get(user_id);
    if (!user) continue;
    if (!user.isSelf && !(api().get_user_volume(user_id) > 0)) continue;
    for (const uuid of api().get_speaking_token_uuids(user)) tokens.set(uuid, user);
  }
  return tokens;
}

function _refresh_token_indicators() {
  if (!globalThis.canvas?.ready) return;
  const style = _speaking_style();
  const wanted = style === "none" ? new Map() : _speaking_tokens();
  for (const [uuid, container] of _indicators) {
    if (wanted.has(uuid) && !container.destroyed && container.parent && container.pvcStyle === style) continue;
    if (!container.destroyed) container.destroy({ children: true });
    _indicators.delete(uuid);
  }
  for (const [uuid, user] of wanted) {
    if (_indicators.has(uuid)) continue;
    const token = canvas.tokens.placeables.find(t => t.document.uuid === uuid);
    if (!token || token.destroyed) continue;
    const container = _draw_indicator(token, user, style);
    if (container) _indicators.set(uuid, container);
  }
  _update_pulse();
}

function _redraw_all_indicators() {
  for (const container of _indicators.values()) if (!container.destroyed) container.destroy({ children: true });
  _indicators.clear();
  _refresh_token_indicators();
}

/**
 * Draws a speaking cue as a child of the token, so it follows the token and is hidden whenever the token is
 * @param {foundry.canvas.placeables.Token} token
 * @param {foundry.documents.User} user
 * @param {string} style one of SPEAKING_STYLES
 * @returns {PIXI.Container | null}
 */
function _draw_indicator(token, user, style) {
  const color = Number(user.color);
  const w = token.w, h = token.h;
  const r = Math.max(w, h) / 2;
  const container = new PIXI.Container();
  container.pvcStyle = style;
  container.eventMode = "none";
  const icon = (size, x, y, tint) => {
    if (!_icon_texture) return;
    const sprite = new PIXI.Sprite(_icon_texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size;
    sprite.position.set(x, y);
    sprite.tint = tint;
    container.addChild(sprite);
  };
  if (style === "ring") {
    const width = Math.max(3, r * 0.08);
    const ring = new PIXI.Graphics();
    ring.lineStyle({ width, color, alpha: 1 });
    ring.drawCircle(w / 2, h / 2, r + width);
    container.addChild(ring);
  } else if (style === "icon") {
    const back = new PIXI.Graphics();
    back.beginFill(0x000000, 0.55).drawCircle(w / 2, h / 2, r * 0.42).endFill();
    container.addChild(back);
    icon(r * 0.6, w / 2, h / 2, color);
  } else if (style === "badge") {
    const badge_r = Math.max(8, r * 0.26);
    const x = w - badge_r * 0.6, y = badge_r * 0.6;
    const back = new PIXI.Graphics();
    back.lineStyle({ width: 2, color: 0x000000, alpha: 0.8 });
    back.beginFill(color, 1).drawCircle(x, y, badge_r).endFill();
    container.addChild(back);
    icon(badge_r * 1.3, x, y, 0xffffff);
  } else {
    return null;
  }
  token.addChild(container);
  return container;
}

function _update_pulse() {
  const active = _indicators.size > 0;
  if (active && !_pulse_ticker) {
    _pulse_ticker = () => {
      const alpha = 0.6 + 0.4 * Math.sin(Date.now() / 160);
      for (const container of _indicators.values()) if (!container.destroyed) container.alpha = alpha;
    };
    canvas.app.ticker.add(_pulse_ticker);
  } else if (!active && _pulse_ticker) {
    canvas.app.ticker.remove(_pulse_ticker);
    _pulse_ticker = null;
  }
}

/* -------------------------------------------- */
/*  Players list                                */
/* -------------------------------------------- */

/**
 * Marks players who hear everyone or are heard by everyone, so the table can see, e.g., that a recording user
 * is listening. GMs are left unmarked since that's their default.
 */
function _update_global_markers() {
  for (const row of ui.players?.element?.querySelectorAll("li.player") ?? []) {
    const user = game.users.get(row.dataset.userId);
    row.querySelector(".pvc-global-markers")?.remove();
    if (!user || user.isGM) continue;
    const markers = [];
    if (api().is_global_listener(user)) markers.push(["fa-solid fa-ear-listen", "proximity-voice-chat.UI.MarkerGlobalListener"]);
    if (api().is_global_speaker(user)) markers.push(["fa-solid fa-bullhorn", "proximity-voice-chat.UI.MarkerGlobalSpeaker"]);
    if (!markers.length) continue;
    const holder = document.createElement("span");
    holder.className = "pvc-global-markers";
    for (const [icon, tooltip] of markers) {
      const glyph = document.createElement("i");
      glyph.className = icon;
      glyph.dataset.tooltip = tooltip;
      holder.append(glyph);
    }
    row.append(holder);
  }
}

function _update_player_row(user_id) {
  const row = ui.players?.element?.querySelector(`li.player[data-user-id="${user_id}"]`);
  if (!row) return;
  if (!row.querySelector(".pvc-speaking-icon")) {
    const icon = document.createElement("i");
    icon.className = "pvc-speaking-icon fa-solid fa-volume-high";
    icon.inert = true;
    row.append(icon);
  }
  const speaking = is_speaking(user_id);
  row.classList.toggle("pvc-speaking", speaking);
  const user = game.users.get(user_id);
  // dim the cue for people you can't currently hear, e.g. out of earshot on the map
  const audible = !user || user.isSelf || api().get_user_volume(user_id) > 0;
  row.classList.toggle("pvc-inaudible", speaking && !audible);
}

/**
 * Voice bar actions that can also be bound to hotkeys (Configure Controls). Unbound by default.
 * @type {Record<string, {keybinding: string, label: string, gm: boolean, run: () => Promise<unknown> | unknown}>}
 */
const VOICE_ACTIONS = {
  mic: { keybinding: "toggleMic", label: "proximity-voice-chat.UI.Mic", gm: false, run: () => _toggle_mic() },
  deafen: { keybinding: "toggleDeafen", label: "proximity-voice-chat.UI.Deafen", gm: false, run: () => _toggle_deafen() },
  settings: { keybinding: "openAVSettings", label: "proximity-voice-chat.UI.AVSettings", gm: false, run: () => game.webrtc.config.render({ force: true }) },
  listen: { keybinding: "toggleGlobalListen", label: "proximity-voice-chat.UI.globalListen.Hover", gm: true, run: () => api().toggle_global_listener() },
  speak: { keybinding: "toggleGlobalSpeak", label: "proximity-voice-chat.UI.globalSpeak.Hover", gm: true, run: () => api().toggle_global_speaker() }
};

// registered synchronously in init, since Foundry refuses keybindings once its own keybinding setup has run
Hooks.once("init", () => {
  for (const action of Object.values(VOICE_ACTIONS)) {
    game.keybindings.register(MODULE_ID, action.keybinding, {
      name: action.label,
      editable: [],
      restricted: action.gm,
      onDown: () => {
        if (!_is_voice_active()) return false;
        Promise.resolve(action.run()).then(() => _refresh_voice_bar());
        return true;
      }
    });
  }
});

/**
 * A button's tooltip: what it does, plus its hotkeys if any are bound
 * @param {string} action a key of VOICE_ACTIONS
 * @returns {string}
 */
function _tooltip(action) {
  const { keybinding, label } = VOICE_ACTIONS[action];
  const text = game.i18n.localize(label);
  const humanize = foundry.applications.sidebar?.apps?.ControlsConfig?.humanizeBinding;
  const bindings = humanize ? (game.keybindings?.get(MODULE_ID, keybinding) ?? []).map(binding => humanize(binding)) : [];
  return bindings.length ? text + " (" + bindings.join(", ") + ")" : text;
}

function _make_button(action, icon, label, onclick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pvc-voice-button";
  button.dataset.pvcAction = action;
  const glyph = document.createElement("i");
  glyph.className = icon;
  glyph.inert = true;
  button.append(glyph);
  button.dataset.tooltip = _tooltip(action);
  button.setAttribute("aria-label", game.i18n.localize(label));
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await onclick();
    _refresh_voice_bar();
  });
  return button;
}

async function _toggle_mic() {
  const { muted, canBroadcastAudio } = game.webrtc.settings.getUser(game.user.id);
  if (muted && !canBroadcastAudio) return ui.notifications.warn("WEBRTC.WarningCannotEnableAudio", { localize: true });
  await game.webrtc.settings.set("client", `users.${game.user.id}.muted`, !muted);
}

async function _toggle_deafen() {
  await game.webrtc.settings.set("client", "muteAll", !game.webrtc.settings.client.muteAll);
}

const VOICE_ICONS = {
  mic: "fa-solid fa-microphone",
  deafen: "fa-solid fa-headphones",
  settings: "fa-solid fa-gear",
  listen: "fa-solid fa-podcast",
  speak: "fa-solid fa-bullhorn"
};

/**
 * Adds the voice control bar as the last row of the active players box, so it reads as part of the list
 * @param {HTMLElement} element the players list application element
 */
function _add_voice_bar(element) {
  element.querySelector(".pvc-voice-bar")?.remove();
  if (!_is_voice_active()) return;
  const active = element.querySelector("#players-active");
  // the active players box is itself a list in v14, so the bar goes in as a list item there
  const bar = document.createElement(["OL", "UL"].includes(active?.tagName) ? "li" : "div");
  bar.className = "pvc-voice-bar";
  for (const [action, { gm, label, run }] of Object.entries(VOICE_ACTIONS)) {
    if (gm && !game.user.isGM) continue;
    bar.append(_make_button(action, VOICE_ICONS[action], label, run));
  }
  const list = element.querySelector(".players-list");
  if (active) active.append(bar);
  else if (list) list.after(bar);
  else element.append(bar);
  _refresh_voice_bar();
}

function _refresh_voice_bar() {
  const bar = ui.players?.element?.querySelector(".pvc-voice-bar");
  if (!bar || !game.webrtc?.settings) return;
  const me = game.webrtc.settings.getUser(game.user.id);
  for (const button of bar.querySelectorAll(".pvc-voice-button")) button.dataset.tooltip = _tooltip(button.dataset.pvcAction);
  const set = (action, active, icon_on, icon_off) => {
    const button = bar.querySelector(`[data-pvc-action="${action}"]`);
    if (!button) return;
    button.classList.toggle("active", active);
    if (icon_on) button.querySelector("i").className = active ? icon_on : icon_off;
  };
  set("mic", !me?.muted, "fa-solid fa-microphone", "fa-solid fa-microphone-slash");
  set("deafen", !!game.webrtc.settings.client.muteAll, "fa-solid fa-ear-deaf", "fa-solid fa-headphones");
  if (game.user.isGM) {
    set("listen", api().is_global_listener(game.user));
    set("speak", api().is_global_speaker(game.user));
  }
}

function _open_volume_dialog(user) {
  const value = foundry.audio.AudioHelper.volumeToInput(game.webrtc.settings.getUser(user.id)?.volume ?? 1);
  const dialog = new foundry.applications.api.DialogV2({
    window: { title: game.i18n.format("proximity-voice-chat.UI.VolumeTitle", { name: user.name }), icon: "fa-solid fa-volume-high" },
    content: `<input type="range" class="pvc-volume" min="0" max="1" step="0.05" value="${value}">`,
    buttons: [{ action: "close", label: "Close", default: true }]
  });
  dialog.render({ force: true }).then(() => {
    dialog.element.querySelector(".pvc-volume")?.addEventListener("input", (event) => {
      const volume = foundry.audio.AudioHelper.inputToVolume(Number(event.target.value));
      game.webrtc.settings.set("client", `users.${user.id}.volume`, volume);
    });
  });
}

/* -------------------------------------------- */
/*  Speaker list checkboxes                     */
/* -------------------------------------------- */

/**
 * Replaces a comma-separated user UUID field with a checkbox per user. The field stays in the form, hidden, so the
 * flag keeps its comma-separated format; the checkboxes rewrite it.
 * @param {HTMLInputElement} input
 * @param {Set<string>} locked user UUIDs that always count and can't be unticked here, e.g. owners for speakers
 */
function _add_user_choices(input, locked = new Set()) {
  if (!input || input.type === "hidden") return;
  const listed = new Set(input.value.split(/\s*,\s*/).filter(Boolean));
  input.type = "hidden";
  const choices = document.createElement("div");
  choices.className = "pvc-user-choices";
  for (const user of game.users) {
    const is_locked = locked.has(user.uuid);
    const label = document.createElement("label");
    label.className = "pvc-user-choice";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = user.uuid;
    box.checked = is_locked || listed.has(user.uuid);
    box.disabled = input.disabled || is_locked;
    box.addEventListener("change", () => {
      // keep any entries that aren't current users, e.g. deleted users or UUIDs set by a macro
      const unknown = input.value.split(/\s*,\s*/).filter(uuid => uuid && !game.users.some(u => u.uuid === uuid));
      const checked = Array.from(choices.querySelectorAll("input")).filter(b => b.checked && !b.disabled).map(b => b.value);
      input.value = [...unknown, ...checked].join(", ");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const swatch = document.createElement("span");
    swatch.className = "pvc-user-swatch";
    swatch.style.backgroundColor = user.color?.css ?? "";
    const name = document.createElement("span");
    name.textContent = user.name + (user.isGM ? " [" + game.i18n.localize("USER.GM") + "]" : "")
      + (is_locked ? " (" + game.i18n.localize("proximity-voice-chat.Token.Owner") + ")" : "");
    label.append(box, swatch, name);
    choices.append(label);
  }
  input.after(choices);
}

/**
 * Adds the speaker and listener checkboxes to a token's Proximity tab. Owners always speak through their tokens
 * (see get_owner_speakers), so they show ticked and locked in the speaker list.
 * @param {foundry.applications.api.ApplicationV2} application a TokenConfig or PrototypeTokenConfig
 * @param {HTMLElement} element
 */
function _add_token_user_choices(application, element) {
  const actor = application.document?.baseActor ?? application.actor ?? null;
  const owners = new Set(api().get_owner_speakers(actor).map(user => user.uuid));
  _add_user_choices(element.querySelector('input[name="flags.proximity-voice-chat.userlist"]'), owners);
  _add_user_choices(element.querySelector('input[name="flags.proximity-voice-chat.listenlist"]'));
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.on("renderTokenConfig", _add_token_user_choices);
Hooks.on("renderPrototypeTokenConfig", _add_token_user_choices);

Hooks.once("ready", async () => {
  _apply_dock_visibility();
  try {
    _icon_texture = await foundry.canvas.loadTexture(SPEAKING_ICON);
  } catch (err) {
    console.warn(MODULE_ID + " | could not load the speaking icon", err);
  }
  _reconcile_speakers();
  setInterval(() => {
    _reconcile_speakers();
    _refresh_token_indicators();
    for (const user_id of _speakers.keys()) _update_player_row(user_id);
    _refresh_voice_bar();// picks up hotkeys rebound in Configure Controls
  }, 1000);
});

Hooks.on("renderPlayers", (_application, element, _context, _options) => {
  _add_voice_bar(element);
  _update_global_markers();
  for (const user_id of _speakers.keys()) _update_player_row(user_id);
});

Hooks.on("getUserContextOptions", (_application, options) => {
  options.push(
    {
      label: "proximity-voice-chat.UI.Volume",
      icon: "fa-solid fa-volume-high",
      visible: li => _is_voice_active() && li.dataset.userId !== game.user.id && !!game.users.get(li.dataset.userId)?.active,
      onClick: (_event, li) => _open_volume_dialog(game.users.get(li.dataset.userId))
    },
    ...[
      ["proximity-voice-chat.UI.GlobalListenOn", "fa-solid fa-ear-listen", "is_global_listener", "set_global_listener", true],
      ["proximity-voice-chat.UI.GlobalListenOff", "fa-solid fa-ear-deaf", "is_global_listener", "set_global_listener", false],
      ["proximity-voice-chat.UI.GlobalSpeakOn", "fa-solid fa-bullhorn", "is_global_speaker", "set_global_speaker", true],
      ["proximity-voice-chat.UI.GlobalSpeakOff", "fa-solid fa-volume-xmark", "is_global_speaker", "set_global_speaker", false]
    ].map(([label, icon, is, set, enable]) => ({
      label,
      icon,
      // e.g. a user that records the session hears everyone; your own toggles are on the voice bar
      visible: li => {
        const user = game.users.get(li.dataset.userId);
        return _is_voice_active() && game.user.isGM && !!user && !user.isSelf && api()[is](user) !== enable;
      },
      onClick: async (_event, li) => {
        const user = game.users.get(li.dataset.userId);
        await api()[set](user, enable);
        ui.notifications.info(game.i18n.format(label + "Notice", { name: user.name }));
      }
    })),
    {
      label: "WEBRTC.TooltipBlockUserAudio",
      icon: "fa-solid fa-microphone-slash",
      visible: li => _is_voice_active() && game.user.isGM && li.dataset.userId !== game.user.id
        && !!game.webrtc.settings.getUser(li.dataset.userId)?.canBroadcastAudio,
      onClick: (_event, li) => game.users.get(li.dataset.userId)?.update({ "permissions.BROADCAST_AUDIO": false })
    },
    {
      label: "WEBRTC.TooltipAllowUserAudio",
      icon: "fa-solid fa-microphone",
      visible: li => _is_voice_active() && game.user.isGM && li.dataset.userId !== game.user.id
        && game.webrtc.settings.getUser(li.dataset.userId)?.canBroadcastAudio === false,
      onClick: (_event, li) => game.users.get(li.dataset.userId)?.update({ "permissions.BROADCAST_AUDIO": true })
    }
  );
});

Hooks.on("rtcSettingsChanged", () => {
  _refresh_voice_bar();
  _reconcile_speakers();
});

Hooks.on("updateUser", (user, changed) => {
  if (!changed.flags?.[MODULE_ID]) return;
  if (user.isSelf) _refresh_voice_bar();
  _update_global_markers();
});

Hooks.on("userConnected", () => _reconcile_speakers());

// the token redraws (e.g. after an image change) destroy its children, so re-attach the cue
Hooks.on("drawToken", () => _refresh_token_indicators());

Hooks.on("canvasTearDown", () => {
  for (const container of _indicators.values()) if (!container.destroyed) container.destroy({ children: true });
  _indicators.clear();
  if (_pulse_ticker) canvas.app?.ticker.remove(_pulse_ticker);
  _pulse_ticker = null;
});

Hooks.on("canvasReady", () => _refresh_token_indicators());

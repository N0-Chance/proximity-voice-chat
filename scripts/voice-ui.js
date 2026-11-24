/**
 * Replaces Foundry's camera dock for audio-only proximity play: speaking cues on tokens and in the players list,
 * and voice controls at the bottom of the players list.
 *
 * Talks to proximity-voice-chat.js only through game.modules.get(MODULE_ID).api, at runtime, so there is no
 * circular import between the two files.
 */
const MODULE_ID = "proximity-voice-chat";

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const UI_SCRIPT_VERSION = "2.0.0";

export const SPEAKING_STYLES = {
  ring: "proximity-voice-chat.Settings.SpeakingIndicator.Ring",
  icon: "proximity-voice-chat.Settings.SpeakingIndicator.Icon",
  badge: "proximity-voice-chat.Settings.SpeakingIndicator.Badge",
  none: "proximity-voice-chat.Settings.SpeakingIndicator.None"
};

/** How long someone counts as still speaking after their audio drops below the threshold */
const SPEAKING_HOLD_MS = 400;
const LEVEL_REPORT_INTERVAL_MS = 100;
/** Font Awesome ships with Foundry (v14: Font Awesome 7 Pro); canvas cues draw its glyphs as text */
const ICON_FONT = ["Font Awesome 7 Pro", "Font Awesome 6 Pro", "Font Awesome 7 Free", "Font Awesome 6 Free"];

/** Per voice mode: canvas glyph, Font Awesome class, size relative to Normal, and pulse */
const MODE_LOOKS = {
  whisper: { glyph: "\ue38c", icon: "fa-solid fa-face-shush", list: "fa-solid fa-volume-low", scale: 0.75, pulse: { base: 0.45, depth: 0.25, period: 320 } },
  normal: { glyph: "\uf028", icon: "fa-solid fa-comment", list: "fa-solid fa-volume-high", scale: 1, pulse: { base: 0.6, depth: 0.4, period: 160 } },
  yell: { glyph: "\uf675", icon: "fa-solid fa-megaphone", list: "fa-solid fa-megaphone", scale: 1.25, pulse: { base: 0.75, depth: 0.25, period: 80 } }
};
const RIPPLE_MS = 700;
/** Speech you can see but can't hear: the lips move, the words don't arrive. A speech bubble with "...", faint and slow. */
const UNHEARD_LOOK = { glyph: "\uf4ad", icon: "fa-solid fa-comment-dots", scale: 0.85, pulse: { base: 0.3, depth: 0.15, period: 600 } };
/** Quietest to loudest: several people on one token show the loudest of their modes */
const MODE_ORDER = ["whisper", "normal", "yell"];
/** About how many arcs a ring is cut into when several people speak through one token, so it reads as checkered */
const RING_SEGMENTS = 24;

/** How long a hotkey must be held to count as "hold to whisper/yell" rather than a tap that switches and stays */
const HOLD_MS = 400;
const REACH_PREVIEW_MS = 2000;

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
let _pulse_ticker = null;

/**
 * Which tokens should currently show a speaking cue, and for whom. Heard: people this client can hear, and your own
 * voice. Unheard: people speaking through a token in earshot of nobody you speak for, shown faintly ("lips moving").
 * A whisper you can't hear stays private and isn't listed at all. Users are in game.users order, so the colours on a
 * shared token keep their places.
 * @returns {Map<string, {heard: Array<foundry.documents.User>, unheard: Array<foundry.documents.User>}>} by token UUID
 */
function _speaking_tokens() {
  const tokens = new Map();
  for (const user of game.users) {
    if (!is_speaking(user.id)) continue;
    const heard = user.isSelf || api().get_user_volume(user.id) > 0;
    if (!heard && api().get_voice_mode(user) === "whisper") continue;
    for (const uuid of api().get_speaking_token_uuids(user)) {
      if (!tokens.has(uuid)) tokens.set(uuid, { heard: [], unheard: [] });
      tokens.get(uuid)[heard ? "heard" : "unheard"].push(user);
    }
  }
  return tokens;
}

/**
 * What a token's cue shows. If anyone on it is heard, the cue is theirs, in the loudest of their modes; otherwise
 * it's the faint "can't hear" cue for everyone speaking there.
 * @param {{heard: Array<foundry.documents.User>, unheard: Array<foundry.documents.User>}} speakers
 * @param {string} style one of SPEAKING_STYLES
 * @returns {{heard: boolean, mode: string, colors: Array<number>, key: string}} key changes whenever the drawing would
 */
function _cue_for(speakers, style) {
  const heard = speakers.heard.length > 0;
  const users = heard ? speakers.heard : speakers.unheard;
  const mode = heard
    ? users.map(user => api().get_voice_mode(user)).reduce((a, b) => (MODE_ORDER.indexOf(b) > MODE_ORDER.indexOf(a) ? b : a))
    : "normal";
  const colors = users.map(user => Number(user.color));
  return { heard, mode, colors, key: [style, heard ? "heard" : "unheard", mode, ...users.map((user, i) => user.id + ":" + colors[i])].join("|") };
}

function _refresh_token_indicators() {
  if (!globalThis.canvas?.ready) return;
  const style = _speaking_style();
  const wanted = style === "none" ? new Map() : _speaking_tokens();
  for (const [uuid, container] of _indicators) {
    const speakers = wanted.get(uuid);
    const current = speakers && !container.destroyed && container.parent && container.pvcKey === _cue_for(speakers, style).key;
    if (current) continue;
    if (!container.destroyed) container.destroy({ children: true });
    _indicators.delete(uuid);
  }
  for (const [uuid, speakers] of wanted) {
    if (_indicators.has(uuid)) continue;
    const token = canvas.tokens.placeables.find(t => t.document.uuid === uuid);
    if (!token || token.destroyed) continue;
    const container = _draw_indicator(token, _cue_for(speakers, style), style);
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
 * A Font Awesome glyph drawn on the canvas
 * @param {string} glyph
 * @param {number} size in pixels
 * @param {number} color
 * @returns {PIXI.Text}
 */
function _glyph(glyph, size, color) {
  const text = new PIXI.Text(glyph, { fontFamily: ICON_FONT, fontWeight: "900", fontSize: Math.max(8, Math.round(size)), fill: color });
  text.anchor.set(0.5);
  return text;
}

/**
 * Strokes a circle in one colour, or, for several, in arcs that take turns through the colours (a checkered ring)
 * @param {PIXI.Graphics} graphics
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} width
 * @param {Array<number>} colors
 */
function _ring(graphics, x, y, radius, width, colors) {
  if (colors.length < 2) {
    graphics.lineStyle({ width, color: colors[0], alpha: 1 });
    graphics.drawCircle(x, y, radius);
    return;
  }
  const count = Math.ceil(RING_SEGMENTS / colors.length) * colors.length;
  for (let i = 0; i < count; i++) {
    // from the top, clockwise
    const start = (i / count) * Math.PI * 2 - Math.PI / 2;
    const end = ((i + 1) / count) * Math.PI * 2 - Math.PI / 2;
    graphics.lineStyle({ width, color: colors[i % colors.length], alpha: 1 });
    graphics.moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius);
    graphics.arc(x, y, radius, start, end);
  }
}

/**
 * A ring that expands and fades on a loop (see _update_pulse), drawn around (0, 0) so it can scale from its centre
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} width
 * @param {Array<number>} colors
 * @returns {PIXI.Graphics}
 */
function _ripple(x, y, radius, width, colors) {
  const ripple = new PIXI.Graphics();
  _ring(ripple, 0, 0, radius, width, colors);
  ripple.position.set(x, y);
  ripple.pvcRipple = true;
  return ripple;
}

/**
 * Draws a speaking cue as a child of the token, so it follows the token and is hidden whenever the token is.
 * Whisper is smaller and softer (a dotted ring); Yell is bigger, faster, and ripples outward. Speech you can't hear
 * is a thin ring, or a speech bubble with "...", pulsing faintly. Several people at once share the cue's colours.
 * @param {foundry.canvas.placeables.Token} token
 * @param {ReturnType<typeof _cue_for>} cue
 * @param {string} style one of SPEAKING_STYLES
 * @returns {PIXI.Container | null}
 */
function _draw_indicator(token, cue, style) {
  const { heard, mode, colors } = cue;
  const several = colors.length > 1;
  const look = heard ? (MODE_LOOKS[mode] ?? MODE_LOOKS.normal) : UNHEARD_LOOK;
  const w = token.w, h = token.h;
  const r = Math.max(w, h) / 2;
  const container = new PIXI.Container();
  container.pvcStyle = style;
  container.pvcMode = mode;
  container.pvcHeard = heard;
  container.pvcKey = cue.key;
  container.pvcPulse = look.pulse;
  container.eventMode = "none";
  if (style === "ring") {
    const width = Math.max(3, r * 0.08);
    const ring = new PIXI.Graphics();
    if (!heard) {
      // a thin line where the ring would be: someone's talking there, but it doesn't reach you
      _ring(ring, w / 2, h / 2, r + width, Math.max(1.5, r * 0.025), colors);
    } else if (mode === "whisper") {
      // a dotted ring: quieter, and recognisable without relying on colour
      const dots = Math.max(colors.length, Math.round(28 / colors.length) * colors.length), dot = Math.max(1.5, width * 0.45);
      for (let i = 0; i < dots; i++) {
        const angle = (i / dots) * Math.PI * 2 - Math.PI / 2;
        ring.beginFill(colors[i % colors.length], 1);
        ring.drawCircle(w / 2 + Math.cos(angle) * (r + width), h / 2 + Math.sin(angle) * (r + width), dot);
        ring.endFill();
      }
    } else {
      const ring_width = mode === "yell" ? width * 1.6 : width;
      _ring(ring, w / 2, h / 2, r + ring_width, ring_width, colors);
    }
    container.addChild(ring);
    if (heard && mode === "yell") container.addChild(_ripple(w / 2, h / 2, r + width * 2.5, width, colors));
  } else if (style === "icon") {
    const size = r * 0.6 * look.scale;
    const back = new PIXI.Graphics();
    back.beginFill(0x000000, 0.55).drawCircle(w / 2, h / 2, size * 0.7).endFill();
    // several people: a white glyph inside a checkered rim in their colours
    if (several) _ring(back, w / 2, h / 2, size * 0.7, Math.max(2, size * 0.08), colors);
    container.addChild(back);
    const glyph = _glyph(look.glyph, size, several ? 0xffffff : colors[0]);
    glyph.position.set(w / 2, h / 2);
    container.addChild(glyph);
    if (heard && mode === "yell") container.addChild(_ripple(w / 2, h / 2, size * 0.75, Math.max(2, size * 0.06), colors));
  } else if (style === "badge") {
    const badge_r = Math.max(8, r * 0.26) * look.scale;
    const x = w - badge_r * 0.6, y = badge_r * 0.6;
    const back = new PIXI.Graphics();
    if (several) {
      // checkering is too small to read on a badge, so it's split into one wedge per person
      for (let i = 0; i < colors.length; i++) {
        const start = (i / colors.length) * Math.PI * 2 - Math.PI / 2;
        const end = ((i + 1) / colors.length) * Math.PI * 2 - Math.PI / 2;
        back.beginFill(colors[i], 1).moveTo(x, y).arc(x, y, badge_r, start, end).lineTo(x, y).endFill();
      }
      back.lineStyle({ width: 2, color: 0x000000, alpha: 0.8 }).drawCircle(x, y, badge_r);
    } else {
      back.lineStyle({ width: 2, color: 0x000000, alpha: 0.8 });
      back.beginFill(colors[0], 1).drawCircle(x, y, badge_r).endFill();
    }
    container.addChild(back);
    const glyph = _glyph(look.glyph, badge_r * 1.1, 0xffffff);
    glyph.position.set(x, y);
    container.addChild(glyph);
    if (heard && mode === "yell") container.addChild(_ripple(x, y, badge_r * 1.15, 2, colors));
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
      const now = Date.now();
      for (const container of _indicators.values()) {
        if (container.destroyed) continue;
        const { base, depth, period } = container.pvcPulse ?? MODE_LOOKS.normal.pulse;
        container.alpha = base + depth * Math.sin(now / period);
        for (const child of container.children) {
          if (!child.pvcRipple) continue;
          const phase = (now % RIPPLE_MS) / RIPPLE_MS;
          child.scale.set(1 + 0.35 * phase);
          child.alpha = 1 - phase;
        }
      }
    };
    canvas.app.ticker.add(_pulse_ticker);
  } else if (!active && _pulse_ticker) {
    canvas.app.ticker.remove(_pulse_ticker);
    _pulse_ticker = null;
  }
}

/* -------------------------------------------- */
/*  Voice modes                                 */
/* -------------------------------------------- */

let _reach_preview = null;
let _suppress_preview = false;

/**
 * Briefly outlines where your voice now carries, walls included, on every token you speak through.
 * Only you see it. With Global Speaking on, everyone hears you anyway, so you're told that instead.
 * @param {string} mode
 */
function _preview_reach(mode) {
  _reach_preview?.destroy({ children: true });
  _reach_preview = null;
  if (api().is_global_speaker(game.user)) {
    if (mode !== "normal") ui.notifications.info("proximity-voice-chat.UI.ModeGlobalSpeaking", { localize: true });
    return;
  }
  if (!globalThis.canvas?.ready || !canvas.interface) return;
  const shapes = api().get_voice_reach(game.user);
  if (!shapes.length) return;
  const color = Number(game.user.color);
  const preview = new PIXI.Graphics();
  preview.eventMode = "none";
  for (const shape of shapes) {
    preview.lineStyle({ width: 2, color, alpha: 0.9 });
    preview.beginFill(color, 0.08).drawPolygon(shape.points).endFill();
  }
  // with sound propagation the voice also gets through and round walls, muffled, as far as this fainter circle
  for (const { x, y, radius } of api().get_voice_range(game.user)) {
    preview.lineStyle({ width: 1, color, alpha: 0.45 });
    preview.drawCircle(x, y, radius);
  }
  canvas.interface.addChild(preview);
  _reach_preview = preview;
  const started = Date.now();
  const fade = () => {
    if (preview.destroyed) return canvas.app.ticker.remove(fade);
    const t = (Date.now() - started) / REACH_PREVIEW_MS;
    if (t >= 1) {
      canvas.app.ticker.remove(fade);
      preview.destroy({ children: true });
      if (_reach_preview === preview) _reach_preview = null;
      return;
    }
    preview.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  };
  canvas.app.ticker.add(fade);
}

function _cycle_voice_mode() {
  const order = ["normal", "whisper", "yell"];
  const current = api().get_voice_mode(game.user);
  api().set_voice_mode(order[(order.indexOf(current) + 1) % order.length]);
}

/** The hotkey currently held down, to tell a tap (switch and stay) from a hold (switch back on release) */
let _held = null;

/**
 * @param {string} target "whisper" or "yell"
 */
function _mode_key_down(target) {
  const current = api().get_voice_mode(game.user);
  _held = { target, previous: current, at: Date.now() };
  if (current !== target) api().set_voice_mode(target);
}

function _mode_key_up() {
  const held = _held;
  _held = null;
  if (!held) return;
  const long = Date.now() - held.at >= HOLD_MS;
  if (held.previous === held.target) {
    // tapping the key for the mode you're already in switches back to Normal
    if (!long) api().set_voice_mode("normal");
  } else if (long) {
    // held while talking: go back to whatever you had before, without flashing the reach again
    _suppress_preview = true;
    api().set_voice_mode(held.previous);
    _suppress_preview = false;
  }
}

Hooks.on("proximityVoiceModeChanged", (user, mode) => {
  if (user?.isSelf) {
    _refresh_voice_bar();
    _update_own_mode_tag();
    if (!_suppress_preview) _preview_reach(mode);
  }
  if (user) _update_player_row(user.id);
  _refresh_token_indicators();
});

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

/**
 * Keeps your own row showing your voice mode while it isn't Normal, even when you're silent, so you don't forget
 */
function _update_own_mode_tag() {
  const row = ui.players?.element?.querySelector(`li.player[data-user-id="${game.user.id}"]`);
  if (!row) return;
  row.querySelector(".pvc-mode-tag")?.remove();
  const mode = api().get_voice_mode(game.user);
  if (mode === "normal") return;
  const tag = document.createElement("i");
  tag.className = "pvc-mode-tag pvc-mode-" + mode + " " + MODE_LOOKS[mode].icon;
  tag.dataset.tooltip = "proximity-voice-chat.UI.Mode." + mode;
  row.append(tag);
}

function _update_player_row(user_id) {
  const row = ui.players?.element?.querySelector(`li.player[data-user-id="${user_id}"]`);
  if (!row) return;
  let icon = row.querySelector(".pvc-speaking-icon");
  if (!icon) {
    icon = document.createElement("i");
    icon.inert = true;
    row.append(icon);
  }
  const user = game.users.get(user_id);
  const mode = user ? api().get_voice_mode(user) : "normal";
  const audible = !user || user.isSelf || api().get_user_volume(user_id) > 0;
  // out of earshot: the same "lips moving" bubble as on the token
  icon.className = "pvc-speaking-icon " + (audible ? (MODE_LOOKS[mode] ?? MODE_LOOKS.normal).list : UNHEARD_LOOK.icon);
  // a whisper you can't hear stays private: no cue at all. Other speech out of earshot shows dimmed.
  const speaking = is_speaking(user_id) && (audible || mode !== "whisper");
  row.classList.toggle("pvc-speaking", speaking);
  row.classList.toggle("pvc-inaudible", speaking && !audible);
}

/**
 * Voice bar actions that can also be bound to hotkeys (Configure Controls). Unbound by default.
 * @type {Record<string, {keybinding: string, label: string, gm: boolean, run: () => Promise<unknown> | unknown}>}
 */
const VOICE_ACTIONS = {
  mic: { keybinding: "toggleMic", label: "proximity-voice-chat.UI.Mic", gm: false, run: () => _toggle_mic() },
  // cycles Normal -> Whisper -> Yell; right-click returns to Normal. Its hotkeys are the Whisper and Yell keys below.
  mode: { keybinding: null, label: "proximity-voice-chat.UI.VoiceMode", gm: false, run: () => _cycle_voice_mode() },
  deafen: { keybinding: "toggleDeafen", label: "proximity-voice-chat.UI.Deafen", gm: false, run: () => _toggle_deafen() },
  settings: { keybinding: "openAVSettings", label: "proximity-voice-chat.UI.AVSettings", gm: false, run: () => game.webrtc.config.render({ force: true }) },
  listen: { keybinding: "toggleGlobalListen", label: "proximity-voice-chat.UI.globalListen.Hover", gm: true, run: () => api().toggle_global_listener() },
  speak: { keybinding: "toggleGlobalSpeak", label: "proximity-voice-chat.UI.globalSpeak.Hover", gm: true, run: () => api().toggle_global_speaker() }
};

// registered synchronously in init, since Foundry refuses keybindings once its own keybinding setup has run
Hooks.once("init", () => {
  for (const [mode, keybinding] of [["whisper", "whisper"], ["yell", "yell"]]) {
    game.keybindings.register(MODULE_ID, keybinding, {
      name: "proximity-voice-chat.Keybindings." + keybinding,
      hint: "proximity-voice-chat.Keybindings.ModeHint",
      editable: [],
      onDown: () => {
        if (!_is_voice_active()) return false;
        _mode_key_down(mode);
        return true;
      },
      onUp: () => {
        _mode_key_up();
        return true;
      }
    });
  }
  for (const action of Object.values(VOICE_ACTIONS)) {
    if (!action.keybinding) continue;
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
  const humanize = foundry.applications.sidebar?.apps?.ControlsConfig?.humanizeBinding;
  const keys = name => humanize ? (game.keybindings?.get(MODULE_ID, name) ?? []).map(binding => humanize(binding)) : [];
  if (action === "mode") {
    const mode = api().get_voice_mode(game.user);
    let text = game.i18n.format(label, { mode: game.i18n.localize("proximity-voice-chat.UI.Mode." + mode) });
    const hints = ["whisper", "yell"].map(name => [name, keys(name)]).filter(([, bound]) => bound.length)
      .map(([name, bound]) => game.i18n.localize("proximity-voice-chat.UI.Mode." + name) + ": " + bound.join(", "));
    return hints.length ? text + " (" + hints.join("; ") + ")" : text;
  }
  const text = game.i18n.localize(label);
  const bindings = keys(keybinding);
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
  if (action === "mode") {
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      api().set_voice_mode("normal");
    });
  }
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
  mode: MODE_LOOKS.normal.icon,
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
  const mode_button = bar.querySelector('[data-pvc-action="mode"]');
  if (mode_button) {
    const mode = api().get_voice_mode(game.user);
    mode_button.querySelector("i").className = (MODE_LOOKS[mode] ?? MODE_LOOKS.normal).icon;
    mode_button.classList.toggle("pvc-mode-whisper", mode === "whisper");
    mode_button.classList.toggle("pvc-mode-yell", mode === "yell");
  }
  set("deafen", !!game.webrtc.settings.client.muteAll, "fa-solid fa-ear-deaf", "fa-solid fa-headphones");
  if (game.user.isGM) {
    set("listen", api().is_global_listener(game.user));
    set("speak", api().is_global_speaker(game.user));
  }
}

/**
 * A slider for how loud one person is for you. On the advanced audio path it goes up to 200%; the old path plays
 * through a media element, which can't go past 100%.
 * @param {foundry.documents.User} user
 */
function _open_volume_dialog(user) {
  const max = api().get_audio_status().path === "advanced" ? 2 : 1;
  const value = Math.min(max, api().get_user_voice_volume(user.id));
  const percent = volume => Math.round(volume * 100) + "%";
  const dialog = new foundry.applications.api.DialogV2({
    window: { title: game.i18n.format("proximity-voice-chat.UI.VolumeTitle", { name: user.name }), icon: "fa-solid fa-volume-high" },
    content: `<input type="range" class="pvc-volume" min="0" max="${max}" step="0.05" value="${value}">`
      + `<output class="pvc-volume-value">${percent(value)}</output>`,
    buttons: [{ action: "close", label: "Close", default: true }]
  });
  dialog.render({ force: true }).then(() => {
    dialog.element.querySelector(".pvc-volume")?.addEventListener("input", (event) => {
      const volume = Number(event.target.value);
      const readout = dialog.element.querySelector(".pvc-volume-value");
      if (readout) readout.textContent = percent(volume);
      api().set_user_voice_volume(user.id, volume);
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
  // canvas text only renders the icon font once the browser has loaded it
  try {
    await document.fonts?.load(`900 32px "${ICON_FONT[0]}"`);
  } catch (err) {
    console.warn(MODULE_ID + " | could not load the icon font", err);
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
  _update_own_mode_tag();
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

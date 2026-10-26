import { register_voice_ui_settings, UI_SCRIPT_VERSION } from "./voice-ui.js";

export const MODULE_ID = "proximity-voice-chat";

/**
 * The version this script was released as, kept in step with module.json by tools/release.sh.
 * Compared against the installed module's version to catch browsers running a stale cached copy.
 */
const SCRIPT_VERSION = "1.3.0";

/**
 * The different types with which a radius can be measured
 * @enum {number}
 */
export const RADIUS_TYPE = {
  PIXELS: 0,
  TILES: 1
}

/**
 * Gets a token's userlist
 * @param {foundry.documents.TokenDocument} token the token whose userlist will be retrieved
 * @returns {string | undefined} the token's userlist, which is string representing a comma separated list of user UUIDs, or undefined if the token doesn't have a userlist
 */
export function get_userlist(token) {
  return token.getFlag(MODULE_ID, "userlist");
}

/**
 * Sets a token's userlist
 * @param {foundry.documents.TokenDocument} token the token whose userlist will be overwritten
 * @param {string} userlist the new userlist
 * @returns {Promise} the result of foundry.documents.TokenDocument#setFlag
 */
export function set_userlist(token, userlist) {
  return token.setFlag(MODULE_ID, "userlist", userlist);
}

/**
 * Checks if a user is in a token's userlist
 * @param {foundry.documents.TokenDocument} token the token whose userlist will be checked
 * @param {string} user_uuid the UUID of the user to check for
 * @returns {boolean} whether the user is in the token's userlist or not
 */
export function is_user_in_userlist(token, user_uuid) {
  let userlist = token.getFlag(MODULE_ID, "userlist");
  if (!userlist) return false;
  const comma_splitter = /\s*,\s*/;
  let userlist_array = userlist.split(comma_splitter);
  return userlist_array.includes(user_uuid);
}

/**
 * Adds a user to a token's userlist
 * @param {foundry.documents.TokenDocument} token the token for which the user will be added as a speaker
 * @param {string} user_uuid the UUID of the user to add to the token's userlist
 * @returns {Promise} the result of foundry.documents.TokenDocument#setFlag
 */
export function add_user_to_userlist(token, user_uuid) {
  let userlist = token.getFlag(MODULE_ID, "userlist");
  if (!userlist) {
    return token.setFlag(MODULE_ID, "userlist", user_uuid);
  }
  const comma_splitter = /\s*,\s*/;
  let userlist_array = userlist.split(comma_splitter);
  if (!userlist_array.includes(user_uuid)) {
    userlist_array.push(user_uuid);
  }
  return token.setFlag(MODULE_ID, "userlist", userlist_array.join(","));
}

/**
 * Removes a user from a token's userlist
 * @param {foundry.documents.TokenDocument} token the token for which the user will be removed from being a speaker
 * @param {string} user_uuid the UUID of the user to remove from the token's userlist
 * @returns {Promise | void} the result of foundry.documents.TokenDocument#setFlag if the token had a userlist, otherwise nothing
 */
export function remove_user_from_userlist(token, user_uuid) {
  let userlist = token.getFlag(MODULE_ID, "userlist");
  if (!userlist) return;
  const comma_splitter = /\s*,\s*/;
  let userlist_array = userlist.split(comma_splitter).filter(uuid => uuid !== user_uuid).join(",");
  return token.setFlag(MODULE_ID, "userlist", userlist_array);
}

/**
 * Gets a token's calculated proximity radius, which is either the token's radius, the scene's radius, or the game setting default radius, in that order of precedence
 * @param {foundry.documents.TokenDocument} token the token for who its proximity radius will be calculated
 * @returns {number} the token's proximity radius in the token's radius type
 */
export function get_calculated_token_radius(token) {
  return token.getFlag(MODULE_ID, "radius") ?? token.parent.getFlag(MODULE_ID, "radius") ?? game.settings.get(MODULE_ID, "defaultProximityRadius");
}

/**
 * Gets the type of a token's calculated proximity radius, which is a value of RADIUS_TYPE
 * @param {foundry.documents.TokenDocument} token the token for who its proximity radius type will be gotten
 * @returns {RADIUS_TYPE} the token's proximity radius type
 */
export function get_calculated_token_radius_type(token) {
  if (token.getFlag(MODULE_ID, "radius") != null) return token.getFlag(MODULE_ID, "radius_type") ?? RADIUS_TYPE.PIXELS;
  if (token.parent.getFlag(MODULE_ID, "radius") != null) return token.parent.getFlag(MODULE_ID, "radius_type") ?? RADIUS_TYPE.PIXELS;
  return game.settings.get(MODULE_ID, "defaultProximityRadiusType") ?? RADIUS_TYPE.PIXELS;
}

/**
 * Gets a token's proximity radius if it has one
 * @param {foundry.documents.TokenDocument} token the token whose proximity radius will be retrieved
 * @returns {number | undefined} the token's proximity radius in the token's radius type, or undefined if the token doesn't have a specified proximity radius
 */
export function get_token_radius(token) {
  return token.getFlag(MODULE_ID, "radius");
}

/**
 * Gets a token's proximity radius type if it has one, or defaults to RADIUS_TYPE.PIXELS
 * @param {foundry.documents.TokenDocument} token the token whose proximity radius type will be retrieved
 * @returns {RADIUS_TYPE} the token's proximity radius type
 */
export function get_token_radius_type(token) {
  return token.getFlag(MODULE_ID, "radius_type") ?? RADIUS_TYPE.PIXELS;
}

/**
 * Sets a token's proximity radius
 * @param {foundry.documents.TokenDocument} token the token whose proximity radius will be overwritten
 * @param {number | null} radius the new proximity radius, set to null to unset the token's radius and use the scene's default radius instead
 * @returns {Promise} the result of foundry.documents.TokenDocument#setFlag
 */
export function set_token_radius(token, radius) {
  return token.setFlag(MODULE_ID, "radius", radius);
}

/**
 * Sets a token's proximity radius type
 * @param {foundry.documents.TokenDocument} token the token whose proximity radius will be overwritten
 * @param {RADIUS_TYPE} radius_type the new proximity radius type, a value of RADIUS_TYPE
 * @returns {Promise} the result of foundry.documents.TokenDocument#setFlag
 */
export function set_token_radius_type(token, radius_type) {
  return token.setFlag(MODULE_ID, "radius_type", radius_type);
}

/**
 * Gets a scene's default proximity radius if it has one
 * @param {foundry.documents.Scene} scene the scene whose proximity radius will be retrieved
 * @returns {number | undefined} the scene's proximity radius in the scene's radius type, or undefined if the scene doesn't have a specified proximity radius
 */
export function get_scene_radius(scene) {
  return scene.getFlag(MODULE_ID, "radius");
}

/**
 * Gets a scene's proximity radius type if it has one, or defaults to RADIUS_TYPE.PIXELS
 * @param {foundry.documents.Scene} scene the scene whose proximity radius type will be retrieved
 * @returns {RADIUS_TYPE} the scene's proximity radius type
 */
export function get_scene_radius_type(scene) {
  return scene.getFlag(MODULE_ID, "radius_type") ?? RADIUS_TYPE.PIXELS;
}

/**
 * Sets a scene's default proximity radius
 * @param {foundry.documents.Scene} scene the scene whose proximity radius will be overwritten
 * @param {number | null} radius the new proximity radius, set to null to unset the scene's radius and use the module's default radius instead (which can be changed in the module settings)
 * @returns {Promise} the result of foundry.documents.Scene#setFlag
 */
export function set_scene_radius(scene, radius) {
  return scene.setFlag(MODULE_ID, "radius", radius);
}

/**
 * Sets a scene's default proximity radius type
 * @param {foundry.documents.Scene} scene the scene whose proximity radius type will be overwritten
 * @param {RADIUS_TYPE} radius_type the new proximity radius type, a value of RADIUS_TYPE
 * @returns {Promise} the result of foundry.documents.Scene#setFlag
 */
export function set_scene_radius_type(scene, radius_type) {
  return scene.setFlag(MODULE_ID, "radius_type", radius_type);
}

/**
 * Checks if proximity voice chat is disabled for a scene
 * @param {foundry.documents.Scene} scene the scene to check for whether proximity voice chat is disabled or not
 * @returns {boolean} whether proximity voice chat is disabled for the scene or not
 */
export function is_scene_disabled(scene) {
  return scene.getFlag(MODULE_ID, "disabled") ?? false;
}

/**
 * Sets a scene's disabled status for proximity voice chat
 * @param {foundry.documents.Scene} scene the scene for which proximity voice chat will be enabled/disabled
 * @param {boolean} disabled whether to disable (true) or enable (false) proximity voice chat
 * @returns {Promise} the result of foundry.documents.Scene#setFlag
 */
export function set_scene_disabled(scene, disabled) {
  return scene.setFlag(MODULE_ID, "disabled", disabled);
}

/**
 * Gets a specific token's radius to pixel multiplier for a given radius type
 * @param {foundry.documents.TokenDocument} token the token for who the multiplier will be calculated based on the radius type
 * @param {RADIUS_TYPE} radius_type the radius type that defines what the multiplier is
 * @returns {number} the resulting multiplier
 */
export function token_radius_type_pixel_multiplier(token, radius_type) {
  let multiplier = 1;
  if (radius_type === RADIUS_TYPE.TILES) multiplier = token.parent.grid.size;
  return multiplier;
}

function _setup_sheet_tab(sheet_config, template_name, template_partials) {
  sheet_config.TABS.sheet.tabs.push({ id: "proximity", icon: "fa-solid fa-podcast" });
  sheet_config.PARTS.proximity = { scrollable: [''], template: "modules/" + MODULE_ID + "/templates/" + template_name };
  if (template_partials && Array.isArray(template_partials)) {
    sheet_config.PARTS.proximity.templates = template_partials.map((v) => "modules/" + MODULE_ID + "/templates/partials/" + v);
  }

  /* changes order of the proximity tab to be before the footer in the DOM
    since object order is guaranteed as of es6 and works on insertion order
    and which is also what defines the order in which the html elements appear in
    this feels like it's the wrong way to go about it but I couldn't find a different way to change PARTS*/

  let keys = Object.keys(sheet_config.PARTS);
  // extracts the proximity key and re-inserts it before the footer key
  keys.splice(keys.indexOf("footer"), 0, keys.splice(keys.indexOf("proximity"), 1)[0]);// could technically just remove the last element instead of indexof("proximity") but this feels more explicit
  // turns the array of keys back into an object but without values so Object.assign can apply the values of the original PARTS while keeping the order of the newly created object
  let order_template = keys.reduce((a, v) => ({ ...a, [v]: undefined }), {});
  sheet_config.PARTS = Object.assign(order_template, sheet_config.PARTS);
  // all this is just because I couldn't think of a way to let Object.keys(...).sort() to sort it the way I wanted without affecting the rest of the order
}


/**
 * Whether a user can hear everyone regardless of proximity. Defaults to on for GMs so they can narrate without
 * having to remember to toggle anything, and off for everyone else.
 * @param {foundry.documents.User} user
 * @returns {boolean}
 */
export function is_global_listener(user) {
  return user.getFlag(MODULE_ID, "global_listener") ?? user.isGM;
}

/**
 * Whether a user is heard by everyone regardless of proximity. Defaults to on for GMs and off for everyone else.
 * @param {foundry.documents.User} user
 * @returns {boolean}
 */
export function is_global_speaker(user) {
  return user.getFlag(MODULE_ID, "global_speaker") ?? user.isGM;
}

Hooks.on("init", async () => {
  _setup_sheet_tab(foundry.applications.sheets.TokenConfig, "token-proximity-tab.hbs", ["radius-type-input.hbs"]);
  _setup_sheet_tab(foundry.applications.sheets.PrototypeTokenConfig, "token-proximity-tab.hbs", ["radius-type-input.hbs"]);
  _setup_sheet_tab(foundry.applications.sheets.SceneConfig, "scene-proximity-tab.hbs", ["radius-type-input.hbs"]);
  await game.settings.register(MODULE_ID, "defaultProximityRadius", {
    name: "proximity-voice-chat.Settings.DefaultProximityRadius.Label",
    hint: "proximity-voice-chat.Settings.DefaultProximityRadius.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1200,// 12 tiles at 100px grid size / 60ft at 5ft tile size
    onChange: () => _rebuild_all_sources()
  });
  await game.settings.register(MODULE_ID, "defaultProximityRadiusType", {
    name: "proximity-voice-chat.Settings.DefaultProximityRadiusType.Label",
    hint: "proximity-voice-chat.Settings.DefaultProximityRadiusType.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: RADIUS_TYPE.PIXELS,
    onChange: () => _rebuild_all_sources(),
    choices: {
      [RADIUS_TYPE.PIXELS]: "proximity-voice-chat.RadiusType.Pixels",
      [RADIUS_TYPE.TILES]: "proximity-voice-chat.RadiusType.Tiles"
    }
  });
  await game.settings.register(MODULE_ID, "debug", {
    name: "proximity-voice-chat.Settings.Debug.Label",
    hint: "proximity-voice-chat.Settings.Debug.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
  await game.settings.register(MODULE_ID, "fixPeerConnections", {
    name: "proximity-voice-chat.Settings.FixPeerConnections.Label",
    hint: "proximity-voice-chat.Settings.FixPeerConnections.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });
  _patch_simplepeer();
  register_voice_ui_settings();
  // exposed api for macros
  game.modules.get(MODULE_ID).api = {
    RADIUS_TYPE,
    get_userlist,
    set_userlist,
    is_user_in_userlist,
    add_user_to_userlist,
    remove_user_from_userlist,
    get_calculated_token_radius,
    get_calculated_token_radius_type,
    get_token_radius,
    get_token_radius_type,
    set_token_radius,
    set_token_radius_type,
    get_scene_radius,
    get_scene_radius_type,
    set_scene_radius,
    set_scene_radius_type,
    is_scene_disabled,
    set_scene_disabled,
    is_global_listener,
    is_global_speaker,
    toggle_global_listener,
    toggle_global_speaker,
    get_user_volume,
    get_speaking_token_uuids,
    diagnose
  }
});


/**
 * @type {Map<String, {soundsource: foundry.canvas.sources.PointSoundSource, userlist: Array<String>}>}
 */
let _token_proximity_data = new Map();

const _comma_splitter = /\s*,\s*/;// splits on commas with any amount of whitespace on both sides

/**
 * The UUIDs of the users speaking through a token: its userlist, plus any active GM who has it selected
 * @param {foundry.documents.TokenDocument} token
 * @returns {Array<string>}
 */
function _get_token_speakers(token) {
  const userlist = token.getFlag(MODULE_ID, "userlist");
  const speakers = typeof userlist === "string" ? userlist.split(_comma_splitter).filter(uuid => uuid !== "") : [];
  for (const user of game.users) {
    if (!user.isGM || !user.active || speakers.includes(user.uuid)) continue;
    if (user.getFlag(MODULE_ID, "selected_tokens")?.includes(token.uuid)) speakers.push(user.uuid);
  }
  return speakers;
}

/**
 * Creates or replaces a token's proximity data from the token's current flags and (animated) position.
 * Tokens nobody speaks through have their proximity data removed instead.
 * @param {foundry.documents.TokenDocument} token the token whose proximity data is being rebuilt
 */
function _rebuild_source(token) {
  const speakers = _get_token_speakers(token);
  if (speakers.length === 0) {
    _token_proximity_data.delete(token.uuid);
    return;
  }
  const soundsource = new foundry.canvas.sources.PointSoundSource({ object: null, sourceId: MODULE_ID + "." + token.uuid });
  _token_proximity_data.set(token.uuid, {
    soundsource,
    name: token.name,
    userlist: speakers
  });
  _move_source(token);
}

/**
 * Moves a token's proximity source to the token's current (animated) position.
 * During an animation the client TokenDocument holds the in-between position, so this follows the token visually.
 * @param {foundry.documents.TokenDocument} token
 */
function _move_source(token) {
  const proximity_data = _token_proximity_data.get(token.uuid);
  if (!proximity_data) return;
  const radius = get_calculated_token_radius(token) * token_radius_type_pixel_multiplier(token, get_calculated_token_radius_type(token));
  const origin = token.getSoundOrigin(_position_override(token));
  try {
    proximity_data.soundsource.initialize({
      x: origin.x,
      y: origin.y,
      elevation: origin.elevation,
      // without an explicit level the source falls back to whichever level this client happens to be viewing
      level: token.level ?? canvas.level?.id,
      radius,
      walls: true,
      disabled: false
    });
  } catch (err) {
    console.error(MODULE_ID + " | failed to initialize proximity source for " + token.uuid, err);
    _token_proximity_data.delete(token.uuid);
  }
}

/**
 * Background tabs don't run canvas animations, so a token's prepared position stays wherever its animation stalled
 * until the tab is visible again. While hidden, use the token's stored (destination) position instead.
 * @param {foundry.documents.TokenDocument} token
 * @returns {object} position data to pass to getSoundOrigin/getListenerPosition
 */
function _position_override(token) {
  if (!globalThis.document.hidden) return {};
  const { x, y, elevation } = token._source;
  return { x, y, elevation };
}

function _rebuild_all_sources() {
  _token_proximity_data.clear();
  if (!globalThis.canvas?.scene) return;
  for (const token of canvas.scene.tokens) _rebuild_source(token);
  _schedule_volume_update();
}

function _is_voice_active() {
  const mode = game.webrtc?.settings?.world?.mode;
  return mode === foundry.av.AVSettings.AV_MODES.AUDIO || mode === foundry.av.AVSettings.AV_MODES.AUDIO_VIDEO;
}

/**
 * The tokens this client listens through: the controlled tokens, or if none are controlled, every owned token
 * for players. A GM owns every token, so with nothing selected a GM listens only through tokens they speak through.
 * @returns {Array<foundry.canvas.placeables.Token>}
 */
function _get_listener_tokens() {
  if (canvas.tokens.controlled.length > 0) return canvas.tokens.controlled;
  if (game.user.isGM) return canvas.tokens.placeables.filter(token => is_user_in_userlist(token.document, game.user.uuid));
  return canvas.tokens.ownedTokens;
}

/**
 * The positions this client listens from, see _get_listener_tokens
 * @returns {Array<{x: number, y: number, elevation: number}>}
 */
function _get_listener_positions() {
  return _get_listener_tokens().map(token => token.document.getListenerPosition(_position_override(token.document)));
}

/**
 * Calculates how loud another user should be for this client, in user/input space [0, 1].
 * @param {foundry.documents.User} other_user
 * @param {Array<{x: number, y: number, elevation: number}>} listeners
 * @returns {{volume: number, reason: string}}
 */
function _calculate_user_volume(other_user, listeners) {
  // Foundry's own deafen doesn't work in 14.369 (its camera template reads "mutaAll"), so apply it here
  if (game.webrtc?.settings?.client?.muteAll) return { volume: 0, reason: "you have deafened yourself" };
  if (canvas.scene?.getFlag(MODULE_ID, "disabled")) return { volume: 1, reason: "scene proximity disabled" };
  if (is_global_listener(game.user)) return { volume: 1, reason: "you are a global listener" };
  if (is_global_speaker(other_user)) return { volume: 1, reason: "they are a global speaker" };
  let volume = 0;
  let loudest = null;
  let speaking_tokens = 0;
  for (const proximity_token of _token_proximity_data.values()) {
    if (!proximity_token.userlist.includes(other_user.uuid)) continue;
    speaking_tokens++;
    for (const listener of listeners) {
      const token_volume = proximity_token.soundsource.getVolumeMultiplier(listener, { easing: true });
      if (token_volume <= volume) continue;
      volume = token_volume;
      loudest = proximity_token.name;
      if (volume >= 1) break;
    }
    if (volume >= 1) break;
  }
  if (speaking_tokens === 0) return { volume: 0, reason: "they speak through no token in this scene" };
  if (listeners.length === 0) return { volume: 0, reason: game.user.isGM ? "no token selected" : "you have no listening token" };
  if (volume === 0) return { volume: 0, reason: "out of range of their tokens" };
  return { volume, reason: "proximity, through their token \"" + loudest + "\"" };
}

/**
 * Gets the element that plays a user's audio
 * @param {string} user_id
 * @returns {HTMLMediaElement | null}
 */
function _get_audio_element(user_id) {
  let audio_element = ui.webrtc?.getUserVideoElement(user_id) ?? null;
  if (game.modules.get("avclient-livekit")?.active) {
    // avclient-livekit plays audio through its own element next to the video
    audio_element = audio_element?.parentElement?.querySelector(".user-microphone-audio") ?? audio_element;
  }
  return audio_element;
}

/** @type {Map<string, number>} last volume multiplier applied per user, used to only log changes */
const _last_volumes = new Map();

function _update_volumes() {
  if (!globalThis.canvas?.ready || !_is_voice_active() || !globalThis.ui?.webrtc) return;
  const listeners = _get_listener_positions();
  const debug = game.settings.get(MODULE_ID, "debug");
  for (const other_user of game.users) {
    if (!other_user.active || other_user.isSelf) continue;
    const { volume: multiplier, reason } = _calculate_user_volume(other_user, listeners);
    if (debug && _last_volumes.get(other_user.id) !== multiplier) {
      console.log(MODULE_ID + " | " + other_user.name + " -> " + multiplier.toFixed(2) + " (" + reason + ")");
    }
    _last_volumes.set(other_user.id, multiplier);

    const audio_element = _get_audio_element(other_user.id);
    if (!audio_element) continue;
    // apply the multiplier in user/input space (0.8 = 80% as loud) rather than the logarithmic space element.volume uses
    const slider_volume = game.webrtc.settings.getUser(other_user.id)?.volume ?? 1;
    const volume = foundry.audio.AudioHelper.inputToVolume(foundry.audio.AudioHelper.volumeToInput(slider_volume) * multiplier);
    if (Math.abs(audio_element.volume - volume) > 0.001) audio_element.volume = volume;
    if (audio_element.paused && volume > 0) {
      // Chrome can pause a media element whose volume goes from 0 back up, so resume it
      audio_element.play()?.catch((err) => {
        if (debug) console.warn(MODULE_ID + " | could not resume audio for " + other_user.name, err);
      });
    }
  }
}

let _volume_update_scheduled = false;

/**
 * Coalesces bursts of volume updates into one, run after the current hook has resolved.
 * Uses setTimeout rather than requestAnimationFrame because the latter never fires in background tabs.
 */
function _schedule_volume_update() {
  if (_volume_update_scheduled) return;
  _volume_update_scheduled = true;
  setTimeout(() => {
    _volume_update_scheduled = false;
    _update_volumes();
  }, 0);
}

// Foundry resets element volumes whenever it re-renders a camera or attaches a stream, and there's no hook for the
// latter, so volumes are re-applied periodically as well as on events. Only changed volumes are written.
setInterval(() => {
  // token movement isn't animated in background tabs, so sources are moved to the tokens' destinations instead
  if (globalThis.document.hidden && globalThis.canvas?.ready) _rebuild_all_sources();
  else _schedule_volume_update();
}, 1000);

globalThis.document.addEventListener("visibilitychange", () => {
  if (globalThis.canvas?.ready) _rebuild_all_sources();
});

Hooks.on("updateToken", (document, changed, _options, _userId) => {
  const flags = changed.flags?.[MODULE_ID];
  if (!flags) return;
  if (["userlist", "radius", "radius_type", "-=userlist", "-=radius", "-=radius_type"].some(key => key in flags)) {
    _rebuild_source(document);
    Hooks.callAll("updateTokenProximitySettings", document, flags.userlist, flags.radius);
    _schedule_volume_update();
  }
});

Hooks.on("refreshToken", (token, flags) => {
  // fires every frame while a token animates, with the document holding the in-between position
  if (!flags.refreshPosition && !flags.refreshElevation) return;
  if (_token_proximity_data.has(token.document.uuid)) {
    _move_source(token.document);
    _schedule_volume_update();
  } else if (token.isOwner) {
    _schedule_volume_update();
  }
});

Hooks.on("createToken", (document, _options, _userId) => {
  if (document.parent !== canvas.scene) return;
  _rebuild_source(document);
  _schedule_volume_update();
});

Hooks.on("deleteToken", (document, _options, _userId) => {
  _token_proximity_data.delete(document.uuid);
  _schedule_volume_update();
});

let _selection_timeout = null;

/**
 * Shares a GM's selected tokens through a user flag so players' clients know which tokens the GM speaks through.
 * Selection changes come in bursts (release all, then control each), so only the settled selection is written.
 */
function _share_gm_selection() {
  clearTimeout(_selection_timeout);
  _selection_timeout = setTimeout(() => {
    if (!game.user.isGM || !globalThis.canvas?.ready) return;
    const selected = canvas.tokens.controlled.map(token => token.document.uuid).sort();
    const current = game.user.getFlag(MODULE_ID, "selected_tokens") ?? [];
    if (selected.length === current.length && selected.every((uuid, i) => uuid === current[i])) return;
    game.user.setFlag(MODULE_ID, "selected_tokens", selected);
  }, 250);
}

Hooks.on("controlToken", () => {
  _schedule_volume_update();// because volume is based on controlled tokens or owned tokens, so any control change could change the volume
  if (game.user.isGM) _share_gm_selection();
});

Hooks.on("updateScene", (document, changed, _options, _userId) => {
  if (document !== canvas.scene) return;
  const flags = changed.flags?.[MODULE_ID];
  if (flags && ["radius", "radius_type", "-=radius", "-=radius_type"].some(key => key in flags)) _rebuild_all_sources();
  else if (flags) _schedule_volume_update();
});

Hooks.on("updateUser", (_document, changed, _options, _userId) => {
  const flags = changed.flags?.[MODULE_ID];
  if (flags !== undefined) {
    if ("selected_tokens" in flags || "-=selected_tokens" in flags) _rebuild_all_sources();
    _schedule_volume_update();
    if (game.user.isGM) _refresh_gm_buttons();
  }
});

Hooks.on("userConnected", (user) => {
  // a GM joining or leaving changes who speaks through the tokens they have selected
  if (user.isGM && globalThis.canvas?.ready) _rebuild_all_sources();
  else _schedule_volume_update();
});

Hooks.once("ready", () => {
  const installed = game.modules.get(MODULE_ID).version;
  if (installed === SCRIPT_VERSION && UI_SCRIPT_VERSION === SCRIPT_VERSION) return;
  const script = SCRIPT_VERSION === UI_SCRIPT_VERSION ? SCRIPT_VERSION : SCRIPT_VERSION + " / " + UI_SCRIPT_VERSION;
  const message = game.i18n.format("proximity-voice-chat.UI.StaleScript", { script, installed });
  console.error(MODULE_ID + " | " + message);
  ui.notifications.error(message, { permanent: true });
});

Hooks.on("canvasTearDown", (_canvas) => {
  _token_proximity_data.clear();
});

Hooks.on("canvasReady", (_canvas) => {
  _rebuild_all_sources();
});

let _wall_rebuild_timeout = null;
function _on_wall_change() {
  // walls and doors affect audio line of sight; rebuild after core has refreshed its edges
  clearTimeout(_wall_rebuild_timeout);
  _wall_rebuild_timeout = setTimeout(_rebuild_all_sources, 50);
}
Hooks.on("createWall", _on_wall_change);
Hooks.on("updateWall", _on_wall_change);
Hooks.on("deleteWall", _on_wall_change);

Hooks.on("renderCameraViews", (_application, _element, _context, _options) => {
  if (game.user.isGM) _add_gm_voice_buttons();
  // re-rendering the camera views resets video.volume so it has to be applied again
  _schedule_volume_update();
});

Hooks.on("rtcSettingsChanged", (_settings, _changed) => {
  _schedule_volume_update();
});



/** How long a connection that is still being set up is left alone before it is replaced */
const _PEER_SETUP_TIMEOUT_MS = 30000;
const _PEER_STARTED = Symbol("proximity-voice-chat.started");
const _PEER_REMOTE_FINGERPRINT = Symbol("proximity-voice-chat.remoteFingerprint");

/**
 * Gets the DTLS certificate fingerprint from an SDP. Every new RTCPeerConnection has its own certificate,
 * so a different fingerprint means the other side started a brand-new connection rather than renegotiating.
 * @param {string | undefined} sdp
 * @returns {string | null}
 */
function _sdp_fingerprint(sdp) {
  return sdp?.match(/^a=fingerprint:(.+)$/m)?.[1]?.trim() ?? null;
}

/**
 * Whether a SimplePeer connection is up. SimplePeer's own `connected` also waits for its data channel,
 * which Foundry doesn't use, so media can flow long before it turns true.
 * @param {object} peer a SimplePeer instance
 * @returns {boolean}
 */
function _is_peer_up(peer) {
  return peer.connected || peer._connecting || peer._pc?.connectionState === "connected";
}

/**
 * Works around connection churn in Foundry's built-in (SimplePeer) A/V client.
 *
 * Every 8 seconds each client calls initializePeerStream for every other user, and that replaces any connection
 * which isn't fully established yet with a new outgoing one, without closing the old one. Both sides do this,
 * so slow connections never finish, offers cross ("Called in wrong state"), and offers from a replaced
 * connection hit an established one ("order of m-lines ... doesn't match"). Each peer's event handlers also
 * act on the user ID rather than the peer, so a leftover connection closing tears down its replacement.
 */
function _patch_simplepeer() {
  const client_class = foundry.av?.clients?.SimplePeerAVClient;
  if (!client_class) {
    console.warn(MODULE_ID + " | SimplePeerAVClient not found, connection fixes not applied");
    return;
  }
  if (!game.settings.get(MODULE_ID, "fixPeerConnections")) return;
  const proto = client_class.prototype;
  const original_initialize_peer_stream = proto.initializePeerStream;
  const original_receive_signal = proto.receiveSignal;
  const original_connect_peer = proto.connectPeer;

  /**
   * Removes a peer synchronously so the next lines see an empty slot (Foundry's disconnectPeer awaits first)
   * @this {foundry.av.clients.SimplePeerAVClient}
   */
  function drop_peer(user_id) {
    const peer = this.peers.get(user_id);
    this.peers.delete(user_id);
    const stream = this.remoteStreams.get(user_id);
    this.remoteStreams.delete(user_id);
    stream?.getTracks().forEach(track => track.stop());
    peer?.destroy();
    this.master.render();
  }

  proto.connectPeer = function (userId, isInitiator = false) {
    const peer = original_connect_peer.call(this, userId, isInitiator);
    peer[_PEER_STARTED] = Date.now();
    // only let the peer that is currently registered for this user act on Foundry's behalf
    for (const event of ["stream", "close", "error"]) {
      const listeners = peer.listeners(event);
      peer.removeAllListeners(event);
      for (const listener of listeners) {
        peer.on(event, (...args) => {
          if (this.peers.get(userId) !== peer) return;
          return listener(...args);
        });
      }
    }
    return peer;
  };

  proto.initializePeerStream = async function (userId) {
    const peer = this.peers.get(userId);
    if (peer && !peer.destroyed) {
      if (_is_peer_up(peer)) return peer;
      if (Date.now() - (peer[_PEER_STARTED] ?? 0) < _PEER_SETUP_TIMEOUT_MS) return peer;
      if (game.settings.get(MODULE_ID, "debug")) console.log(MODULE_ID + " | replacing stalled connection with " + game.users.get(userId)?.name);
    }
    if (peer) drop_peer.call(this, userId);
    // only one side of each pair makes the call, so the two ends never send offers at the same time
    if (game.userId > userId) return null;
    return original_initialize_peer_stream.call(this, userId);
  };

  proto.receiveSignal = function (userId, data) {
    const fingerprint = data?.type === "offer" ? _sdp_fingerprint(data.sdp) : null;
    const existing = this.peers.get(userId);
    // answers and candidates only belong to a connection we still have; without one they're leftovers from a
    // dropped connection, and Foundry would otherwise build a new answering connection around them
    if (!existing && data?.type !== "offer") return;
    if (existing && fingerprint && existing[_PEER_REMOTE_FINGERPRINT] && existing[_PEER_REMOTE_FINGERPRINT] !== fingerprint) {
      // the other side has started over, e.g. after reloading; answer with a fresh connection
      if (game.settings.get(MODULE_ID, "debug")) console.log(MODULE_ID + " | " + game.users.get(userId)?.name + " started a new connection");
      drop_peer.call(this, userId);
    } else if (existing && fingerprint && existing.initiator) {
      // an offer while we are the caller means both sides called; whoever has the lower ID keeps calling
      if (game.userId < userId) return;
      drop_peer.call(this, userId);
    }
    const result = original_receive_signal.call(this, userId, data);
    const peer = this.peers.get(userId);
    if (peer && fingerprint) peer[_PEER_REMOTE_FINGERPRINT] ??= fingerprint;
    return result;
  };
}

/**
 * Toggles whether you hear everyone, and says what that means
 * @returns {Promise<void>}
 */
export async function toggle_global_listener() {
  const enabled = !is_global_listener(game.user);
  await game.user.setFlag(MODULE_ID, "global_listener", enabled);
  ui.notifications.info(enabled ? "proximity-voice-chat.UI.globalListen.On" : "proximity-voice-chat.UI.globalListen.Off", { localize: true });
}

/**
 * Toggles whether everyone hears you, and says what that means
 * @returns {Promise<void>}
 */
export async function toggle_global_speaker() {
  const enabled = !is_global_speaker(game.user);
  await game.user.setFlag(MODULE_ID, "global_speaker", enabled);
  ui.notifications.info(enabled ? "proximity-voice-chat.UI.globalSpeak.On" : "proximity-voice-chat.UI.globalSpeak.Off", { localize: true });
}

/**
 * How loud another user currently is for this client, as last applied, in user/input space [0, 1]
 * @param {string} user_id
 * @returns {number}
 */
export function get_user_volume(user_id) {
  return _last_volumes.get(user_id) ?? 0;
}

/**
 * The UUIDs of the tokens in the current scene that a user speaks through
 * @param {foundry.documents.User} user
 * @returns {Array<string>}
 */
export function get_speaking_token_uuids(user) {
  const uuids = [];
  for (const [uuid, data] of _token_proximity_data) if (data.userlist.includes(user.uuid)) uuids.push(uuid);
  return uuids;
}

const _gm_global_listen = document.createElement("button");
const _gm_global_speak = document.createElement("button");

Hooks.once("i18nInit", () => {
  _gm_global_listen.setAttribute("aria-label", game.i18n.localize("proximity-voice-chat.UI.globalListen.Hover"));
  _gm_global_speak.setAttribute("aria-label", game.i18n.localize("proximity-voice-chat.UI.globalSpeak.Hover"));
});

_gm_global_listen.type = "button";
_gm_global_listen.classList.add(..."av-control inline-control toggle icon fa-solid fa-fw fa-podcast".split(" "));
_gm_global_listen.setAttribute("data-tooltip", "");
_gm_global_listen.onclick = async (event) => {
  event.preventDefault();
  event.stopPropagation();
  await toggle_global_listener();
};

_gm_global_speak.type = "button";
_gm_global_speak.classList.add(..."av-control inline-control toggle icon fa-solid fa-fw fa-bullhorn".split(" "));
_gm_global_speak.setAttribute("data-tooltip", "");
_gm_global_speak.onclick = async (event) => {
  event.preventDefault();
  event.stopPropagation();
  await toggle_global_speaker();
};

function _refresh_gm_buttons() {
  _gm_global_listen.classList.toggle("active", is_global_listener(game.user));
  _gm_global_speak.classList.toggle("active", is_global_speaker(game.user));
}

/**
 * Adds the GM proximity voice buttons next to the GM's own camera controls
 */
function _add_gm_voice_buttons() {
  _refresh_gm_buttons();
  const element = document.querySelector(".user-controls[data-user=\"" + game.user.id + "\"]:not([hidden] .user-controls)");
  if (!element) return;// the GM's own camera view isn't rendered, e.g. not connected to A/V yet
  element.append(_gm_global_listen, _gm_global_speak);
}



Hooks.on("renderTokenHUD", (application, element, _context, _options) => {
  if (!game.user.isGM) return;
  _add_token_list_toggle(element, application.document);
});

const _gm_token_list_toggle = document.createElement("button");
const _gm_token_list_toggle_icon = document.createElement("i");
_gm_token_list_toggle.appendChild(_gm_token_list_toggle_icon);
_gm_token_list_toggle.type = "button";
_gm_token_list_toggle.classList.add("control-icon");
_gm_token_list_toggle_icon.classList.add(..."fa-solid fa-podcast".split(" "));
_gm_token_list_toggle.setAttribute("data-tooltip", "HUD.proximity-toggle-speaker.Hover");
_gm_token_list_toggle.onclick = async () => {
  const token_uuid = _gm_token_list_toggle.getAttribute("data-token-uuid");
  if (!token_uuid) return;
  let token = await fromUuid(token_uuid);
  if (!token) return;
  if (is_user_in_userlist(token, game.user.uuid)) {
    await remove_user_from_userlist(token, game.user.uuid);
  } else {
    await add_user_to_userlist(token, game.user.uuid);
  }
  _gm_token_list_toggle.classList.toggle("active", is_user_in_userlist(token, game.user.uuid));
};

function _add_token_list_toggle(element, token) {
  _gm_token_list_toggle.setAttribute("data-token-uuid", token.uuid);
  _gm_token_list_toggle.classList.toggle("active", is_user_in_userlist(token, game.user.uuid));
  element.querySelector(".col.left")?.appendChild(_gm_token_list_toggle);
}



/**
 * Logs what this client thinks about every other active user's voice, for troubleshooting.
 * Run in the browser console (F12) or a macro: game.modules.get("proximity-voice-chat").api.diagnose()
 * @returns {Array<object>} one row per other active user
 */
export function diagnose() {
  const listeners = globalThis.canvas?.ready ? _get_listener_positions() : [];
  console.log(MODULE_ID + " | diagnose", {
    foundry: game.version,
    module: game.modules.get(MODULE_ID).version,
    script: SCRIPT_VERSION,
    uiScript: UI_SCRIPT_VERSION,
    canvasReady: !!globalThis.canvas?.ready,
    voiceActive: _is_voice_active(),
    sceneDisabled: !!globalThis.canvas?.scene?.getFlag(MODULE_ID, "disabled"),
    youAreGlobalListener: is_global_listener(game.user),
    youAreGlobalSpeaker: is_global_speaker(game.user),
    listeningThrough: globalThis.canvas?.ready ? _get_listener_tokens().map(token => token.name).join(", ") || "nothing" : "canvas not ready",
    speakingThrough: Array.from(_token_proximity_data.values()).filter(data => data.userlist.includes(game.user.uuid)).map(data => data.name).join(", ") || "nothing",
    proximityTokens: _token_proximity_data.size,
    deafenedAll: !!game.webrtc?.settings?.client?.muteAll,
    pageHadUserGesture: navigator.userActivation?.hasBeenActive
  });
  const rows = game.users.filter(user => user.active && !user.isSelf).map((user) => {
    const element = _get_audio_element(user.id);
    const stream = element?.srcObject;
    const tracks = typeof stream?.getAudioTracks === "function" ? stream.getAudioTracks() : [];
    const settings = game.webrtc?.settings?.getUser(user.id);
    const { volume, reason } = globalThis.canvas?.ready ? _calculate_user_volume(user, listeners) : { volume: NaN, reason: "canvas not ready" };
    // Foundry's getConnectedUsers() lists anyone with a connection object, even one that never finished,
    // so ask the browser's own connection state instead
    const peer = game.webrtc?.client?.peers?.get(user.id);
    const peer_state = peer?._pc?.connectionState ?? null;
    const connected = peer_state === "connected";
    let problem = "";
    if (!peer) problem = "NO VOICE CONNECTION to this user (not even an attempt)";
    else if (!connected) problem = "voice connection not established (" + (peer_state ?? "unknown") + "); look for 'ICE failed' or SimplePeer errors";
    else if (!element) problem = "connected but no audio element";
    else if (element.paused) problem = "audio element paused";
    return {
      user: user.name,
      connected,
      problem: problem || "none",
      connection: peer ? (peer._pc?.connectionState ?? "?") + "/" + (peer._pc?.iceConnectionState ?? "?") + (peer.initiator ? " (we called)" : " (they called)") : "none",
      mutedOrBlocked: !!settings?.muted || !settings?.canBroadcastAudio,
      proximity: Number(volume.toFixed(2)),
      reason,
      slider: Number(foundry.audio.AudioHelper.volumeToInput(settings?.volume ?? 1).toFixed(2)),
      element: element ? element.tagName.toLowerCase() : "MISSING",
      elementVolume: element ? Number(element.volume.toFixed(2)) : null,
      paused: element?.paused ?? null,
      elementMuted: element?.muted ?? null,
      audioTracks: tracks.map(t => (t.enabled ? "on" : "off") + "/" + t.readyState + (t.muted ? "/no-data" : "")).join(", ") || "none"
    };
  });
  console.table(rows);
  return rows;
}

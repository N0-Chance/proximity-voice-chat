import { register_voice_ui_settings, UI_SCRIPT_VERSION } from "./voice-ui.js";
import { register_diagnostics, DIAG_SCRIPT_VERSION } from "./diagnostics.js";
import {
  register_voice_audio_settings, set_voice_audio_listener, play_voice, stop_other_voices, voice_audio_status, voice_status,
  AUDIO_PROBLEMS, AUDIO_SCRIPT_VERSION
} from "./voice-audio.js";
import {
  WALL_KINDS, DEFAULT_MUFFLE, wall_kind, build_graph, find_route, direct_sound, routed_sound, clarity, muffle_cutoff,
  muffle_gain, muffle_gain_legacy, pan_for, describe_hearing, PROPAGATION_SCRIPT_VERSION
} from "./voice-propagation.js";

export const MODULE_ID = "proximity-voice-chat";

/**
 * The version this script was released as, kept in step with module.json by tools/release.sh.
 * Compared against the installed module's version to catch browsers running a stale cached copy.
 */
const SCRIPT_VERSION = "1.6.6";

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
 * Gets a token's listen list: users who also hear through this token, on top of their own tokens
 * @param {foundry.documents.TokenDocument} token
 * @returns {string | undefined} comma separated user UUIDs, or undefined if the token has no listen list
 */
export function get_listenlist(token) {
  return token.getFlag(MODULE_ID, "listenlist");
}

/**
 * Sets a token's listen list
 * @param {foundry.documents.TokenDocument} token
 * @param {string} listenlist comma separated user UUIDs
 * @returns {Promise}
 */
export function set_listenlist(token, listenlist) {
  return token.setFlag(MODULE_ID, "listenlist", listenlist);
}

/**
 * Checks if a user is in a token's listen list
 * @param {foundry.documents.TokenDocument} token
 * @param {string} user_uuid
 * @returns {boolean}
 */
export function is_user_in_listenlist(token, user_uuid) {
  return _split_uuids(token.getFlag(MODULE_ID, "listenlist")).includes(user_uuid);
}

/**
 * Adds a user to a token's listen list
 * @param {foundry.documents.TokenDocument} token
 * @param {string} user_uuid
 * @returns {Promise}
 */
export function add_user_to_listenlist(token, user_uuid) {
  const listenlist = _split_uuids(token.getFlag(MODULE_ID, "listenlist"));
  if (!listenlist.includes(user_uuid)) listenlist.push(user_uuid);
  return token.setFlag(MODULE_ID, "listenlist", listenlist.join(","));
}

/**
 * Removes a user from a token's listen list
 * @param {foundry.documents.TokenDocument} token
 * @param {string} user_uuid
 * @returns {Promise | void} nothing if the token had no listen list
 */
export function remove_user_from_listenlist(token, user_uuid) {
  const listenlist = token.getFlag(MODULE_ID, "listenlist");
  if (!listenlist) return;
  return token.setFlag(MODULE_ID, "listenlist", _split_uuids(listenlist).filter(uuid => uuid !== user_uuid).join(","));
}

/**
 * @param {string | undefined} list comma separated UUIDs
 * @returns {Array<string>}
 */
function _split_uuids(list) {
  return typeof list === "string" ? list.split(/\s*,\s*/).filter(uuid => uuid !== "") : [];
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
  await game.settings.register(MODULE_ID, "whisperRange", {
    name: "proximity-voice-chat.Settings.WhisperRange.Label",
    hint: "proximity-voice-chat.Settings.WhisperRange.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 5, max: 100, step: 5 },
    default: 25,
    onChange: () => _rebuild_all_sources()
  });
  await game.settings.register(MODULE_ID, "yellRange", {
    name: "proximity-voice-chat.Settings.YellRange.Label",
    hint: "proximity-voice-chat.Settings.YellRange.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 100, max: 500, step: 10 },
    default: 200,
    onChange: () => _rebuild_all_sources()
  });
  await game.settings.register(MODULE_ID, "ownersSpeak", {
    name: "proximity-voice-chat.Settings.OwnersSpeak.Label",
    hint: "proximity-voice-chat.Settings.OwnersSpeak.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => _rebuild_all_sources()
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
  register_voice_audio_settings();
  _register_propagation_settings();
  set_voice_audio_listener(_on_audio_path_change);
  _patch_simplepeer();
  register_voice_ui_settings();
  register_diagnostics();
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
    run_relay_test,
    VOICE_MODES,
    get_voice_mode,
    set_voice_mode,
    get_voice_reach,
    set_global_listener,
    set_global_speaker,
    toggle_global_listener,
    toggle_global_speaker,
    get_listenlist,
    set_listenlist,
    is_user_in_listenlist,
    add_user_to_listenlist,
    remove_user_from_listenlist,
    get_owner_speakers,
    get_token_speakers,
    get_user_volume,
    get_user_hearing,
    get_user_voice_volume,
    set_user_voice_volume,
    get_audio_status,
    get_voice_range,
    get_speaking_token_uuids,
    collect_diagnostics,
    diagnose
  }
});


/**
 * How far a user's voice carries: Normal, Whisper (a fraction of the radius) or Yell (a multiple of it)
 * @enum {string}
 */
export const VOICE_MODES = {
  NORMAL: "normal",
  WHISPER: "whisper",
  YELL: "yell"
};

/**
 * Each user's current voice mode, by user ID. Deliberately not stored on the user: it changes often (hold-to-whisper)
 * and should start each session on Normal, so it travels over the module socket instead. Absent means Normal.
 * @type {Map<string, string>}
 */
const _voice_modes = new Map();

/**
 * @param {foundry.documents.User | string} user a user or user ID
 * @returns {string} a value of VOICE_MODES
 */
export function get_voice_mode(user) {
  return _voice_modes.get(typeof user === "string" ? user : user?.id) ?? VOICE_MODES.NORMAL;
}

/**
 * The radius multiplier for a voice mode, from the GM's world settings
 * @param {string} mode a value of VOICE_MODES
 * @returns {number}
 */
function _mode_range(mode) {
  if (mode === VOICE_MODES.WHISPER) return game.settings.get(MODULE_ID, "whisperRange") / 100;
  if (mode === VOICE_MODES.YELL) return game.settings.get(MODULE_ID, "yellRange") / 100;
  return 1;
}

/**
 * Records a user's voice mode and rebuilds the sound sources, since each mode carries its own radius
 * @param {string} user_id
 * @param {string} mode
 */
function _apply_voice_mode(user_id, mode) {
  if (!Object.values(VOICE_MODES).includes(mode)) return;
  if (get_voice_mode(user_id) === mode) return;
  if (mode === VOICE_MODES.NORMAL) _voice_modes.delete(user_id);
  else _voice_modes.set(user_id, mode);
  // mid scene change there's nothing to rebuild; canvasReady rebuilds with the new mode
  if (globalThis.canvas?.ready) _rebuild_all_sources();
  Hooks.callAll("proximityVoiceModeChanged", game.users.get(user_id), mode);
}

/**
 * Sets your own voice mode and tells everyone else
 * @param {string} mode a value of VOICE_MODES
 */
export function set_voice_mode(mode) {
  if (!Object.values(VOICE_MODES).includes(mode) || get_voice_mode(game.user) === mode) return;
  _apply_voice_mode(game.user.id, mode);
  game.socket?.emit(_SOCKET, { action: "voice-mode", from: game.user.id, mode });
}

/**
 * The areas a user's voice currently reaches, one polygon per token they speak through, for previews
 * @param {foundry.documents.User} user
 * @returns {Array<PIXI.Polygon>}
 */
export function get_voice_reach(user) {
  const mode = get_voice_mode(user);
  const shapes = [];
  for (const data of _token_proximity_data.values()) {
    if (!data.userlist.includes(user.uuid)) continue;
    const shape = (data.sources[mode] ?? data.sources.normal)?.shape;
    if (shape) shapes.push(shape);
  }
  return shapes;
}

/**
 * Per token someone speaks through: its sound sources (one per voice mode in use), and where its sound starts, how
 * far it carries on Normal, and on which level, for working out how it travels through and around walls
 * @type {Map<String, {sources: Record<string, foundry.canvas.sources.PointSoundSource>, name: string, userlist: Array<String>, origin?: {x: number, y: number, elevation: number}, radius?: number, level?: string}>}
 */
let _token_proximity_data = new Map();

const _comma_splitter = /\s*,\s*/;// splits on commas with any amount of whitespace on both sides

/**
 * The players who speak through an actor's tokens without being on their speaker lists: those whose assigned
 * character it is, or who were given Owner permission on it. Default "all players" ownership doesn't count, or
 * everyone would speak through shared tokens like loot piles, and GMs are left out because they own everything.
 * @param {foundry.documents.Actor | null | undefined} actor
 * @returns {Array<foundry.documents.User>}
 */
export function get_owner_speakers(actor) {
  if (!actor || !game.settings.get(MODULE_ID, "ownersSpeak")) return [];
  const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  return game.users.filter(user => !user.isGM && (user.character?.id === actor.id || (actor.ownership?.[user.id] ?? 0) >= owner));
}

/**
 * The UUIDs of the users speaking through a token: its owners, its speaker list, and any active GM who has it selected
 * @param {foundry.documents.TokenDocument} token
 * @returns {Array<string>}
 */
export function get_token_speakers(token) {
  return _get_token_speakers(token);
}

function _get_token_speakers(token) {
  const userlist = token.getFlag(MODULE_ID, "userlist");
  const speakers = typeof userlist === "string" ? userlist.split(_comma_splitter).filter(uuid => uuid !== "") : [];
  // unlinked tokens carry a synthetic actor; ownership lives on the actor they were made from
  for (const user of get_owner_speakers(token.baseActor ?? token.actor)) {
    if (!speakers.includes(user.uuid)) speakers.push(user.uuid);
  }
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
  // one source per voice mode its speakers are using, since each mode has its own radius; Normal always exists
  const sources = {};
  const modes = new Set([VOICE_MODES.NORMAL, ...speakers.map(uuid => get_voice_mode(uuid.replace(/^User\./, "")))]);
  for (const mode of modes) {
    sources[mode] = new foundry.canvas.sources.PointSoundSource({ object: null, sourceId: MODULE_ID + "." + token.uuid + "." + mode });
  }
  _token_proximity_data.set(token.uuid, {
    sources,
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
  proximity_data.origin = { x: origin.x, y: origin.y, elevation: origin.elevation ?? 0 };
  proximity_data.radius = radius;
  proximity_data.level = token.level ?? globalThis.canvas?.level?.id;
  try {
    for (const [mode, source] of Object.entries(proximity_data.sources)) {
      source.initialize({
        x: origin.x,
        y: origin.y,
        elevation: origin.elevation,
        // without an explicit level the source falls back to whichever level this client happens to be viewing
        level: token.level ?? canvas.level?.id,
        radius: radius * _mode_range(mode),
        walls: true,
        disabled: false
      });
    }
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
  _routes.clear();
  if (!globalThis.canvas?.scene) return;
  for (const token of canvas.scene.tokens) _rebuild_source(token);
  _schedule_volume_update();
}

function _is_voice_active() {
  const mode = game.webrtc?.settings?.world?.mode;
  return mode === foundry.av.AVSettings.AV_MODES.AUDIO || mode === foundry.av.AVSettings.AV_MODES.AUDIO_VIDEO;
}

/**
 * The tokens this client listens through: the controlled tokens, or if none are controlled, every owned token and
 * every token they speak through for players. A GM owns every token, so with nothing selected a GM listens only
 * through tokens they speak through. Tokens whose listen list includes the user are always added.
 * Without a canvas there is nothing to listen through.
 * @returns {Array<foundry.canvas.placeables.Token>}
 */
function _get_listener_tokens() {
  if (!globalThis.canvas?.ready) return [];
  // tokens whose listen list includes you always count, on top of your own, e.g. riding along with another player
  const listening_through = canvas.tokens.placeables.filter(token => is_user_in_listenlist(token.document, game.user.uuid));
  let own;
  if (canvas.tokens.controlled.length > 0) own = canvas.tokens.controlled;
  else {
    const speaking_through = canvas.tokens.placeables.filter(token => _get_token_speakers(token.document).includes(game.user.uuid));
    // a player also listens through tokens they speak through but don't own, e.g. a companion NPC
    own = game.user.isGM ? speaking_through : [...canvas.tokens.ownedTokens, ...speaking_through];
  }
  return [...new Set([...own, ...listening_through])];
}

/**
 * The positions this client listens from, see _get_listener_tokens, each with the token it belongs to
 * @returns {Array<{x: number, y: number, elevation: number, uuid: string}>}
 */
function _get_listener_positions() {
  return _get_listener_tokens().map(token => ({
    ...token.document.getListenerPosition(_position_override(token.document)), uuid: token.document.uuid
  }));
}

/* -------------------------------------------- */
/*  Sound through and around walls              */
/* -------------------------------------------- */

/** The muffle settings, one per wall kind, e.g. "muffleLimited" */
const _muffle_setting = kind => "muffle" + kind[0].toUpperCase() + kind.slice(1);

function _register_propagation_settings() {
  game.settings.register(MODULE_ID, "soundPropagation", {
    name: "proximity-voice-chat.Settings.SoundPropagation.Label",
    hint: "proximity-voice-chat.Settings.SoundPropagation.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => _on_propagation_settings_change()
  });
  for (const kind of WALL_KINDS) {
    game.settings.register(MODULE_ID, _muffle_setting(kind), {
      name: "proximity-voice-chat.Settings.Muffle." + kind + ".Label",
      hint: "proximity-voice-chat.Settings.Muffle." + kind + ".Hint",
      scope: "world",
      config: true,
      type: Number,
      range: { min: 0, max: 100, step: 5 },
      default: Math.round(DEFAULT_MUFFLE[kind] * 100),
      onChange: () => _on_propagation_settings_change()
    });
  }
  game.settings.register(MODULE_ID, "directionalAudio", {
    name: "proximity-voice-chat.Settings.DirectionalAudio.Label",
    hint: "proximity-voice-chat.Settings.DirectionalAudio.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => _schedule_volume_update()
  });
  game.settings.register(MODULE_ID, "directionalStrength", {
    name: "proximity-voice-chat.Settings.DirectionalStrength.Label",
    hint: "proximity-voice-chat.Settings.DirectionalStrength.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 60,
    onChange: () => _schedule_volume_update()
  });
  // per-person volumes above 100%, which Foundry's own volume setting can't hold; see set_user_voice_volume
  game.settings.register(MODULE_ID, "userVolumes", {
    scope: "client",
    config: false,
    type: Object,
    default: {},
    onChange: () => _schedule_volume_update()
  });
}

function _on_propagation_settings_change() {
  _forget_walls();
  _schedule_volume_update();
}

/**
 * The GM's muffle amounts by wall kind, from 0 to 1
 * @returns {Record<string, number>}
 */
function _muffle_amounts() {
  const amounts = {};
  for (const kind of WALL_KINDS) amounts[kind] = (game.settings.get(MODULE_ID, _muffle_setting(kind)) ?? 0) / 100;
  return amounts;
}

/**
 * Per level: its walls that restrict sound, as plain data, and the graph for finding routes round them.
 * Rebuilt after walls or doors change, see _forget_walls.
 * @type {Map<string, {walls: Array<object>, graph: object}>}
 */
const _level_walls = new Map();

/**
 * Routes round walls already found, per speaking token and listening token, with the positions they were found
 * for. A route is reused while neither end has moved, and for a moment after one has: see _route_between.
 * @type {Map<string, {ox: number, oy: number, lx: number, ly: number, radius: number, route: object | null, at: number}>}
 */
const _routes = new Map();

/** While a token moves, its routes are searched for at most this often; in between, the last one stands */
const _ROUTE_INTERVAL_MS = 100;
let _route_retry = null;

function _forget_walls() {
  _level_walls.clear();
  _routes.clear();
}

/**
 * The walls of a level that restrict sound. Foundry keeps each level's walls as "edges"; an open door's edge
 * restricts nothing, so it drops out here by itself.
 * @param {string | undefined} level_id
 * @returns {{walls: Array<object>, graph: object}}
 */
function _get_sound_walls(level_id) {
  const key = level_id ?? "";
  let known = _level_walls.get(key);
  if (known) return known;
  const level = canvas.scene?.levels?.get?.(level_id) ?? canvas.level;
  const walls = [];
  try {
    for (const edge of level?.edges?.values?.() ?? []) {
      if (edge.type !== "wall" || !edge.sound) continue;
      walls.push({
        a: { x: edge.a.x, y: edge.a.y }, b: { x: edge.b.x, y: edge.b.y }, sense: edge.sound,
        door: edge.object?.door ?? 0, ds: edge.object?.ds ?? 0, dir: edge.direction ?? 0, threshold: edge.threshold?.sound ?? 0
      });
    }
  } catch (err) {
    console.error(MODULE_ID + " | could not read the walls of level " + key, err);
  }
  // a route can't pass anything that muffles; walls the GM has set to 0% aren't in its way
  const muffle = _muffle_amounts();
  const offset = Math.min(20, Math.max(4, (canvas.scene?.grid?.size ?? 100) / 10));
  known = { walls, graph: build_graph(walls.filter(wall => muffle[wall_kind(wall)] > 0), { offset }) };
  _level_walls.set(key, known);
  return known;
}

/**
 * The route round walls from a speaking token to a listening one, searched for at most every _ROUTE_INTERVAL_MS
 * per pair while either moves. A moving token changes position every frame, and a route found a moment ago is
 * close enough until the next search; a follow-up update makes sure the final position gets its own.
 * @returns {object | null} see find_route
 */
function _route_between(token_uuid, origin, listener, radius, graph) {
  const key = token_uuid + "|" + listener.uuid;
  const known = _routes.get(key);
  const now = Date.now();
  if (known && known.radius === radius) {
    if (known.ox === origin.x && known.oy === origin.y && known.lx === listener.x && known.ly === listener.y) return known.route;
    if (now - known.at < _ROUTE_INTERVAL_MS) {
      _route_retry ??= setTimeout(() => {
        _route_retry = null;
        _schedule_volume_update();
      }, _ROUTE_INTERVAL_MS);
      return known.route;
    }
  }
  const route = find_route(graph, origin, listener, radius);
  _routes.set(key, { ox: origin.x, oy: origin.y, lx: listener.x, ly: listener.y, radius, route, at: now });
  return route;
}

/**
 * What one listening position hears of one speaking token: the clearer of straight through the walls between
 * them and round them
 * @param {string} token_uuid the speaking token
 * @param {object} proximity_token its entry in _token_proximity_data
 * @param {string} mode the speaker's voice mode, which scales how far the voice and its route can go
 * @param {{x: number, y: number, elevation: number, uuid: string}} listener
 * @param {Record<string, number>} muffle
 * @returns {object} see Hearing in voice-propagation.js
 */
function _hear_token(token_uuid, proximity_token, mode, listener, muffle) {
  const origin = proximity_token.origin;
  const radius = proximity_token.radius * _mode_range(mode);
  const height = Math.abs((listener.elevation ?? 0) - origin.elevation) * (canvas.dimensions?.distancePixels ?? 0);
  const { walls, graph } = _get_sound_walls(proximity_token.level);
  const direct = direct_sound({ origin, destination: listener, radius, height, walls, muffle });
  if (direct.via === "range") return direct;
  // floors and ceilings stop sound outright, as they do for Foundry's own sounds
  if (canvas.scene?.testSurfaceCollision?.(origin, listener, { type: "sound", mode: "any", level: proximity_token.level })) {
    return { volume: 0, muffle: 1, via: "blocked", walls: {}, plainWalls: {} };
  }
  if (direct.via === "open") return direct;
  const around = routed_sound(_route_between(token_uuid, origin, listener, radius, graph), { radius, height });
  return clarity(around) > clarity(direct) ? around : direct;
}

/**
 * Calculates how loud another user should be for this client, in user/input space [0, 1], and how they're heard.
 * @param {foundry.documents.User} other_user
 * @param {Array<{x: number, y: number, elevation: number, uuid: string}>} listeners
 * @returns {{volume: number, reason: string, token?: {uuid: string, name: string}, hearing?: object, listener?: object}}
 *   hearing: for proximity, how the sound reaches you (see Hearing in voice-propagation.js); listener: the
 *   position you hear them best from
 */
function _calculate_user_volume(other_user, listeners) {
  // Foundry's own deafen doesn't work in 14.369 (its camera template reads "mutaAll"), so apply it here
  if (game.webrtc?.settings?.client?.muteAll) return { volume: 0, reason: "you have deafened yourself" };
  // without a canvas (e.g. "Disable Game Canvas"), fall back to the viewed scene so only global voices get through
  const scene = globalThis.canvas?.ready ? canvas.scene : game.scenes?.viewed;
  if (scene?.getFlag(MODULE_ID, "disabled")) return { volume: 1, reason: "scene proximity disabled" };
  if (is_global_listener(game.user)) return { volume: 1, reason: "you are a global listener" };
  if (is_global_speaker(other_user)) return { volume: 1, reason: "they are a global speaker" };
  const propagation = !!globalThis.canvas?.ready && game.settings.get(MODULE_ID, "soundPropagation");
  const muffle = propagation ? _muffle_amounts() : null;
  let best = null;
  let best_clarity = 0;
  let blocked = null;
  let speaking_tokens = 0;
  const mode = get_voice_mode(other_user);
  for (const [token_uuid, proximity_token] of _token_proximity_data) {
    if (!proximity_token.userlist.includes(other_user.uuid)) continue;
    speaking_tokens++;
    const source = proximity_token.sources[mode] ?? proximity_token.sources.normal;
    for (const listener of listeners) {
      let hearing;
      if (propagation && proximity_token.origin) hearing = _hear_token(token_uuid, proximity_token, mode, listener, muffle);
      // with propagation off, walls block sound outright, as Foundry's own sound sources work it out
      else hearing = { volume: source.getVolumeMultiplier(listener, { easing: true }), muffle: 0, via: "open", from: proximity_token.origin };
      if (hearing.via === "blocked") blocked ??= hearing;
      const how_clear = clarity(hearing);
      if (how_clear <= best_clarity) continue;
      best_clarity = how_clear;
      best = { hearing, listener, uuid: token_uuid, name: proximity_token.name };
      if (how_clear >= 1) break;
    }
    if (best_clarity >= 1) break;
  }
  if (!globalThis.canvas?.ready) return { volume: 0, reason: "no canvas, so only global speakers are heard" };
  if (speaking_tokens === 0) return { volume: 0, reason: "they speak through no token in this scene" };
  if (listeners.length === 0) return { volume: 0, reason: game.user.isGM ? "no token selected" : "you have no listening token" };
  const how = mode === VOICE_MODES.NORMAL ? "" : " (" + (mode === VOICE_MODES.WHISPER ? "whispering" : "yelling") + ")";
  if (!best) {
    if (blocked) return { volume: 0, reason: "walls block the sound from their tokens" + how, hearing: blocked };
    return { volume: 0, reason: "out of range of their tokens" + how };
  }
  return {
    volume: best.hearing.volume, reason: "proximity, through their token \"" + best.name + "\"" + how,
    token: { uuid: best.uuid, name: best.name }, hearing: best.hearing, listener: best.listener
  };
}

/**
 * Where a voice sits between left and right, for "Directional Voice": the direction on screen from the token you
 * hear them best from to where the sound arrives from, which round a corner is the corner. Centred for anyone
 * not heard through a token, such as global speakers.
 * @param {ReturnType<typeof _calculate_user_volume>} heard
 * @returns {number} from -1 (left) to 1 (right)
 */
function _pan_for(heard) {
  if (!heard.hearing?.from || !heard.listener || !game.settings.get(MODULE_ID, "directionalAudio")) return 0;
  const strength = game.settings.get(MODULE_ID, "directionalStrength") / 100;
  // within half a tile the placement eases to the centre, so a voice doesn't flip sides as it passes through you
  return pan_for(heard.listener, heard.hearing.from, strength, (canvas.scene?.grid?.size ?? 100) / 2);
}

/**
 * A user's volume as you've set it, where 1 is 100%. Up to 1 it's Foundry's own per-user volume; above that (only
 * possible on the advanced audio path) it's the module's.
 * @param {string} user_id
 * @returns {number} from 0 to 2
 */
export function get_user_voice_volume(user_id) {
  const extra = game.settings.get(MODULE_ID, "userVolumes")?.[user_id];
  if (extra > 1) return Math.min(2, extra);
  return foundry.audio.AudioHelper.volumeToInput(game.webrtc?.settings?.getUser(user_id)?.volume ?? 1);
}

/**
 * Sets a user's volume for you. Above 1 (100%) only takes effect on the advanced audio path.
 * @param {string} user_id
 * @param {number} volume from 0 to 2
 * @returns {Promise<void>}
 */
export async function set_user_voice_volume(user_id, volume) {
  volume = Math.min(2, Math.max(0, Number(volume) || 0));
  const extra = { ...(game.settings.get(MODULE_ID, "userVolumes") ?? {}) };
  if (volume > 1) extra[user_id] = volume;
  else delete extra[user_id];
  await game.settings.set(MODULE_ID, "userVolumes", extra);
  await game.webrtc.settings.set("client", `users.${user_id}.volume`, foundry.audio.AudioHelper.inputToVolume(Math.min(1, volume)));
}

/**
 * Why the advanced audio path can't be used whatever the browser can do: another module's A/V client plays
 * voices its own way
 * @returns {string | null}
 */
function _audio_path_blocker() {
  return game.modules.get("avclient-livekit")?.active ? "other-client" : null;
}

/**
 * Which audio path this browser plays voices through, and why
 * @returns {{path: "advanced" | "old", reason: string | null, detail: string | null, problem: boolean, boost: number}}
 *   reason: "disabled" (by the GM), "opted-out" (on this device), "waiting" (for a first click), "other-client", or
 *   a problem: "unsupported", "resume", "sink", "output", "error"; boost: the GM's Voice Boost, where 1 is 100%
 */
export function get_audio_status() {
  const blocker = _audio_path_blocker();
  const status = blocker ? { path: "old", reason: blocker, detail: null } : voice_audio_status();
  return { ...status, problem: AUDIO_PROBLEMS.includes(status.reason), boost: game.settings.get(MODULE_ID, "voiceBoost") / 100 };
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

/** @type {Map<string, object>} how each user was last heard: see get_user_hearing */
const _last_hearing = new Map();

/** Camera elements this module has muted because the advanced path is playing their stream instead */
const _muted_elements = new WeakSet();

function _update_volumes() {
  // runs without a canvas too: otherwise "Disable Game Canvas" would leave everyone at full volume.
  // The timer can fire while the page is still loading, before Foundry has set game.user.
  if (!game.user || !globalThis.ui?.webrtc) return;
  if (!_is_voice_active()) return stop_other_voices();
  const listeners = _get_listener_positions();
  const debug = game.settings.get(MODULE_ID, "debug");
  const boost = game.settings.get(MODULE_ID, "voiceBoost") / 100;
  const advanced_allowed = !_audio_path_blocker();
  const advanced = new Set();
  for (const other_user of game.users) {
    if (!other_user.active || other_user.isSelf) continue;
    const heard = _calculate_user_volume(other_user, listeners);
    const { volume: multiplier, reason } = heard;
    const muffle = heard.hearing?.muffle ?? 0;
    const pan = _pan_for(heard);
    if (debug && _last_volumes.get(other_user.id) !== multiplier) {
      console.log(MODULE_ID + " | " + other_user.name + " -> " + multiplier.toFixed(2) + " (" + reason + ")");
    }
    _last_volumes.set(other_user.id, multiplier);
    _last_hearing.set(other_user.id, { ...heard.hearing, volume: multiplier, muffle, cutoff: muffle_cutoff(muffle), pan });

    // no element means Foundry isn't playing them (e.g. you've hidden them), so neither path does
    const audio_element = _get_audio_element(other_user.id);
    if (!audio_element) continue;
    // apply the multiplier in user/input space (0.8 = 80% as loud) rather than the logarithmic space element.volume uses
    const slider = get_user_voice_volume(other_user.id);
    let playing;
    // the advanced path takes the stream from the camera element, and plays it louder than an element can
    const gain = foundry.audio.AudioHelper.inputToVolume(slider * multiplier) * muffle_gain(muffle) * boost;
    if (advanced_allowed && audio_element.srcObject && play_voice(other_user.id, { stream: audio_element.srcObject, gain, cutoff: muffle_cutoff(muffle), pan })) {
      advanced.add(other_user.id);
      // the element keeps the stream flowing (Chrome needs that) but mustn't be heard as well
      if (!audio_element.muted) audio_element.muted = true;
      _muted_elements.add(audio_element);
      playing = gain > 0;
    } else {
      if (_muted_elements.has(audio_element)) {
        audio_element.muted = false;
        _muted_elements.delete(audio_element);
      }
      // an element can't be louder than 100% or filtered, so here muffled just means quieter
      const volume = Math.min(1, foundry.audio.AudioHelper.inputToVolume(Math.min(1, slider) * multiplier) * muffle_gain_legacy(muffle));
      if (Math.abs(audio_element.volume - volume) > 0.001) audio_element.volume = volume;
      playing = volume > 0;
    }
    // an element with no stream (e.g. a user with no microphone) has nothing to play, and play() would only fail
    if (audio_element.paused && playing && audio_element.srcObject) {
      // Chrome can pause a media element whose volume goes from 0 back up, so resume it
      audio_element.play()?.catch((err) => {
        if (debug) console.warn(MODULE_ID + " | could not resume audio for " + other_user.name, err);
      });
    }
  }
  // anyone left on the advanced path without being played above has gone: left, hidden, or lost their stream
  stop_other_voices(advanced);
}

/** The audio path last looked at, so a change is only acted on once */
let _known_audio_reason;

/**
 * The advanced audio path started, stopped or failed: re-apply every volume on whichever path is now in use
 */
function _on_audio_path_change() {
  _schedule_volume_update();
  // before the self-test has run there's nobody to tell yet; it looks at the path itself when it does
  if (_self_test) _check_audio_path();
}

/**
 * Notes which audio path this browser is on. If the advanced path has failed, says so here and tells the GMs,
 * like the connection self-test does.
 */
function _check_audio_path() {
  const status = get_audio_status();
  if (_self_test) _self_test.audio = status;
  if (status.reason === _known_audio_reason) return;
  _known_audio_reason = status.reason;
  if (AUDIO_PROBLEMS.includes(status.reason)) {
    ui.notifications.warn(game.i18n.localize("proximity-voice-chat.Audio.Fallback") + " " + game.i18n.localize("proximity-voice-chat.Audio.Reason." + status.reason));
  }
  _report_self_test();
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
  _request_calls(game.webrtc?.client);
}, 1000);

globalThis.document.addEventListener("visibilitychange", () => {
  if (globalThis.canvas?.ready) _rebuild_all_sources();
});

Hooks.on("updateToken", (document, changed, _options, _userId) => {
  // every client hears about tokens on every scene; only the one being viewed has sources
  if (document.parent !== globalThis.canvas?.scene) return;
  const flags = changed.flags?.[MODULE_ID];
  if (!flags) return;
  // the listen list only changes where people listen from, which is worked out on every volume update
  if ("listenlist" in flags || "-=listenlist" in flags) _schedule_volume_update();
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

Hooks.on("updateActor", (_actor, changed, _options, _userId) => {
  // owners speak through their actor's tokens
  if ("ownership" in changed && globalThis.canvas?.ready) _rebuild_all_sources();
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
    if (!game.user.isGM) return;
    // no canvas (mid scene change, or disabled) means nothing is selected; clear it so players stop hearing the GM there
    const selected = globalThis.canvas?.ready ? canvas.tokens.controlled.map(token => token.document.uuid).sort() : [];
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
  // a player's assigned character speaks for them
  if ("character" in changed && globalThis.canvas?.ready) _rebuild_all_sources();
  const flags = changed.flags?.[MODULE_ID];
  if (flags !== undefined) {
    if ("selected_tokens" in flags || "-=selected_tokens" in flags) _rebuild_all_sources();
    _schedule_volume_update();
    if (game.user.isGM) _refresh_gm_buttons();
  }
});

Hooks.on("userConnected", (user, connected) => {
  // a user who leaves comes back on Normal
  if (!connected && _voice_modes.delete(user.id) && globalThis.canvas?.ready) _rebuild_all_sources();
  // a GM joining or leaving changes who speaks through the tokens they have selected
  if (user.isGM && globalThis.canvas?.ready) _rebuild_all_sources();
  else _schedule_volume_update();
});

/** Every script's own version; they all match the installed module unless a browser has an old one cached */
function _script_versions() {
  return [SCRIPT_VERSION, UI_SCRIPT_VERSION, DIAG_SCRIPT_VERSION, AUDIO_SCRIPT_VERSION, PROPAGATION_SCRIPT_VERSION];
}

Hooks.once("ready", () => {
  const installed = game.modules.get(MODULE_ID).version;
  const versions = _script_versions();
  if (versions.every(version => version === installed)) return;
  const script = [...new Set(versions)].join(" / ");
  const message = game.i18n.format("proximity-voice-chat.UI.StaleScript", { script, installed });
  console.error(MODULE_ID + " | " + message);
  ui.notifications.error(message, { permanent: true });
});

Hooks.on("canvasTearDown", (_canvas) => {
  _token_proximity_data.clear();
  _forget_walls();
  if (game.user.isGM) _share_gm_selection();
});

Hooks.on("canvasReady", (_canvas) => {
  // also clears a selection left over from a previous session or scene
  if (game.user.isGM) _share_gm_selection();
  _forget_walls();
  _rebuild_all_sources();
});

let _wall_rebuild_timeout = null;
function _on_wall_change() {
  // walls and doors affect audio line of sight; rebuild after core has refreshed its edges
  clearTimeout(_wall_rebuild_timeout);
  _wall_rebuild_timeout = setTimeout(() => {
    _forget_walls();
    _rebuild_all_sources();
  }, 50);
}
Hooks.on("createWall", _on_wall_change);
Hooks.on("updateWall", _on_wall_change);
Hooks.on("deleteWall", _on_wall_change);

/**
 * Foundry replaces a user's camera element whenever it re-renders their tile, and the new one starts unmuted at
 * their plain volume. For anyone the advanced path is playing, mute it at once rather than a moment later, or
 * they'd be heard twice, at the wrong volume, until the next update.
 */
function _mute_replaced_elements() {
  for (const user of game.users) {
    if (!user.active || user.isSelf || voice_status(user.id).path !== "advanced") continue;
    const audio_element = _get_audio_element(user.id);
    if (!audio_element || _muted_elements.has(audio_element)) continue;
    audio_element.muted = true;
    _muted_elements.add(audio_element);
  }
}

Hooks.on("renderCameraViews", (_application, _element, _context, _options) => {
  if (game.user.isGM) _add_gm_voice_buttons();
  _mute_replaced_elements();
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
/** Relay server errors a voice connection reported while gathering addresses */
const _PEER_RELAY_ERRORS = Symbol("proximity-voice-chat.relayErrors");
/** Set on a SimplePeerAVClient once connect() has finished, i.e. its socket listeners are up and it can take calls */
const _CLIENT_READY = Symbol("proximity-voice-chat.clientReady");
const _LAST_CALL_REQUEST = Symbol("proximity-voice-chat.lastCallRequest");
const _CALL_REQUEST_INTERVAL_MS = 4000;
/** An offer we sent this recently may simply have crossed the other side's call request in flight */
const _CALL_IN_FLIGHT_MS = 5000;
const _SOCKET = "module." + MODULE_ID;

/** Set by _patch_simplepeer: answers another user's request that we call them */
let _on_call_request = null;

/**
 * Asks each user who is meant to call us (the lower ID of each pair) to do so now, if we have no connection to them.
 * Foundry only retries connections every 8 seconds, so without this someone who reloads waits that long per person.
 * @param {foundry.av.clients.SimplePeerAVClient} client
 */
function _request_calls(client) {
  if (!client?.[_CLIENT_READY] || !game.socket) return;
  const last = client[_LAST_CALL_REQUEST] ??= {};
  for (const user of game.users) {
    if (!user.active || user.isSelf || game.userId < user.id) continue;
    if (client.peers.has(user.id)) continue;
    if (Date.now() - (last[user.id] ?? 0) < _CALL_REQUEST_INTERVAL_MS) continue;
    last[user.id] = Date.now();
    game.socket.emit(_SOCKET, { action: "call-me", from: game.userId, to: user.id });
  }
}

/* -------------------------------------------- */
/*  Connection self-test                        */
/* -------------------------------------------- */

/**
 * The relay (TURN) server from Foundry's A/V settings, if one is configured
 * @returns {{url: string, username: string, password: string} | null}
 */
function _custom_relay() {
  const turn = game.webrtc?.settings?.world?.turn;
  if (turn?.type !== "custom" || !turn.url || !turn.username || !turn.password) return null;
  return turn;
}

/**
 * The ICE servers Foundry's voice chat uses: a custom relay replaces SimplePeer's default STUN servers entirely
 * @returns {Array<RTCIceServer>}
 */
function _ice_servers() {
  const relay = _custom_relay();
  if (relay) return [{ urls: relay.url, username: relay.username, credential: relay.password }];
  return globalThis.SimplePeer?.config?.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
}

/**
 * Gathers this browser's network addresses ("ICE candidates") with a throwaway connection, the way a voice
 * connection would. A browser that offers none can't be reached by anyone, relay or not.
 * @param {number} [timeout] ms to wait for gathering to finish
 * @returns {Promise<{supported: boolean, types: Record<string, number>}>} candidate counts by type (host, srflx, relay, ...)
 */
async function _gather_own_addresses(timeout = 6000) {
  const PeerConnection = globalThis.RTCPeerConnection;
  if (!PeerConnection) return { supported: false, types: {} };
  const types = {};
  const errors = [];
  let connection;
  try {
    connection = new PeerConnection({ iceServers: _ice_servers() });
    _watch_relay_errors(connection, errors);
    connection.createDataChannel("proximity-voice-chat-self-test");
    const gathered = new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);
      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timer);
          return resolve();
        }
        const type = event.candidate.type ?? event.candidate.candidate?.match(/ typ (\w+)/)?.[1];
        if (type) types[type] = (types[type] ?? 0) + 1;
      };
    });
    await connection.setLocalDescription(await connection.createOffer());
    await gathered;
  } catch (err) {
    console.warn(MODULE_ID + " | connection self-test failed", err);
    if (!connection) return { supported: false, types: {} };
  } finally {
    connection?.close();
  }
  return { supported: true, types, relayError: _relay_error(errors, !!types.relay) };
}

/**
 * Turns a self-test result into a problem code
 * @param {{supported: boolean, types: Record<string, number>}} result
 * @returns {"webrtc-disabled" | "no-addresses" | "relay-unreachable" | null}
 */
function _self_test_problem(result) {
  if (!result.supported) return "webrtc-disabled";
  if (!Object.values(result.types).some(count => count > 0)) return "no-addresses";
  if (_custom_relay() && !result.types.relay) return "relay-unreachable";
  return null;
}

/** @type {{supported: boolean, types: Record<string, number>, problem: string | null, audio?: object} | null} */
let _self_test = null;

/**
 * Tests this browser's ability to make voice connections, warns you if it can't, and tells the GMs, since players
 * can't be expected to watch their consoles
 * @param {{relay_changed?: boolean}} [options] relay_changed: the GM just changed the relay settings
 */
async function _run_self_test({ relay_changed = false } = {}) {
  if (!_is_voice_active()) return;
  const result = await _gather_own_addresses();
  const problem = _self_test_problem(result);
  _self_test = { ...result, problem, audio: get_audio_status() };
  if (problem === "webrtc-disabled" || problem === "no-addresses") {
    ui.notifications.error("proximity-voice-chat.SelfTest." + problem, { localize: true, permanent: true });
  } else if (problem === "relay-unreachable" && game.user.isGM) {
    ui.notifications.warn(_relay_unreachable_text(result.relayError), { permanent: true });
  } else if (!problem && relay_changed && game.user.isGM && _custom_relay()) {
    ui.notifications.info("proximity-voice-chat.SelfTest.relay-ok", { localize: true });
  }
  if (problem) console.warn(MODULE_ID + " | connection self-test: " + problem, result.types, result.relayError ?? "");
  // a relay address alone doesn't prove the relay carries anything, so players also test a real relayed path
  if (!problem && _custom_relay() && !game.user.isGM) await run_relay_test();
  // the advanced audio path is part of the self-test: asking for its status starts it, if it can start
  _known_audio_reason = undefined;
  _check_audio_path();
}

function _report_self_test() {
  if (!_self_test || game.user.isGM) return;
  game.socket?.emit(_SOCKET, {
    action: "voice-self-test", from: game.user?.id ?? game.userId, problem: _self_test.problem, types: _self_test.types,
    relayError: _self_test.relayError ?? null, relayTest: _relay_test,
    audio: _self_test.audio ? { path: _self_test.audio.path, reason: _self_test.audio.reason, detail: _self_test.audio.detail } : null
  });
}

/** The last self-test problem and relay test result each user reported, so a GM isn't shown the same notice twice */
const _reported_problems = new Map();
const _reported_relay = new Map();
const _reported_audio = new Map();

/**
 * Shows a GM another user's failed self-test or relay test, by name, with what to do about it
 * @param {{from: string, problem: string | null, relayError?: object, relayTest?: object}} message
 */
function _on_self_test_report(message) {
  if (!game.user.isGM) return;
  const user = game.users.get(message.from);
  const previous = _reported_problems.get(message.from) ?? null;
  _reported_problems.set(message.from, message.problem ?? null);
  if (user && message.problem && message.problem !== previous) {
    const text = message.problem === "relay-unreachable"
      ? game.i18n.format("proximity-voice-chat.SelfTest.Player.relay-unreachable", { name: user.name }) + _relay_reason_suffix(message.relayError)
      : game.i18n.format("proximity-voice-chat.SelfTest.Player." + message.problem, { name: user.name });
    ui.notifications[message.problem === "relay-unreachable" ? "warn" : "error"](text, { permanent: true });
  }
  const status = message.relayTest?.status ?? null;
  const previous_status = _reported_relay.get(message.from) ?? null;
  _reported_relay.set(message.from, status);
  if (user && (status === "no-allocation" || status === "no-route") && status !== previous_status) {
    const text = game.i18n.format("proximity-voice-chat.RelayTest.Player." + status, { name: user.name }) + _relay_reason_suffix(message.relayTest.error);
    ui.notifications.warn(text, { permanent: true });
  }
  // a browser that fell back to the old audio path still works, so this is a warning that goes away by itself
  const audio = AUDIO_PROBLEMS.includes(message.audio?.reason) ? message.audio.reason : null;
  const previous_audio = _reported_audio.get(message.from) ?? null;
  _reported_audio.set(message.from, audio);
  if (user && audio && audio !== previous_audio) {
    ui.notifications.warn(game.i18n.format("proximity-voice-chat.Audio.Player.Fallback", { name: user.name })
      + " " + game.i18n.localize("proximity-voice-chat.Audio.Reason." + audio));
  }
}

/* -------------------------------------------- */
/*  Relay errors and the pairwise relay test    */
/* -------------------------------------------- */

/** What relay (TURN) server error codes mean */
const _RELAY_ERRORS = { 401: "credentials", 403: "forbidden", 486: "full", 508: "capacity", 701: "unreachable" };

/** Most telling first: a full or overloaded relay, then a login or permission problem, then the rest */
const _RELAY_ERROR_PRIORITY = [486, 508, 401, 403];

/**
 * Records relay server errors a connection reports while gathering addresses ("icecandidateerror"). The relay's own
 * log may not show them (coturn doesn't log 486 at its default verbosity), so the browser is often the only witness.
 * Only errors from turn: URLs count; STUN failures are normal on some networks.
 * @param {RTCPeerConnection} connection
 * @param {Array<object>} errors collected into
 */
function _watch_relay_errors(connection, errors) {
  const handler = (event) => {
    if (!/^turns?:/.test(String(event.url ?? ""))) return;
    errors.push({ code: event.errorCode, text: event.errorText ?? "", url: event.url });
  };
  if (typeof connection?.addEventListener === "function") connection.addEventListener("icecandidateerror", handler);
}

/**
 * The most telling relay error, or null. Browsers report a 701 for every network interface that can't reach the relay,
 * so once any relay address came through, these errors don't mean anything is wrong.
 * @param {Array<{code: number, text: string, url: string}>} errors
 * @param {boolean} got_relay
 * @returns {{code: number, reason: string, text: string} | null}
 */
function _relay_error(errors, got_relay) {
  if (got_relay || !errors.length) return null;
  const pick = _RELAY_ERROR_PRIORITY.map(code => errors.find(e => e.code === code)).find(Boolean)
    ?? errors.find(e => e.code !== 701) ?? errors[0];
  return { code: pick.code, reason: _RELAY_ERRORS[pick.code] ?? "other", text: pick.text };
}

/**
 * " (relay server is full, error 486)" and the like, for appending to a notice
 * @param {{code: number, reason: string, text: string} | null | undefined} error
 * @returns {string}
 */
function _relay_reason_suffix(error) {
  if (!error) return "";
  return " " + game.i18n.format("proximity-voice-chat.RelayTest.Because", {
    reason: game.i18n.localize("proximity-voice-chat.RelayTest.Reason." + error.reason), code: error.code
  });
}

function _relay_unreachable_text(error) {
  return game.i18n.localize("proximity-voice-chat.SelfTest.relay-unreachable") + _relay_reason_suffix(error);
}

const _sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Resolves once a connection has finished gathering its addresses, or after the timeout
 * @param {RTCPeerConnection} connection
 * @param {number} timeout
 */
function _gathered(connection, timeout) {
  return new Promise((resolve) => {
    if (connection.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, timeout);
    connection.addEventListener("icegatheringstatechange", () => {
      if (connection.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

const _RELAY_TEST_TIMEOUTS = { gather: 5000, answer: 10000, open: 10000, ping: 3000 };
const _RELAY_TEST_PINGS = 3;

/**
 * The latest relay test result for this browser
 * @type {{status: string, rttMs?: number, error?: object | null, at: number} | null}
 */
let _relay_test = null;

/** Answers this player is waiting for from the GM's browser, by test ID */
const _pending_relay_answers = new Map();

/**
 * Tests the relay end to end: a throwaway data connection from this (player's) browser to the GM's browser, where
 * this side may only use the relay and the GM's side may use anything. That's the path real relayed voice takes:
 * through the relay's port forwards and outbound NAT to the GM's public address. A relay address alone (the
 * self-test) doesn't show traffic gets through, and a test inside one browser would pass without exercising those.
 * Status: "ok", "no-allocation" (no relay slot), "no-route" (a slot, but nothing gets through), "no-answer" (the GM's
 * browser didn't respond: inconclusive), "no-gm", "is-gm" (GMs aren't tested against themselves), "error".
 * @param {Partial<typeof _RELAY_TEST_TIMEOUTS>} [timeouts]
 * @returns {Promise<object | null>}
 */
export async function run_relay_test(timeouts = {}) {
  const limits = { ..._RELAY_TEST_TIMEOUTS, ...timeouts };
  const PeerConnection = globalThis.RTCPeerConnection;
  if (!_custom_relay() || !PeerConnection) return (_relay_test = null);
  if (game.user.isGM) return (_relay_test = { status: "is-gm", at: Date.now() });
  const gm = game.users.activeGM;
  if (!gm) return (_relay_test = { status: "no-gm", at: Date.now() });

  const id = foundry.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
  const errors = [];
  let got_relay = false;
  let connection = null;
  const finish = (status, extra = {}) => {
    connection?.close();
    _pending_relay_answers.delete(id);
    const error = status === "ok" ? null : _relay_error(errors, got_relay);
    _relay_test = { status, ...extra, error, at: Date.now() };
    if (status !== "ok") console.warn(MODULE_ID + " | relay test: " + status, error ?? "");
    return _relay_test;
  };
  try {
    connection = new PeerConnection({ iceServers: _ice_servers(), iceTransportPolicy: "relay" });
    _watch_relay_errors(connection, errors);
    connection.addEventListener("icecandidate", (event) => {
      const type = event.candidate?.type ?? event.candidate?.candidate?.match(/ typ (\w+)/)?.[1];
      if (type === "relay") got_relay = true;
    });
    const channel = connection.createDataChannel("proximity-voice-chat-relay-test");
    const opened = new Promise(resolve => { channel.onopen = () => resolve(true); });
    await connection.setLocalDescription(await connection.createOffer());
    await _gathered(connection, limits.gather);
    if (!got_relay) return finish("no-allocation");

    const answered = new Promise((resolve) => {
      _pending_relay_answers.set(id, resolve);
      setTimeout(() => resolve(null), limits.answer);
    });
    game.socket.emit(_SOCKET, { action: "relay-test-offer", from: game.user.id, to: gm.id, id, sdp: connection.localDescription.sdp });
    const sdp = await answered;
    if (!sdp) return finish("no-answer");
    await connection.setRemoteDescription({ type: "answer", sdp });
    if (!(await Promise.race([opened, _sleep(limits.open).then(() => false)]))) return finish("no-route");

    const rtts = [];
    for (let n = 0; n < _RELAY_TEST_PINGS; n++) {
      const started = performance.now();
      const pong = new Promise(resolve => { channel.onmessage = (event) => { if (event.data === "pong:" + n) resolve(true); }; });
      channel.send("ping:" + n);
      if (!(await Promise.race([pong, _sleep(limits.ping).then(() => false)]))) return finish("no-route");
      rtts.push(performance.now() - started);
    }
    return finish("ok", { rttMs: Math.round(rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length) });
  } catch (err) {
    console.warn(MODULE_ID + " | relay test failed", err);
    return finish("error");
  }
}

/**
 * The GM's side of a relay test: answer the player's offer and echo their pings. It gathers its public address with
 * plain STUN rather than reserving a relay slot of its own, so the relayed hop is the player's.
 * @param {{from: string, to: string, id: string, sdp: string}} message
 */
async function _answer_relay_test(message) {
  const PeerConnection = globalThis.RTCPeerConnection;
  if (!game.user.isGM || message.to !== game.user.id || !PeerConnection) return;
  const connection = new PeerConnection({ iceServers: globalThis.SimplePeer?.config?.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }] });
  connection.addEventListener("datachannel", (event) => {
    const channel = event.channel;
    channel.onmessage = (incoming) => {
      if (typeof incoming.data === "string" && incoming.data.startsWith("ping:")) channel.send("pong:" + incoming.data.slice(5));
    };
  });
  setTimeout(() => connection.close(), 30000);
  try {
    await connection.setRemoteDescription({ type: "offer", sdp: message.sdp });
    await connection.setLocalDescription(await connection.createAnswer());
    await _gathered(connection, _RELAY_TEST_TIMEOUTS.gather);
    game.socket.emit(_SOCKET, { action: "relay-test-answer", from: game.user.id, to: message.from, id: message.id, sdp: connection.localDescription.sdp });
  } catch (err) {
    console.warn(MODULE_ID + " | could not answer a relay test", err);
    connection.close();
  }
}

/**
 * A relay test that couldn't run or reach the GM gets another go, e.g. once a GM has loaded
 * @returns {Promise<void>}
 */
async function _retest_relay_if_needed() {
  if (game.user.isGM || !_self_test || _self_test.problem || !_custom_relay()) return;
  if (_relay_test && !["no-gm", "no-answer", "error"].includes(_relay_test.status)) return;
  await run_relay_test();
}

Hooks.on("rtcSettingsChanged", (_settings, changed) => {
  // everyone re-tests when the GM changes the relay, so the GM finds out at once whether it works
  if (changed?.world?.turn !== undefined) _run_self_test({ relay_changed: true });
});

/**
 * Whether a voice connection runs directly or through a relay, from the browser's own connection statistics
 * @param {object} peer a SimplePeer instance
 * @returns {Promise<string>}
 */
async function _peer_route(peer) {
  const connection = peer?._pc;
  if (!connection?.getStats) return "none";
  try {
    const stats = await connection.getStats();
    let pair = null;
    stats.forEach(report => {
      if (report.type === "transport" && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId) ?? pair;
    });
    if (!pair) stats.forEach(report => {
      if (report.type === "candidate-pair" && report.state === "succeeded" && (report.selected || report.nominated)) pair = report;
    });
    if (!pair) return "not established";
    const local = stats.get(pair.localCandidateId)?.candidateType;
    const remote = stats.get(pair.remoteCandidateId)?.candidateType;
    if (local === "relay") return "relayed (through your relay connection)";
    if (remote === "relay") return "relayed (through theirs)";
    return "direct";
  } catch {
    return "unknown";
  }
}

Hooks.once("ready", () => {
  game.socket.on(_SOCKET, (message) => {
    if (message?.action === "call-me" && message.to === game.userId) _on_call_request?.(message.from);
    if (message?.action === "voice-self-test") _on_self_test_report(message);
    // a GM who loads later asks everyone for their self-test results; a relay test that was waiting for a GM runs now
    if (message?.action === "voice-self-test-request") _retest_relay_if_needed().then(_report_self_test);
    if (message?.action === "relay-test-offer") _answer_relay_test(message);
    if (message?.action === "relay-test-answer" && message.to === game.userId) _pending_relay_answers.get(message.id)?.(message.sdp);
    if (message?.action === "voice-mode") _apply_voice_mode(message.from, message.mode);
    // someone who just loaded asks for everyone's mode; only non-Normal modes need an answer
    if (message?.action === "voice-mode-request" && get_voice_mode(game.user) !== VOICE_MODES.NORMAL) {
      game.socket.emit(_SOCKET, { action: "voice-mode", from: game.user.id, mode: get_voice_mode(game.user) });
    }
  });
  game.socket.emit(_SOCKET, { action: "voice-mode-request", from: game.userId });
  if (game.user?.isGM) game.socket.emit(_SOCKET, { action: "voice-self-test-request", from: game.userId });
  _run_self_test();
});

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
    _watch_relay_errors(peer._pc, peer[_PEER_RELAY_ERRORS] = []);
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

  const original_connect = proto.connect;
  const original_disconnect = proto.disconnect;
  proto.connect = async function (...args) {
    const result = await original_connect.apply(this, args);
    this[_CLIENT_READY] = true;
    _request_calls(this);
    return result;
  };
  proto.disconnect = async function (...args) {
    this[_CLIENT_READY] = false;
    return original_disconnect.apply(this, args);
  };

  _on_call_request = (from) => {
    const client = game.webrtc?.client;
    if (!(client instanceof client_class) || !client[_CLIENT_READY]) return;
    if (game.userId > from) return;// they are the caller for this pair
    const peer = client.peers.get(from);
    if (peer && !peer.destroyed && !_is_peer_up(peer) && Date.now() - (peer[_PEER_STARTED] ?? 0) < _CALL_IN_FLIGHT_MS) return;
    // they have no connection to us, so whatever we hold for them is dead
    if (game.settings.get(MODULE_ID, "debug")) console.log(MODULE_ID + " | " + game.users.get(from)?.name + " asked to be called");
    if (peer) drop_peer.call(client, from);
    original_initialize_peer_stream.call(client, from);
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
 * Sets whether a user hears everyone. A GM can set it for any user, e.g. a user that records the session.
 * @param {foundry.documents.User} user
 * @param {boolean} enabled
 * @returns {Promise}
 */
export function set_global_listener(user, enabled) {
  return user.setFlag(MODULE_ID, "global_listener", enabled);
}

/**
 * Sets whether everyone hears a user. A GM can set it for any user.
 * @param {foundry.documents.User} user
 * @param {boolean} enabled
 * @returns {Promise}
 */
export function set_global_speaker(user, enabled) {
  return user.setFlag(MODULE_ID, "global_speaker", enabled);
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
 * How another user currently reaches you, as last applied: how muffled, by what, and from which side
 * @param {string} user_id
 * @returns {{volume: number, muffle: number, cutoff: number, pan: number, via?: string, walls?: Record<string, number>, length?: number, bends?: number} | null}
 *   volume: by distance alone, as get_user_volume; muffle: 0 to 1; cutoff: the low-pass filter in Hz (20000 is
 *   none); pan: -1 left to 1 right; via: "open", "through" (walls), "around" (them) or "blocked", when they're
 *   heard by proximity; walls: how many of each kind are crossed; length (pixels) and bends: of the way round
 */
export function get_user_hearing(user_id) {
  const hearing = _last_hearing.get(user_id);
  if (!hearing) return null;
  const { from, plainWalls, ...rest } = hearing;
  return rest;
}

/**
 * How far a user's voice can travel at most, per token they speak through. With sound propagation it goes
 * through and round walls, so it can be heard, muffled, outside the areas get_voice_reach gives.
 * @param {foundry.documents.User} user
 * @returns {Array<{x: number, y: number, radius: number}>} empty when sound propagation is off
 */
export function get_voice_range(user) {
  if (!game.settings.get(MODULE_ID, "soundPropagation")) return [];
  const range = _mode_range(get_voice_mode(user));
  const circles = [];
  for (const data of _token_proximity_data.values()) {
    if (!data.userlist.includes(user.uuid) || !data.origin) continue;
    circles.push({ x: data.origin.x, y: data.origin.y, radius: data.radius * range });
  }
  return circles;
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
 * Whether this client can see a token, so a player's own diagnostics don't reveal hidden tokens' names
 * @param {string} uuid
 * @returns {boolean}
 */
function _can_see_token(uuid) {
  if (game.user.isGM) return true;
  const token = globalThis.canvas?.tokens?.placeables.find(t => t.document.uuid === uuid);
  return !!token && (token.visible || token.document.testUserPermission?.(game.user, "OBSERVER"));
}

/**
 * Gathers everything about this client's voice: its own setup and one entry per other active user.
 * @param {object} [options]
 * @param {boolean} [options.redact] for a player's own view: hide names of tokens they can't see, and others'
 *   voice modes unless they can hear them. Reports sent to a GM are collected without redaction.
 * @returns {Promise<object>}
 */
/**
 * What this browser's microphone is actually doing. Foundry reports "muted" both for a muted microphone and for
 * one that isn't capturing at all, which hides the real cause.
 * @returns {Promise<object>}
 */
async function _microphone_state() {
  const client = game.webrtc?.client;
  const local = client?.localStream ?? client?.getMediaStreamForUser?.(game.user.id) ?? null;
  const track = local?.getAudioTracks?.()[0] ?? null;
  let permission = "unknown";
  try {
    permission = (await navigator.permissions?.query({ name: "microphone" }))?.state ?? "unknown";
  } catch {
    // not every browser can be asked about the microphone permission
  }
  const device = game.webrtc?.settings?.client?.audioSrc ?? null;
  let devices = null;
  try {
    devices = await client?.getAudioSources?.() ?? null;
  } catch {
    devices = null;
  }
  return {
    capturing: track?.readyState === "live",
    trackEnabled: track ? track.enabled : null,
    permission,
    device,
    deviceLabel: devices?.[device] ?? null,
    deviceFound: device === "default" || device === "disabled" || !devices ? null : Object.hasOwn(devices, device),
    activation: game.webrtc?.settings?.client?.voice?.mode ?? null,
    transmitting: !!game.webrtc?.broadcasting
  };
}

export async function collect_diagnostics({ redact = false } = {}) {
  const listeners = globalThis.canvas?.ready ? _get_listener_positions() : [];
  const relay = _custom_relay();
  const own = _self_test ?? { ...(await _gather_own_addresses()), problem: null };
  own.problem ??= _self_test_problem(own);
  const me = game.webrtc?.settings?.getUser(game.user.id);
  const self = {
    id: game.user.id,
    name: game.user.name,
    isGM: game.user.isGM,
    foundry: game.version,
    module: game.modules.get(MODULE_ID).version,
    scripts: [...new Set(_script_versions())].join(" / "),
    browser: navigator.userAgent,
    canvasReady: !!globalThis.canvas?.ready,
    voiceActive: _is_voice_active(),
    sceneDisabled: !!(globalThis.canvas?.ready ? canvas.scene : game.scenes?.viewed)?.getFlag(MODULE_ID, "disabled"),
    globalListener: is_global_listener(game.user),
    globalSpeaker: is_global_speaker(game.user),
    voiceMode: get_voice_mode(game.user),
    micMuted: !!me?.muted,
    mic: await _microphone_state(),
    connectionFix: !!game.settings.get(MODULE_ID, "fixPeerConnections"),
    deafened: !!game.webrtc?.settings?.client?.muteAll,
    listeningThrough: globalThis.canvas?.ready ? _get_listener_tokens().map(token => token.name) : [],
    speakingThrough: Array.from(_token_proximity_data.values()).filter(data => data.userlist.includes(game.user.uuid)).map(data => data.name),
    relay: relay ? relay.url : null,
    webrtcSupported: own.supported,
    addresses: own.types,
    addressProblem: own.problem,
    relayError: own.relayError ?? null,
    relayTest: _relay_test,
    audio: get_audio_status(),
    soundPropagation: !!game.settings.get(MODULE_ID, "soundPropagation"),
    muffle: Object.fromEntries(WALL_KINDS.map(kind => [kind, game.settings.get(MODULE_ID, _muffle_setting(kind))])),
    directional: game.settings.get(MODULE_ID, "directionalAudio") ? game.settings.get(MODULE_ID, "directionalStrength") : 0
  };
  const users = game.users.filter(user => user.active && !user.isSelf);
  const routes = await Promise.all(users.map(user => _peer_route(game.webrtc?.client?.peers?.get(user.id))));
  const peers = users.map((user, index) => {
    const element = _get_audio_element(user.id);
    // what they send us, from the incoming stream itself: Foundry only creates an audio element for users it shows
    const stream = game.webrtc?.client?.getMediaStreamForUser?.(user.id) ?? element?.srcObject;
    const tracks = typeof stream?.getAudioTracks === "function" ? stream.getAudioTracks() : [];
    const settings = game.webrtc?.settings?.getUser(user.id);
    const heard = _calculate_user_volume(user, listeners);
    let { volume, reason, token } = heard;
    if (redact && token && !_can_see_token(token.uuid)) reason = reason.replace("\"" + token.name + "\"", "you can't see");
    // how the sound gets here; a player's own view doesn't tell secret doors from the walls they look like
    const muffle = heard.hearing?.muffle ?? 0;
    const walls = (redact ? heard.hearing?.plainWalls : heard.hearing?.walls) ?? null;
    const audio = _audio_path_blocker() ? { path: "old", reason: _audio_path_blocker() } : voice_status(user.id);
    // Foundry's getConnectedUsers() lists anyone with a connection object, even one that never finished,
    // so ask the browser's own connection state instead
    const peer = game.webrtc?.client?.peers?.get(user.id);
    const state = peer?._pc?.connectionState ?? null;
    const connected = state === "connected";
    // a user with no microphone (or with audio input off, like a recording client) sends no audio tracks at all;
    // their element stays paused because there's nothing to play, which isn't a fault
    const receiving_audio = tracks.some(track => track.readyState === "live");
    // and what we send them: our outgoing audio on this connection, if the browser exposes it
    const senders = typeof peer?._pc?.getSenders === "function" ? peer._pc.getSenders() : null;
    const sending_audio = senders ? senders.some(sender => sender.track?.kind === "audio" && sender.track.readyState === "live") : null;
    // "Hide User" on a camera tile: Foundry then plays none of their audio, and with the dock hidden it's invisible
    const hidden = !!settings?.blocked;
    let problem = null;
    if (own.problem === "no-addresses" || own.problem === "webrtc-disabled") problem = "own-browser";
    else if (!peer) problem = "no-connection";
    else if (!connected) problem = "not-established";
    else if (hidden) problem = "hidden";
    else if (receiving_audio && !element) problem = "no-audio-element";
    else if (receiving_audio && element.paused) problem = "paused";
    return {
      id: user.id,
      name: user.name,
      isGM: user.isGM,
      connected,
      connectionState: state,
      iceState: peer?._pc?.iceConnectionState ?? null,
      weCalled: peer ? !!peer.initiator : null,
      route: routes[index],
      problem,
      voiceMode: redact && !(volume > 0) ? null : get_voice_mode(user),
      hidden,
      // only worth showing for a connection that never came up
      relayError: connected ? null : _relay_error(peer?.[_PEER_RELAY_ERRORS] ?? [], false),
      receivingAudio: receiving_audio,
      sendingAudio: sending_audio,
      muted: !!settings?.muted,
      audioBlocked: settings ? !settings.canBroadcastAudio : false,
      volume: Number(volume.toFixed(2)),
      reason,
      // "around corners (route 14 tiles, 2 bends)", "through 1 closed door (muffled 50%)"; empty unless by proximity
      heard: heard.hearing?.via ? describe_hearing(heard.hearing, { grid: canvas.scene?.grid?.size ?? 100, redact }) : "",
      via: heard.hearing?.via ?? null,
      walls,
      routeLength: heard.hearing?.length != null ? Math.round(heard.hearing.length) : null,
      bends: heard.hearing?.bends ?? null,
      muffle: Number(muffle.toFixed(2)),
      cutoff: Math.round(muffle_cutoff(muffle)),
      pan: Number(_pan_for(heard).toFixed(2)),
      // which path plays them: "advanced" with the gain, filter and pan in force, or "old" and why
      audio: audio.path === "advanced" ? { path: "advanced", gain: Number(audio.gain.toFixed(2)), cutoff: Math.round(audio.cutoff), pan: Number(audio.pan.toFixed(2)) } : audio,
      slider: Number(get_user_voice_volume(user.id).toFixed(2)),
      element: element ? (element.tagName?.toLowerCase() ?? "media") : null,
      elementVolume: element ? Number(element.volume.toFixed(2)) : null,
      paused: element?.paused ?? null,
      elementMuted: element?.muted ?? null,
      audioTracks: tracks.map(t => (t.enabled ? "on" : "off") + "/" + t.readyState + (t.muted ? "/no-data" : "")).join(", ") || "none"
    };
  });
  return { at: Date.now(), redacted: redact, self, peers };
}

const _PROBLEM_TEXT = {
  "own-browser": "YOUR BROWSER can't make voice connections; see yourAddressProblem above",
  "no-connection": "NO VOICE CONNECTION to this user (not even an attempt)",
  "not-established": "voice connection not established; look for 'ICE failed' or SimplePeer errors",
  "hidden": "you've hidden this user (camera dock or players list), so their audio doesn't play",
  "no-audio-element": "connected but no audio element",
  "paused": "audio element paused"
};

/**
 * Logs what this client thinks about every other active user's voice, for troubleshooting.
 * Run in the browser console (F12) or a macro: game.modules.get("proximity-voice-chat").api.diagnose()
 * Players can use Configure Settings > Voice Diagnostics instead, which shows the same data in a window.
 * @returns {Promise<Array<object>>} one row per other active user
 */
export async function diagnose() {
  const { self, peers } = await collect_diagnostics();
  console.log(MODULE_ID + " | diagnose", {
    foundry: self.foundry,
    module: self.module,
    scripts: self.scripts,
    canvasReady: self.canvasReady,
    voiceActive: self.voiceActive,
    sceneDisabled: self.sceneDisabled,
    youAreGlobalListener: self.globalListener,
    youAreGlobalSpeaker: self.globalSpeaker,
    yourVoiceMode: self.voiceMode,
    listeningThrough: self.listeningThrough.join(", ") || "nothing",
    speakingThrough: self.speakingThrough.join(", ") || "nothing",
    proximityTokens: _token_proximity_data.size,
    deafenedAll: self.deafened,
    relayServer: self.relay ?? "none (Foundry's default: no relay)",
    yourAddresses: self.webrtcSupported ? Object.entries(self.addresses).map(([type, count]) => type + " " + count).join(", ") || "NONE" : "WebRTC disabled",
    yourAddressProblem: self.addressProblem ?? "none",
    yourMicrophone: self.mic,
    connectionFix: self.connectionFix,
    audioPath: self.audio.path + (self.audio.reason ? " (" + self.audio.reason + (self.audio.detail ? ": " + self.audio.detail : "") + ")" : ""),
    voiceBoost: self.audio.boost,
    soundPropagation: self.soundPropagation,
    muffle: self.muffle,
    directional: self.directional
  });
  const rows = peers.map(peer => ({
    user: peer.name,
    connected: peer.connected,
    problem: peer.problem ? _PROBLEM_TEXT[peer.problem] + (peer.problem === "not-established" ? " (" + (peer.connectionState ?? "unknown") + ")" : "") : "none",
    voiceMode: peer.voiceMode,
    hidden: peer.hidden,
    receivingAudio: peer.receivingAudio,
    sendingAudio: peer.sendingAudio,
    connection: peer.connectionState === null ? "none" : peer.connectionState + "/" + peer.iceState + (peer.weCalled ? " (we called)" : " (they called)"),
    route: peer.route,
    mutedOrBlocked: peer.muted || peer.audioBlocked,
    proximity: peer.volume,
    reason: peer.reason,
    heard: peer.heard,
    muffle: peer.muffle,
    audio: peer.audio.path === "advanced" ? "advanced: gain " + peer.audio.gain + ", filter " + peer.audio.cutoff + " Hz, pan " + peer.audio.pan
      : "old" + (peer.audio.reason ? " (" + peer.audio.reason + ")" : ""),
    slider: peer.slider,
    element: peer.element ?? "MISSING",
    elementVolume: peer.elementVolume,
    paused: peer.paused,
    elementMuted: peer.elementMuted,
    audioTracks: peer.audioTracks
  }));
  console.table(rows);
  return rows;
}

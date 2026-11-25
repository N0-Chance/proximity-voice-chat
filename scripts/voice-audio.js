/**
 * The advanced voice path: plays each other player's voice through Web Audio instead of straight out of Foundry's
 * camera element, so a voice can be louder than 100%, muffled by a filter, and placed left or right.
 *
 *   their stream -> gain (proximity volume x boost, mixed to mono) -> low-pass filter (muffling) -> stereo panner (direction)
 *     -> one shared limiter -> a stream -> one hidden <audio> element, sent to Foundry's chosen output device
 *
 * It ends in an <audio> element, not the audio context's own output, because choosing an output device on a context
 * is experimental in Firefox while HTMLMediaElement.setSinkId works in Chrome and Firefox alike.
 *
 * Foundry's camera element stays attached to the stream, muted by proximity-voice-chat.js: Chrome only delivers a
 * remote WebRTC stream to Web Audio while it's also attached to a media element (crbug 933677; still true in
 * Chrome 153), and muting that element doesn't stop it.
 *
 * Anything that goes wrong here drops this browser back to the old path (the camera element's own volume), with
 * the reason kept for Voice Diagnostics. This file decides nothing about who is heard or how loud: it is handed a
 * gain, a filter cutoff and a pan per user, and says whether it's playing them.
 *
 * Talks to proximity-voice-chat.js only through the functions it exports and the listener it's given, at runtime.
 */
const MODULE_ID = "proximity-voice-chat";

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const AUDIO_SCRIPT_VERSION = "2.1.0";

/** How quickly changes are eased in, as time constants in seconds, so moving tokens don't make zipper noise */
const RAMP = { gain: 0.05, cutoff: 0.08, pan: 0.08 };

/**
 * The limiter only catches peaks that boosting pushes past full scale, so it's set high and fast: it shouldn't
 * be heard working ("pumping") on normal speech.
 */
const LIMITER = { threshold: -6, knee: 6, ratio: 12, attack: 0.003, release: 0.25 };

/**
 * Voices are mixed down to one channel before they're placed left or right, so that placing them moves them
 * without making them louder (a two-channel voice panned to one side would otherwise pile both channels into one
 * ear). Web Audio plays one channel at 71% in each ear, so this gain brings a centred voice back to the level the
 * old path plays it at.
 */
const MONO_MAKEUP = Math.SQRT2;

/** After a click, a context that still hasn't started within this long isn't going to */
const RESUME_TIMEOUT_MS = 5000;

/** Reasons that mean something is wrong with this browser, as opposed to a setting or not having clicked yet */
export const AUDIO_PROBLEMS = ["unsupported", "resume", "sink", "output", "error"];

/** @type {AudioContext | null} */
let _context = null;
/** @type {DynamicsCompressorNode | null} */
let _limiter = null;
/** @type {HTMLAudioElement | null} */
let _output = null;
/** Why this browser gave up on the advanced path, until a setting changes or it reloads */
let _failure = null;
/** The output device last asked for: "" is the browser's default, null is nothing asked yet */
let _sink = null;
let _resume_timer = null;
let _listening_for_gestures = false;

/**
 * Per user: the stream being played, its nodes, and the values they're heading for
 * @type {Map<string, {stream: MediaStream, track: MediaStreamTrack, source: AudioNode, gain: GainNode, filter: BiquadFilterNode, panner: StereoPannerNode, gain_value: number, cutoff: number, pan: number}>}
 */
const _voices = new Map();

/** Per user: a stream that couldn't be played this way, so it isn't retried every second */
const _voice_failures = new Map();

/** Told whenever the path changes, so volumes are re-applied on whichever path is now in use */
let _on_change = null;

/**
 * @param {() => void} listener called when this browser switches between the advanced and old paths
 */
export function set_voice_audio_listener(listener) {
  _on_change = listener;
}

function _changed() {
  try {
    _on_change?.();
  } catch (err) {
    console.error(MODULE_ID + " | voice audio listener failed", err);
  }
}

export function register_voice_audio_settings() {
  game.settings.register(MODULE_ID, "advancedAudio", {
    name: "proximity-voice-chat.Settings.AdvancedAudio.Label",
    hint: "proximity-voice-chat.Settings.AdvancedAudio.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => _settings_changed()
  });
  game.settings.register(MODULE_ID, "voiceBoost", {
    name: "proximity-voice-chat.Settings.VoiceBoost.Label",
    hint: "proximity-voice-chat.Settings.VoiceBoost.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 100, max: 300, step: 10 },
    default: 150,
    onChange: () => _changed()
  });
  game.settings.register(MODULE_ID, "legacyAudio", {
    name: "proximity-voice-chat.Settings.LegacyAudio.Label",
    hint: "proximity-voice-chat.Settings.LegacyAudio.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => _settings_changed()
  });
}

/**
 * Turning the advanced path off tears it down; turning it back on is also how a player retries after a failure
 */
function _settings_changed() {
  _failure = null;
  _voice_failures.clear();
  if (_setting_blocker()) _teardown();
  _changed();
}

/**
 * @returns {"disabled" | "opted-out" | null} the setting that turns the advanced path off, if one does
 */
function _setting_blocker() {
  if (!game.settings.get(MODULE_ID, "advancedAudio")) return "disabled";
  if (game.settings.get(MODULE_ID, "legacyAudio")) return "opted-out";
  return null;
}

/**
 * The output device chosen in Foundry's audio/video settings, as setSinkId wants it. Foundry calls the browser's
 * default "default", which Firefox's setSinkId rejects; the empty string means the default in both browsers.
 * @returns {string}
 */
function _wanted_sink() {
  const sink = game.webrtc?.settings?.client?.audioSink;
  return !sink || sink === "default" ? "" : sink;
}

/**
 * Gives up on the advanced path in this browser and says why
 * @param {string} code a value of AUDIO_PROBLEMS
 * @param {unknown} [error]
 */
function _fail(code, error) {
  _failure = { code, detail: String(error?.message ?? error ?? ""), sink: _wanted_sink() };
  console.warn(MODULE_ID + " | advanced voice audio failed (" + code + "), using the old audio path", error ?? "");
  _teardown();
  _changed();
}

function _teardown() {
  clearTimeout(_resume_timer);
  for (const voice of _voices.values()) _disconnect(voice);
  _voices.clear();
  if (_output) {
    try {
      _output.pause?.();
      _output.srcObject = null;
      _output.remove?.();
    } catch {
      // it's being thrown away either way
    }
  }
  try {
    _context?.close?.()?.catch?.(() => {});
  } catch {
    // already closed
  }
  _context = _limiter = _output = null;
  _sink = null;
}

function _disconnect(voice) {
  for (const node of [voice.source, voice.gain, voice.filter, voice.panner]) {
    try {
      node.disconnect();
    } catch {
      // never connected
    }
  }
}

/**
 * Builds the shared end of the graph: limiter -> stream -> hidden <audio> element. Throws if the browser can't.
 */
function _start() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("no AudioContext");
  const context = new Context({ latencyHint: "interactive" });
  for (const method of ["createMediaStreamSource", "createMediaStreamDestination", "createGain", "createBiquadFilter", "createStereoPanner", "createDynamicsCompressor"]) {
    if (typeof context[method] !== "function") {
      context.close?.()?.catch?.(() => {});
      throw new Error("no AudioContext." + method);
    }
  }
  const limiter = context.createDynamicsCompressor();
  for (const [name, value] of Object.entries(LIMITER)) limiter[name].value = value;
  const destination = context.createMediaStreamDestination();
  limiter.connect(destination);
  const output = globalThis.document.createElement("audio");
  output.autoplay = true;
  output.className = "pvc-voice-output";
  if (output.style) output.style.display = "none";
  output.srcObject = destination.stream;
  globalThis.document.body?.append?.(output);
  context.addEventListener?.("statechange", () => _changed());
  _context = context;
  _limiter = limiter;
  _output = output;
  _sink = null;
  if (context.state === "running") _play_output();
}

/**
 * Browsers start an audio context suspended until the page has been clicked or typed in
 */
function _listen_for_gestures() {
  if (_listening_for_gestures) return;
  _listening_for_gestures = true;
  for (const type of ["click", "keydown", "touchend"]) {
    globalThis.document.addEventListener(type, _on_gesture, { capture: true, passive: true });
  }
}

function _on_gesture() {
  if (!_context || _context.state === "running" || _failure) return;
  // some input, like the Escape key, doesn't count as a gesture; the browser knows which did
  if (globalThis.navigator?.userActivation && !globalThis.navigator.userActivation.hasBeenActive) return;
  const context = _context;
  Promise.resolve()
    .then(() => context.resume())
    .then(() => {
      if (_context === context) _play_output();
    })
    .catch(error => {
      if (_context === context) _fail("resume", error);
    });
  clearTimeout(_resume_timer);
  _resume_timer = setTimeout(() => {
    if (_context === context && context.state !== "running") _fail("resume", "the audio context stayed " + context.state + " after a click");
  }, RESUME_TIMEOUT_MS);
}

function _play_output() {
  const output = _output;
  if (!output || typeof output.play !== "function") return;
  Promise.resolve()
    .then(() => output.play())
    .then(() => _changed())
    .catch(error => {
      if (_output === output) _fail("output", error);
    });
}

/**
 * Sends the output element to Foundry's chosen output device, when that has changed
 */
function _apply_sink() {
  const wanted = _wanted_sink();
  if (wanted === _sink || !_output) return;
  const output = _output;
  const first = _sink === null;
  _sink = wanted;
  if (typeof output.setSinkId !== "function") {
    if (wanted) _fail("sink", "this browser can't choose an output device");
    return;
  }
  // a new element already plays on the default device
  if (first && !wanted) return;
  Promise.resolve()
    .then(() => output.setSinkId(wanted))
    .catch(error => {
      if (_output === output && _sink === wanted) _fail("sink", error);
    });
}

/**
 * Why the advanced path isn't in use right now, starting it up if nothing stands in the way
 * @returns {string | null} null when it's running; otherwise "disabled" (by the GM), "opted-out" (on this device),
 *   "waiting" (for a first click), or a value of AUDIO_PROBLEMS
 */
function _blocker() {
  const setting = _setting_blocker();
  if (setting) return setting;
  // picking a different output device is worth another go
  if (_failure?.code === "sink" && _failure.sink !== _wanted_sink()) _failure = null;
  if (_failure) return _failure.code;
  if (!_context) {
    try {
      _start();
    } catch (error) {
      _failure = { code: "unsupported", detail: String(error?.message ?? error), sink: _wanted_sink() };
      console.warn(MODULE_ID + " | advanced voice audio isn't supported here, using the old audio path", error);
      _teardown();
      return _failure.code;
    }
    _listen_for_gestures();
  }
  if (_context.state !== "running") return "waiting";
  return null;
}

/**
 * Plays a user's voice through the advanced path, or says it can't so the caller uses the old one
 * @param {string} user_id
 * @param {object} voice
 * @param {MediaStream | null} voice.stream their incoming stream
 * @param {number} voice.gain linear gain: proximity volume x their volume x boost
 * @param {number} voice.cutoff low-pass cutoff in Hz; 20000 for unmuffled
 * @param {number} voice.pan from -1 (left) to 1 (right)
 * @returns {boolean} true if this path is playing them, and the camera element should be muted
 */
export function play_voice(user_id, voice) {
  try {
    return _play_voice(user_id, voice);
  } catch (error) {
    // whatever it was, the old path still works
    _fail("error", error);
    return false;
  }
}

function _play_voice(user_id, { stream, gain, cutoff, pan }) {
  if (_blocker()) {
    stop_voice(user_id);
    return false;
  }
  const track = stream?.getAudioTracks?.()[0] ?? null;
  let voice = _voices.get(user_id);
  if (voice && (voice.stream !== stream || voice.track !== track)) {
    stop_voice(user_id);
    voice = null;
  }
  // someone sending no audio has nothing to route
  if (!track) return false;
  const context = _context;
  cutoff = Math.max(10, Math.min(cutoff, context.sampleRate / 2));
  pan = Math.max(-1, Math.min(1, pan));
  gain = Math.max(0, gain);
  if (!voice) {
    const failed = _voice_failures.get(user_id);
    if (failed && failed.stream === stream && failed.track === track) return false;
    try {
      const source = context.createMediaStreamSource(stream);
      const gain_node = context.createGain();
      const filter = context.createBiquadFilter();
      const panner = context.createStereoPanner();
      gain_node.channelCount = 1;
      gain_node.channelCountMode = "explicit";
      filter.type = "lowpass";
      filter.Q.value = Math.SQRT1_2;
      // a new voice starts at its values; only later changes are eased in
      gain_node.gain.value = gain * MONO_MAKEUP;
      filter.frequency.value = cutoff;
      panner.pan.value = pan;
      source.connect(gain_node);
      gain_node.connect(filter);
      filter.connect(panner);
      panner.connect(_limiter);
      voice = { stream, track, source, gain: gain_node, filter, panner, gain_value: gain, cutoff, pan };
      _voices.set(user_id, voice);
      _voice_failures.delete(user_id);
    } catch (error) {
      console.warn(MODULE_ID + " | advanced voice audio failed for user " + user_id + ", using the old audio path for them", error);
      _voice_failures.set(user_id, { stream, track, detail: String(error?.message ?? error) });
      return false;
    }
  }
  _apply_sink();
  if (!_context) return false;// the output device failed just now
  const now = context.currentTime;
  if (Math.abs(voice.gain_value - gain) > 1e-4) voice.gain.gain.setTargetAtTime((voice.gain_value = gain) * MONO_MAKEUP, now, RAMP.gain);
  if (Math.abs(voice.cutoff - cutoff) > 0.5) voice.filter.frequency.setTargetAtTime(voice.cutoff = cutoff, now, RAMP.cutoff);
  if (Math.abs(voice.pan - pan) > 1e-3) voice.panner.pan.setTargetAtTime(voice.pan = pan, now, RAMP.pan);
  return true;
}

/**
 * Stops playing a user through the advanced path, e.g. because they left or were hidden
 * @param {string} user_id
 */
export function stop_voice(user_id) {
  const voice = _voices.get(user_id);
  if (!voice) return;
  _disconnect(voice);
  _voices.delete(user_id);
}

/**
 * Stops every voice except the ones listed
 * @param {Set<string>} [keep] user IDs still being played
 */
export function stop_other_voices(keep = new Set()) {
  for (const user_id of Array.from(_voices.keys())) if (!keep.has(user_id)) stop_voice(user_id);
}

/**
 * Which path this browser is on and why, for the self-test and Voice Diagnostics. Asking starts the advanced path
 * if it can start, which is how the self-test checks it.
 * @returns {{path: "advanced" | "old", reason: string | null, detail: string | null, context: string | null, sampleRate: number | null, sink: string | null, voices: number}}
 */
export function voice_audio_status() {
  const reason = _blocker();
  return {
    path: reason ? "old" : "advanced",
    reason,
    detail: reason && _failure ? _failure.detail : null,
    context: _context?.state ?? null,
    sampleRate: _context?.sampleRate ?? null,
    sink: _context ? (_sink || "default") : null,
    voices: _voices.size
  };
}

/**
 * How one user is being played
 * @param {string} user_id
 * @returns {{path: "advanced", gain: number, cutoff: number, pan: number} | {path: "old", reason: string | null, detail?: string}}
 *   reason: why not the advanced path: the browser's own reason, or "voice-error" for this user alone; null if
 *   they just aren't being played (no audio, hidden, not connected)
 */
export function voice_status(user_id) {
  const voice = _voices.get(user_id);
  if (voice) return { path: "advanced", gain: voice.gain_value, cutoff: voice.cutoff, pan: voice.pan };
  const reason = _blocker();
  if (reason) return { path: "old", reason };
  const failed = _voice_failures.get(user_id);
  if (failed) return { path: "old", reason: "voice-error", detail: failed.detail };
  return { path: "old", reason: null };
}

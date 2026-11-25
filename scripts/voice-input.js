/**
 * Microphone cleanup: your microphone goes through a noise filter and a voice gate before Foundry sends it, so other
 * players hear your voice and not your breathing, drinks, keyboard, or the birds outside.
 *
 *   Foundry's microphone track -> a copy of it -> high-pass (rumble, desk bumps) -> the cleanup worklet
 *     (voice-input-worklet.js: RNNoise and the gate) -> a new track, which takes the original's place in Foundry's
 *     outgoing stream
 *
 * - Foundry keeps owning the microphone: it asks for it, mutes it, and switches devices. This file only swaps the
 *   track inside Foundry's own outgoing stream, and swaps it back whenever the cleanup can't run.
 * - Browsers keep audio switched off until the page has been clicked. Until then the original microphone is sent
 *   as before; after the first click the cleaned-up track replaces it on every connection that's already up,
 *   without reconnecting.
 * - In Voice Activation the gate decides when you're transmitting, instead of Foundry's detector, which clips the
 *   start and end of what people say (proximity-voice-chat.js does that part). In push-to-talk the gate stays open.
 * - Anything that goes wrong puts the original microphone back, with the reason kept for Voice Diagnostics.
 *
 * Talks to proximity-voice-chat.js only through the functions it exports, the listener it's given, and
 * game.modules.get(MODULE_ID).api, at runtime.
 */
const MODULE_ID = "proximity-voice-chat";

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const INPUT_SCRIPT_VERSION = "2.2.1";

/** The version in the address keeps browsers from running a cached copy of an older worklet or filter */
const WORKLET_URL = new URL("./voice-input-worklet.js?v=" + INPUT_SCRIPT_VERSION, import.meta.url).href;
const RNNOISE_URL = new URL("./vendor/rnnoise/rnnoise.wasm?v=" + INPUT_SCRIPT_VERSION, import.meta.url).href;

/** Rumble below this is never voice, and it fools level meters */
const HIGHPASS_HZ = 90;

/** How long setting up waits for the cleanup before letting Foundry connect with the original microphone */
const ATTACH_WAIT_MS = 1500;
/** How long the worklet has to load the filter and say it's ready */
const READY_TIMEOUT_MS = 10000;
/** After a click, a context that still hasn't started within this long isn't going to */
const RESUME_TIMEOUT_MS = 5000;
/** "Hear yourself" plays back for this long */
const LOOPBACK_MS = 30000;

/** Reasons that mean something is wrong with this browser, as opposed to a setting or not having clicked yet */
export const INPUT_PROBLEMS = ["unsupported", "worklet", "rate", "resume", "error"];

/**
 * The cleanup for the current microphone, or null
 * @type {null | {
 *   client: object, stream: MediaStream, raw: MediaStreamTrack, copy: MediaStreamTrack | null,
 *   context: AudioContext | null, nodes: AudioNode[], node: AudioWorkletNode | null, processed: MediaStreamTrack | null,
 *   ready: boolean, denoiser: boolean, filter_error: string | null, worklet_version: string | null, live: boolean,
 *   decided: boolean, sounding: boolean, waiters: Function[], resume_timer: any, ready_timer: any
 * }}
 */
let _path = null;
/** Why the cleanup gave up in this browser, until a setting changes or it reloads */
let _failure = null;
/** @type {Promise<ArrayBuffer> | null} */
let _wasm = null;
let _listening_for_gestures = false;
/** Told when the cleanup starts or stops being sent, and when the gate opens or closes */
let _listener = null;
/** Mic Setup's meter, while it's open */
let _meter = null;
/** "Hear yourself" playback */
let _loopback = null;
/** The latest counts from the worklet, for Voice Diagnostics */
let _stats = null;
let _stats_waiters = [];

/**
 * @param {(event: {type: "state"} | {type: "gate", open: boolean}) => void} listener
 */
export function set_voice_input_listener(listener) {
  _listener = listener;
}

function _tell(event) {
  try {
    _listener?.(event);
  } catch (error) {
    console.error(MODULE_ID + " | voice input listener failed", error);
  }
  // for Mic Setup, and for macros: the cleanup started, stopped, or failed
  if (event.type === "state") Hooks.callAll("proximityMicCleanupChanged", voice_input_status());
}

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

export function register_voice_input_settings() {
  game.settings.register(MODULE_ID, "micCleanupDefault", {
    name: "proximity-voice-chat.Settings.MicCleanupDefault.Label",
    hint: "proximity-voice-chat.Settings.MicCleanupDefault.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => _settings_changed()
  });
  game.settings.register(MODULE_ID, "micDelay", {
    name: "proximity-voice-chat.Settings.MicDelay.Label",
    hint: "proximity-voice-chat.Settings.MicDelay.Hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 30, max: 150, step: 10 },
    default: 100,
    // every player's browser applies it at once, in the next pause in their speech
    onChange: () => _send_settings()
  });
  game.settings.register(MODULE_ID, "micCleanup", {
    name: "proximity-voice-chat.Settings.MicCleanup.Label",
    hint: "proximity-voice-chat.Settings.MicCleanup.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      default: "proximity-voice-chat.Settings.MicCleanup.Default",
      on: "proximity-voice-chat.Settings.MicCleanup.On",
      off: "proximity-voice-chat.Settings.MicCleanup.Off"
    },
    default: "default",
    onChange: () => _settings_changed()
  });
  // the rest are set in Mic Setup, next to the meter that shows what they do
  const tuning = { scope: "client", config: false, onChange: () => _send_settings() };
  game.settings.register(MODULE_ID, "micNoiseFilter", { ...tuning, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "micGateAuto", { ...tuning, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "micStrictness", { ...tuning, type: Number, default: 3 });
  game.settings.register(MODULE_ID, "micThreshold", { ...tuning, type: Number, default: -45 });
  const setup = _mic_setup_class();
  if (!setup) return;
  game.settings.registerMenu(MODULE_ID, "micSetup", {
    name: "proximity-voice-chat.MicSetup.Menu.Name",
    label: "proximity-voice-chat.MicSetup.Menu.Label",
    hint: "proximity-voice-chat.MicSetup.Menu.Hint",
    icon: "fa-solid fa-sliders",
    type: setup,
    restricted: false
  });
}

/**
 * @returns {boolean} whether this player wants the cleanup: their own choice, or else the GM's default
 */
function _wanted() {
  const choice = game.settings.get(MODULE_ID, "micCleanup");
  if (choice === "on") return true;
  if (choice === "off") return false;
  return !!game.settings.get(MODULE_ID, "micCleanupDefault");
}

/** The voice mode Foundry is set to: "always", "activity" or "ptt" */
function _broadcast_mode() {
  return game.webrtc?.settings?.client?.voice?.mode ?? "always";
}

/** What the worklet is told: see gate_params in voice-input-worklet.js */
function _worklet_settings() {
  const whisper = game.modules.get(MODULE_ID)?.api?.get_voice_mode?.(game.user) === "whisper";
  let gate = game.settings.get(MODULE_ID, "micGateAuto") ? "auto" : "manual";
  // holding the key is the gate
  if (_broadcast_mode() === "ptt") gate = "open";
  return {
    gate,
    strictness: game.settings.get(MODULE_ID, "micStrictness"),
    threshold: game.settings.get(MODULE_ID, "micThreshold"),
    whisper,
    filter: !!game.settings.get(MODULE_ID, "micNoiseFilter"),
    delay: game.settings.get(MODULE_ID, "micDelay")
  };
}

function _send_settings() {
  _path?.node?.port?.postMessage({ type: "settings", settings: _worklet_settings() });
}

/**
 * Turning the cleanup on or off applies straight away, to the microphone Foundry is already sending. Changing it
 * is also how a player retries after a failure.
 */
function _settings_changed() {
  _failure = null;
  const client = game.webrtc?.client;
  if (!_wanted()) {
    _stop_path();
    return;
  }
  if (!_path && client?.localStream) attach_local_stream(client);
}

// a change of voice mode (push-to-talk, Whisper) changes what the gate should do
Hooks.on("rtcSettingsChanged", () => _send_settings());
Hooks.on("proximityVoiceModeChanged", (user) => {
  if (user?.id === game.user?.id) _send_settings();
});
// fetching the filter early means the first connection can usually start with it
Hooks.once("ready", () => {
  if (_wanted() && globalThis.AudioWorkletNode) _load_wasm().catch(() => {});
});

/* -------------------------------------------- */
/*  The path                                    */
/* -------------------------------------------- */

function _load_wasm() {
  _wasm ??= Promise.resolve()
    .then(() => fetch(RNNOISE_URL))
    .then(response => {
      if (!response.ok) throw new Error("the noise filter file couldn't be loaded (" + response.status + ")");
      return response.arrayBuffer();
    })
    .catch(error => {
      _wasm = null;
      throw error;
    });
  return _wasm;
}

/**
 * Called right after Foundry sets up its microphone (initializeLocalStream). Starts the cleanup, and waits a
 * moment for it, so connections made straight after can start with it.
 * @param {object} client Foundry's SimplePeerAVClient
 * @returns {Promise<void>}
 */
export async function attach_local_stream(client) {
  try {
    await _attach(client);
  } catch (error) {
    _fail("error", error);
  }
}

async function _attach(client) {
  if (_path) _stop_path();
  const stream = client?.localStream;
  const raw = stream?.getAudioTracks?.()[0];
  if (!raw || !_wanted() || _failure) return;
  if (!globalThis.AudioContext || !globalThis.AudioWorkletNode || !globalThis.MediaStream) {
    _failure = { code: "unsupported", detail: "this browser has no AudioWorklet" };
    console.warn(MODULE_ID + " | microphone cleanup isn't supported here, sending the microphone as it is");
    _tell({ type: "state" });
    return;
  }
  const path = {
    client, stream, raw, copy: null, context: null, nodes: [], node: null, processed: null,
    ready: false, denoiser: false, filter_error: null, worklet_version: null, live: false,
    decided: false, sounding: false, waiters: [], resume_timer: null, ready_timer: null
  };
  _path = path;
  const building = _build(path);
  // wait a moment so the first connections can already use it, but never hold Foundry up for long
  let timer = null;
  await Promise.race([building, new Promise(resolve => (timer = setTimeout(resolve, ATTACH_WAIT_MS)))]);
  clearTimeout(timer);
}

/**
 * Builds the graph and waits for the worklet. Throws (via _fail) if the browser can't.
 */
async function _build(path) {
  let context;
  try {
    context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  } catch (error) {
    return _fail("unsupported", error, path);
  }
  path.context = context;
  if (!context.audioWorklet || context.sampleRate !== 48000) {
    return _fail(context.audioWorklet ? "rate" : "unsupported", "sample rate " + context.sampleRate, path);
  }
  context.addEventListener?.("statechange", () => _on_context_state(path));
  if (context.state !== "running") _listen_for_gestures();
  let wasm = null;
  try {
    const [, bytes] = await Promise.all([
      context.audioWorklet.addModule(WORKLET_URL),
      _load_wasm().catch(error => {
        path.filter_error = String(error?.message ?? error);
        return null;
      })
    ]);
    wasm = bytes;
  } catch (error) {
    return _fail("worklet", error, path);
  }
  if (_path !== path) return;
  try {
    // a copy, so Foundry muting or unmuting the track it sends never silences what the gate listens to
    const copy = path.raw.clone();
    copy.enabled = true;
    path.copy = copy;
    const source = context.createMediaStreamSource(new MediaStream([copy]));
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = HIGHPASS_HZ;
    highpass.Q.value = Math.SQRT1_2;
    const node = new AudioWorkletNode(context, "pvc-voice-input", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { wasm, settings: _worklet_settings() }
    });
    node.port.onmessage = (event) => _on_message(path, event.data);
    if (_meter) node.port.postMessage({ type: "meter", on: true });
    node.onprocessorerror = (event) => _fail("error", event?.message ?? "the cleanup stopped working", path);
    const destination = context.createMediaStreamDestination();
    source.connect(highpass);
    highpass.connect(node);
    node.connect(destination);
    path.nodes = [source, highpass, node, destination];
    path.node = node;
    path.processed = destination.stream.getAudioTracks()[0];
  } catch (error) {
    return _fail(error?.name === "NotSupportedError" ? "rate" : "error", error, path);
  }
  await new Promise(resolve => {
    path.waiters.push(resolve);
    _arm_ready_timer(path);
  });
  if (_path !== path) return;
  if (context.state === "running") _go_live(path);
  else {
    _listen_for_gestures();
    // the page may already have been clicked while the filter loaded
    if (globalThis.navigator?.userActivation?.hasBeenActive) _on_gesture();
  }
}

/**
 * Gives the worklet a while to say it's ready, counted only while its context runs: in a context that hasn't
 * started yet (no click so far) it may not get to run at all
 */
function _arm_ready_timer(path) {
  if (path.ready || path.ready_timer || path.context?.state !== "running") return;
  path.ready_timer = setTimeout(() => {
    if (_path === path && !path.ready) _fail("worklet", "the cleanup didn't start within " + READY_TIMEOUT_MS / 1000 + " seconds", path);
    for (const resolve of path.waiters.splice(0)) resolve();
  }, READY_TIMEOUT_MS);
}

function _on_message(path, data) {
  if (_path !== path || !data) return;
  if (data.type === "ready") {
    path.ready = true;
    path.denoiser = !!data.denoiser;
    path.worklet_version = data.version ?? null;
    if (data.error && !path.filter_error) path.filter_error = data.error;
    if (!path.denoiser) console.warn(MODULE_ID + " | the noise filter didn't load, the voice gate goes by loudness alone", path.filter_error ?? "");
    clearTimeout(path.ready_timer);
    for (const resolve of path.waiters.splice(0)) resolve();
  } else if (data.type === "decision") {
    path.decided = !!data.open;
    _gate_changed(path);
  } else if (data.type === "gate") {
    path.sounding = !!data.open;
    _gate_changed(path);
  } else if (data.type === "meter") {
    try {
      _meter?.(data);
    } catch (error) {
      console.error(MODULE_ID + " | Mic Setup meter failed", error);
    }
  } else if (data.type === "stats") {
    _stats = data;
    for (const resolve of _stats_waiters.splice(0)) resolve(data);
  } else if (data.type === "error") {
    _fail("error", data.error, path);
  }
}

/**
 * The gate counts as open from the moment it decides to open (a little before the sound comes out) until the
 * fade-out has finished, so turning the transmission on and off around it clips nothing.
 */
function _gate_changed(path) {
  if (!path.live) return;
  _tell({ type: "gate", open: path.decided || path.sounding });
}

function _on_context_state(path) {
  if (_path !== path) return;
  const state = path.context?.state;
  if (state === "running") {
    clearTimeout(path.resume_timer);
    if (path.ready) _go_live(path);
    else _arm_ready_timer(path);
  } else if (path.live && state !== "running") {
    // a context that stops (another app took the device, the laptop slept) sends silence: send the microphone
    _go_raw(path);
    if (state !== "closed") _listen_for_gestures();
  }
}

/**
 * Browsers start an audio context suspended until the page has been clicked or typed in
 */
function _listen_for_gestures() {
  if (_listening_for_gestures) return;
  _listening_for_gestures = true;
  for (const type of ["click", "keydown", "touchend"]) {
    globalThis.document?.addEventListener?.(type, _on_gesture, { capture: true, passive: true });
  }
}

function _on_gesture() {
  const path = _path;
  const context = path?.context;
  // the worklet may only finish loading once its context runs, so a click resumes it whether it's ready or not
  if (!context || context.state === "running" || context.state === "closed") return;
  if (globalThis.navigator?.userActivation && !globalThis.navigator.userActivation.hasBeenActive) return;
  Promise.resolve()
    .then(() => context.resume())
    .then(() => {
      if (_path === path && context.state === "running") _go_live(path);
    })
    .catch(error => _fail("resume", error, path));
  clearTimeout(path.resume_timer);
  path.resume_timer = setTimeout(() => {
    if (_path === path && context.state !== "running") _fail("resume", "the audio context stayed " + context.state + " after a click", path);
  }, RESUME_TIMEOUT_MS);
}

/**
 * Swaps one outgoing track for another: on every connection already set up (no reconnecting), and in Foundry's
 * stream, which new connections are made from
 */
function _swap(path, from, to) {
  const { client, stream } = path;
  for (const peer of client.peers?.values?.() ?? []) {
    try {
      peer.replaceTrack?.(from, to, stream);
    } catch (error) {
      // a connection that never got this track (it's being replaced anyway) has nothing to swap
      if (error?.code !== "ERR_TRACK_NOT_ADDED") console.warn(MODULE_ID + " | couldn't swap the microphone on a connection", error);
    }
  }
  if (stream.getAudioTracks().includes(from)) stream.removeTrack(from);
  if (!stream.getAudioTracks().includes(to)) stream.addTrack(to);
  // Foundry mutes by switching the sent track off; whatever it had set carries over
  to.enabled = from.enabled;
  from.enabled = false;
  // Foundry's levels stream (its own detector, and this module's speaking cue for you) measures what's sent
  const old_levels = client.levelsStream;
  const levels = to.clone();
  levels.enabled = true;
  client.levelsStream = new MediaStream([levels]);
  for (const track of old_levels?.getAudioTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
}

function _go_live(path) {
  if (_path !== path || path.live || !path.ready || !path.processed) return;
  _swap(path, path.raw, path.processed);
  path.live = true;
  path.decided = path.sounding = false;
  _tell({ type: "state" });
}

function _go_raw(path) {
  if (!path.live) return;
  path.live = false;
  try {
    _swap(path, path.processed, path.raw);
  } catch (error) {
    console.error(MODULE_ID + " | couldn't put the microphone back", error);
  }
  _tell({ type: "state" });
}

/**
 * Stops the cleanup and sends the microphone as it is
 */
function _stop_path() {
  const path = _path;
  if (!path) return;
  _go_raw(path);
  _path = null;
  _teardown(path);
  _tell({ type: "state" });
}

function _teardown(path) {
  _stats = null;
  clearTimeout(path.resume_timer);
  clearTimeout(path.ready_timer);
  for (const resolve of path.waiters.splice(0)) resolve();
  stop_hearing();
  try {
    path.node?.port?.postMessage({ type: "stop" });
  } catch {
    // already gone
  }
  for (const node of path.nodes) {
    try {
      node.disconnect();
    } catch {
      // never connected
    }
  }
  for (const track of [path.copy, path.processed]) {
    try {
      track?.stop();
    } catch {
      // already stopped
    }
  }
  try {
    path.context?.close?.()?.catch?.(() => {});
  } catch {
    // already closed
  }
}

/**
 * Called just before Foundry replaces its microphone (a device change, or reconnecting). Foundry stops the tracks
 * in its own stream; this stops the rest. The stream being replaced is left as it is, since Foundry still takes it
 * off its connections.
 */
export function detach_local_stream() {
  const path = _path;
  if (!path) return;
  _path = null;
  _teardown(path);
  // the original track isn't in Foundry's stream any more while the cleanup is sent, so Foundry won't stop it
  if (path.live) {
    try {
      path.raw.stop();
    } catch {
      // already stopped
    }
  }
}

/**
 * Gives up on the cleanup in this browser and sends the microphone as it is
 * @param {string} code a value of INPUT_PROBLEMS
 * @param {unknown} [error]
 * @param {object} [path] the path that failed; a newer one is left alone
 */
function _fail(code, error, path = _path) {
  if (path && path !== _path) return;
  _failure = { code, detail: String(error?.message ?? error ?? "") };
  console.warn(MODULE_ID + " | microphone cleanup failed (" + code + "), sending the microphone as it is", error ?? "");
  _stop_path();
  _tell({ type: "state" });
}

/* -------------------------------------------- */
/*  Status                                      */
/* -------------------------------------------- */

/**
 * @returns {boolean} whether the cleaned-up track is what's being sent
 */
export function input_active() {
  return !!_path?.live;
}

/**
 * @returns {boolean} whether the cleanup is sent and decides when you're transmitting (not push-to-talk)
 */
export function input_gates_voice() {
  return !!_path?.live && _broadcast_mode() !== "ptt";
}

/**
 * @returns {boolean} whether the gate is letting sound through (or about to)
 */
export function input_gate_open() {
  return !!_path?.live && (_path.decided || _path.sounding);
}

/**
 * What the cleanup is doing in this browser, for Mic Setup and Voice Diagnostics
 * @returns {{state: "active" | "off" | "no-mic" | "starting" | "waiting" | "failed", reason: string | null,
 *   detail: string | null, filter: boolean | null, filterError: string | null, gate: string, strictness: number,
 *   threshold: number, whisper: boolean, filterWanted: boolean, delay: number, choice: string, worldDefault: boolean,
 *   worklet: string | null, openShare: number | null}}
 */
export function voice_input_status() {
  const settings = _worklet_settings();
  let state;
  if (_path?.live) state = "active";
  else if (!_wanted()) state = "off";
  else if (_failure) state = "failed";
  else if (!_path) state = game.webrtc?.client?.localStream?.getAudioTracks?.().length ? "starting" : "no-mic";
  else if (!_path.ready) state = "starting";
  else state = "waiting";
  const stats = _path && _stats ? _stats : null;
  return {
    state,
    reason: state === "failed" ? _failure.code : null,
    detail: state === "failed" ? _failure.detail : null,
    filter: _path?.ready ? _path.denoiser : null,
    filterError: _path?.filter_error ?? null,
    gate: settings.gate,
    strictness: settings.strictness,
    threshold: settings.threshold,
    whisper: settings.whisper,
    filterWanted: settings.filter,
    delay: settings.delay,
    choice: game.settings.get(MODULE_ID, "micCleanup"),
    worldDefault: !!game.settings.get(MODULE_ID, "micCleanupDefault"),
    worklet: _path?.worklet_version ?? null,
    openShare: stats && stats.frames ? stats.open_frames / stats.frames : null
  };
}

/**
 * Asks the worklet for its counts (how much of the time the gate was open), for Voice Diagnostics
 * @returns {Promise<object>} voice_input_status() with fresh counts
 */
export async function voice_input_report() {
  const port = _path?.ready ? _path.node?.port : null;
  if (port) {
    await new Promise(resolve => {
      _stats_waiters.push(resolve);
      setTimeout(resolve, 300);
      port.postMessage({ type: "stats" });
    });
  }
  return voice_input_status();
}

/* -------------------------------------------- */
/*  Mic Setup                                   */
/* -------------------------------------------- */

/**
 * Starts sending meter readings to a function, about 20 a second, while Mic Setup is open
 * @param {(reading: {raw: number, out: number, vad: number | null, floor: number, speech: number, needed: number, open: boolean}) => void} callback
 */
export function start_input_meter(callback) {
  _meter = callback;
  _path?.node?.port?.postMessage({ type: "meter", on: true });
}

export function stop_input_meter() {
  _meter = null;
  _path?.node?.port?.postMessage({ type: "meter", on: false });
}

/**
 * Plays your cleaned-up microphone back to you, on Foundry's chosen output device, so you can hear what others
 * hear. Stops by itself after 30 seconds.
 * @returns {boolean} whether it started
 */
export function hear_yourself() {
  stop_hearing();
  const path = _path;
  if (!path?.processed || path.context?.state !== "running") return false;
  const track = path.processed.clone();
  track.enabled = true;
  const element = globalThis.document.createElement("audio");
  element.autoplay = true;
  if (element.style) element.style.display = "none";
  element.srcObject = new MediaStream([track]);
  globalThis.document.body?.append?.(element);
  const sink = game.webrtc?.settings?.client?.audioSink;
  if (sink && sink !== "default") element.setSinkId?.(sink)?.catch?.(() => {});
  element.play?.()?.catch?.(() => {});
  _loopback = { element, track, timer: setTimeout(() => {
    stop_hearing();
    _tell({ type: "state" });
  }, LOOPBACK_MS) };
  return true;
}

export function stop_hearing() {
  if (!_loopback) return;
  const { element, track, timer } = _loopback;
  _loopback = null;
  clearTimeout(timer);
  try {
    element.pause?.();
    element.srcObject = null;
    element.remove?.();
    track.stop();
  } catch {
    // it's being thrown away either way
  }
}

export function is_hearing() {
  return !!_loopback;
}

/** The Mic Setup window class, made once Foundry's application classes exist */
let MicSetup = null;

/**
 * @returns {Promise<object | null>} the opened window
 */
export function open_mic_setup() {
  const Class = _mic_setup_class();
  if (!Class) return Promise.resolve(null);
  const app = new Class();
  return app.render({ force: true }).then(() => app);
}

function _mic_setup_class() {
  if (MicSetup) return MicSetup;
  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (!ApplicationV2) return null;
  const L = key => game.i18n.localize("proximity-voice-chat.MicSetup." + key);
  const F = (key, data) => game.i18n.format("proximity-voice-chat.MicSetup." + key, data);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  /** the meter's scale, in dB */
  const METER_MIN = -80;
  const percent = db => Math.max(0, Math.min(100, (db - METER_MIN) / -METER_MIN * 100)) + "%";

  MicSetup = class MicSetup extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pvc-mic-setup",
      classes: ["pvc-mic-setup"],
      window: { title: "proximity-voice-chat.MicSetup.Title", icon: "fa-solid fa-sliders", resizable: false },
      position: { width: 460, height: "auto" }
    };

    async _renderHTML(_context, _options) {
      const status = voice_input_status();
      const body = el("div", "pvc-mic-setup-body");
      body.append(el("p", "pvc-mic-status pvc-mic-" + status.state, MicSetup.status_text(status)));

      // on, off, or the GM's default
      const choice = el("label", "pvc-mic-row");
      choice.append(el("span", null, L("Cleanup")));
      const select = el("select");
      select.name = "micCleanup";
      for (const value of ["default", "on", "off"]) {
        const option = el("option", null, value === "default"
          ? F("UseDefault", { state: L(status.worldDefault ? "DefaultOn" : "DefaultOff") })
          : L(value === "on" ? "On" : "Off"));
        option.value = value;
        option.selected = status.choice === value;
        select.append(option);
      }
      select.addEventListener("change", async () => {
        await game.settings.set(MODULE_ID, "micCleanup", select.value);
        setTimeout(() => this.render(), 300);
      });
      choice.append(select);
      body.append(choice);

      const checkbox = (key, label, hint) => {
        const row = el("label", "pvc-mic-row pvc-mic-check");
        const input = el("input");
        input.type = "checkbox";
        input.checked = !!game.settings.get(MODULE_ID, key);
        input.addEventListener("change", async () => {
          await game.settings.set(MODULE_ID, key, input.checked);
          this.render();
        });
        row.append(input, el("span", null, L(label)));
        body.append(row);
        if (hint) body.append(el("p", "hint", L(hint)));
      };
      checkbox("micNoiseFilter", "Filter", "FilterHint");
      checkbox("micGateAuto", "Auto", "AutoHint");

      // Automatic: how strict; Manual: a threshold over the meter
      const auto = !!game.settings.get(MODULE_ID, "micGateAuto");
      const slider_row = el("label", "pvc-mic-row");
      const slider = el("input");
      slider.type = "range";
      const readout = el("output");
      if (auto) {
        slider.min = "1";
        slider.max = "5";
        slider.step = "1";
        slider.value = String(game.settings.get(MODULE_ID, "micStrictness"));
        const show = () => (readout.textContent = L("Strictness." + slider.value));
        show();
        slider.addEventListener("input", show);
        slider.addEventListener("change", () => game.settings.set(MODULE_ID, "micStrictness", Number(slider.value)));
        slider_row.append(el("span", null, L("StrictnessLabel")), slider, readout);
      } else {
        slider.min = "-70";
        slider.max = "-10";
        slider.step = "1";
        slider.value = String(game.settings.get(MODULE_ID, "micThreshold"));
        const show = () => (readout.textContent = slider.value + " dB");
        show();
        slider.addEventListener("input", () => {
          show();
          marker.style.left = percent(Number(slider.value));
        });
        slider.addEventListener("change", () => game.settings.set(MODULE_ID, "micThreshold", Number(slider.value)));
        slider_row.append(el("span", null, L("ThresholdLabel")), slider, readout);
      }
      body.append(slider_row);

      // the meter: how loud you are, where the gate opens, and whether it's open
      const meter = el("div", "pvc-mic-meter");
      const bar = el("div", "pvc-mic-meter-level");
      const marker = el("div", "pvc-mic-meter-marker");
      if (!auto) marker.style.left = percent(Number(slider.value));
      meter.append(bar, marker);
      const speech = el("div", "pvc-mic-meter pvc-mic-speech");
      const speech_bar = el("div", "pvc-mic-meter-level");
      speech.append(speech_bar);
      const light = el("div", "pvc-mic-light", L("Sending"));
      const meter_row = el("div", "pvc-mic-meters");
      meter_row.append(el("span", null, L("Level")), meter, el("span", null, L("Speech")), speech, light);
      body.append(meter_row);
      body.append(el("p", "hint", L(status.state === "active" ? (auto ? "MeterHintAuto" : "MeterHintManual") : "MeterHintInactive")));
      this._meter_nodes = { bar, marker, speech_bar, light, auto };

      // hear yourself
      const buttons = el("div", "pvc-mic-buttons");
      const hear = el("button");
      hear.type = "button";
      const hearing = is_hearing();
      hear.append(el("i", hearing ? "fa-solid fa-stop" : "fa-solid fa-headphones"), document.createTextNode(" " + L(hearing ? "StopHearing" : "Hear")));
      hear.disabled = status.state !== "active" && !hearing;
      hear.addEventListener("click", () => {
        if (is_hearing()) stop_hearing();
        else if (!hear_yourself()) ui.notifications.warn(L("CantHear"));
        this.render();
      });
      buttons.append(hear);
      body.append(buttons);
      if (status.gate === "open") body.append(el("p", "hint", L("PushToTalk")));
      if (status.whisper) body.append(el("p", "hint", L("Whisper")));
      return body;
    }

    _replaceHTML(result, content, _options) {
      content.replaceChildren(result);
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      start_input_meter((reading) => this._show_reading(reading));
      // the status line and the meter follow the cleanup starting (after a click) or stopping
      this._state_hook ??= Hooks.on("proximityMicCleanupChanged", () => this.render());
    }

    _onClose(options) {
      super._onClose?.(options);
      stop_input_meter();
      stop_hearing();
      if (this._state_hook !== undefined) Hooks.off?.("proximityMicCleanupChanged", this._state_hook);
      this._state_hook = undefined;
    }

    _show_reading(reading) {
      const nodes = this._meter_nodes;
      if (!nodes) return;
      nodes.bar.style.width = percent(nodes.auto ? reading.raw : reading.out);
      if (nodes.auto) nodes.marker.style.left = percent(reading.needed);
      nodes.speech_bar.style.width = reading.vad === null ? "0%" : Math.round(reading.vad * 100) + "%";
      nodes.light.classList.toggle("active", !!reading.open);
    }

    /** One line saying whether the cleanup is working, and if not why */
    static status_text(status) {
      if (status.state === "failed") return L("Status.failed") + " " + L("Reason." + status.reason) + (status.detail ? " [" + status.detail + "]" : "");
      let text = L("Status." + status.state);
      if (status.state === "active" && status.filter === false) text += " " + L("NoFilter");
      return text;
    }
  };
  return MicSetup;
}

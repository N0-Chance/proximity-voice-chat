/**
 * Microphone cleanup on the browser's audio thread: an AudioWorklet that takes your microphone, filters out noise
 * with RNNoise, and lets sound through only while you're speaking.
 *
 *   microphone (high-passed) -> 10 ms frames -> RNNoise: noise removed, and how likely the frame is speech
 *     -> the gate decides, a little ahead of what it lets out -> fade in / fade out -> the track Foundry sends
 *
 * Why it works this way:
 * - RNNoise is a small speech-trained network (the one Jitsi Meet uses). Besides removing noise it scores every
 *   10 ms of sound from 0 to 1 for "is this a voice?". Breathing, birds, clicks and typing score near 0, so the gate
 *   can tell them apart from speech even when they're as loud as it.
 * - RNNoise's output runs two frames (20 ms) behind its input, while its score is already up to date, and the gate
 *   holds back two more frames. So the gate has decided to open about 30 ms before the first syllable comes out,
 *   instead of clipping it the way Foundry's Voice Activation does.
 * - The gate adapts to the room on its own: it follows the background level while nobody speaks, and your own
 *   speaking level while you do, so a voice from the next room (or a TV) is too quiet to open it.
 * - It stays open through short pauses (hold), and fades out instead of cutting off, so word endings survive.
 * - Whispers have none of a voice's buzz, so RNNoise scores them low and filters them away. While you're in
 *   Whisper mode the gate asks for much less, and some of the unfiltered sound is mixed back in.
 *
 * This file is loaded twice: by the browser as an AudioWorklet module (where registerProcessor exists), and by
 * the Node tests, which import its classes. It imports nothing, so it works as a worklet in every browser.
 */

/** Kept in step with module.json by tools/release.sh, and reported to Voice Diagnostics by the worklet */
export const WORKLET_SCRIPT_VERSION = "2.2.0";

/** RNNoise works at 48 kHz on 10 ms frames */
export const SAMPLE_RATE = 48000;
export const FRAME = 480;

/** RNNoise's output lags its input by this many frames; unfiltered sound is delayed to match */
export const DENOISE_DELAY_FRAMES = 2;

/** How many frames the gate decides ahead of what it lets out */
export const LOOKAHEAD_FRAMES = 2;

/** Fade-in and fade-out, in samples */
const ATTACK_SAMPLES = 5 * SAMPLE_RATE / 1000;
const RELEASE_SAMPLES = 120 * SAMPLE_RATE / 1000;

/** Enough buffered output that the browser's 128-sample blocks never run dry between 480-sample frames */
const OUTPUT_PREFILL = FRAME;

/** How often, in frames, the meter in Mic Setup gets a reading */
const METER_EVERY = 5;

/**
 * Strictness 1 (relaxed) to 5 (strict), for the automatic gate:
 * - open: how sure RNNoise must be that it's speech before the gate opens
 * - margin: how far above the room's background level, in dB
 * - range: how far below your speaking level (the loud parts of your speech) a voice may be and still count, in dB
 */
export const STRICTNESS = {
  open: [0.3, 0.45, 0.6, 0.75, 0.9],
  margin: [3, 5, 7, 10, 13],
  range: [32, 26, 20, 16, 12]
};

/**
 * Turns the player's settings into the gate's numbers
 * @param {object} settings
 * @param {"auto" | "manual" | "open"} [settings.gate] automatic, a fixed threshold, or always open (push-to-talk)
 * @param {number} [settings.strictness] 1 to 5, for the automatic gate
 * @param {number} [settings.threshold] dB, for the manual gate
 * @param {boolean} [settings.whisper] the player is in Whisper mode
 * @param {boolean} [settings.filter] remove noise from what's sent (RNNoise still scores speech when this is off)
 * @param {boolean} [denoiser] whether RNNoise loaded; without it the gate goes by level alone
 */
export function gate_params(settings = {}, denoiser = true) {
  const gate = ["auto", "manual", "open"].includes(settings.gate) ? settings.gate : "auto";
  const index = Math.min(5, Math.max(1, Math.round(Number(settings.strictness) || 3))) - 1;
  const threshold = Number.isFinite(Number(settings.threshold)) ? Number(settings.threshold) : -45;
  const params = {
    gate,
    denoiser,
    p_open: STRICTNESS.open[index],
    p_close: STRICTNESS.open[index] * 0.4,
    margin: STRICTNESS.margin[index],
    range: STRICTNESS.range[index],
    // frames the gate stays open after the last sign of speech, so pauses between words don't chop
    hold: 30,
    // of the last 3 frames, how many must look like speech to open: rejects clicks and gulps of 10 ms
    confirm: 2,
    threshold,
    // share of the unfiltered sound in what's sent
    dry: settings.filter === false || !denoiser ? 1 : 0
  };
  if (!denoiser) {
    // level alone can't tell a voice from a noise, so ask for more of both
    params.margin += 6;
    params.confirm = 3;
  }
  if (settings.whisper) {
    params.p_open *= 0.3;
    params.p_close *= 0.3;
    params.margin = Math.max(2, params.margin - 3);
    params.range += 10;
    params.hold = 60;
    params.threshold -= 10;
    if (params.dry < 1) params.dry = 0.5;
  }
  return params;
}

/**
 * The gate's decisions, one 10 ms frame at a time. Kept apart from the audio so it can be tested on its own.
 */
export class VoiceGate {
  constructor(params) {
    this.params = params;
    /** the room's background level, dB */
    this.floor = -70;
    /** your speaking level: the loud parts of your speech, dB */
    this.speech = -30;
    this.recent = [];
    this.hold = 0;
    this.open = params.gate === "open";
  }

  /** The level a frame must reach to open the automatic gate, dB */
  get needed() {
    return Math.max(this.floor + this.params.margin, this.speech - this.params.range);
  }

  /**
   * @param {number} raw_db the newest frame's level as it came in, dB
   * @param {number} out_db the level of what's about to be sent (after filtering), dB
   * @param {number | null} vad RNNoise's speech score for the newest frame, or null without RNNoise
   * @returns {boolean} whether the gate is open
   */
  step(raw_db, out_db, vad) {
    const p = this.params;
    if (p.gate === "open") {
      this.open = true;
      this.hold = 0;
      this._learn(raw_db, out_db, vad);
      return true;
    }
    let starts;
    let continues;
    if (p.gate === "manual") {
      starts = out_db >= p.threshold;
      continues = out_db >= p.threshold - 3;
    } else if (vad === null) {
      starts = out_db >= this.needed;
      continues = out_db >= this.floor + p.margin / 2;
    } else {
      // the newest frame's own level: the filtered level lags two frames behind the score
      starts = vad >= p.p_open && raw_db >= this.needed;
      continues = vad >= p.p_close && raw_db >= Math.max(this.floor + p.margin / 2, this.speech - p.range - 6);
    }
    this.recent.push(starts);
    if (this.recent.length > 3) this.recent.shift();
    const confirmed = this.recent.filter(Boolean).length >= p.confirm;
    if (confirmed || (this.open && continues)) this.hold = p.hold;
    else if (this.hold > 0) this.hold--;
    this.open = this.hold > 0;
    this._learn(raw_db, out_db, vad);
    return this.open;
  }

  _learn(raw_db, out_db, vad) {
    // the background is measured only while nobody's speaking: it falls quickly and rises about 1 dB a second
    if (!this.open && (vad === null || vad < 0.2)) {
      if (raw_db < this.floor) this.floor += (raw_db - this.floor) * 0.1;
      else this.floor += Math.min(raw_db - this.floor, 0.01);
      this.floor = Math.min(-20, Math.max(-90, this.floor));
    }
    // your speaking level follows the loud parts of clear speech: it rises within a fraction of a second and
    // sinks over half a minute, so quieter words and a voice from across the room don't drag it down
    if (this.open && this.params.gate !== "open" && (vad === null || vad >= 0.9) && out_db > this.floor + 10) {
      this.speech += (out_db - this.speech) * (out_db > this.speech ? 0.05 : 0.0003);
      this.speech = Math.min(-6, Math.max(-60, this.speech));
    }
  }
}

/** RMS level of some samples, in dB (full scale is 0) */
export function level_db(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / samples.length + 1e-10);
}

/**
 * Loads RNNoise from its WebAssembly file. It needs only three functions from outside, so there's no Emscripten
 * glue code: just the file, the two functions it exports, and a buffer in its memory for each frame.
 * @param {ArrayBuffer | Uint8Array} bytes rnnoise.wasm
 * @returns {Promise<{create: () => {process: (frame: Float32Array) => number, destroy: () => void}}>}
 */
export async function load_rnnoise(bytes) {
  let memory = null;
  const env = {
    emscripten_memcpy_big: (dest, src, count) => {
      new Uint8Array(memory.buffer).copyWithin(dest, src, src + count);
    },
    emscripten_resize_heap: (size) => {
      try {
        memory.grow(Math.ceil((size - memory.buffer.byteLength) / 65536));
        return 1;
      } catch {
        return 0;
      }
    },
    __assert_fail: () => {
      throw new Error("RNNoise assertion failed");
    }
  };
  const { instance } = await WebAssembly.instantiate(bytes, { env, wasi_snapshot_preview1: { fd_write: () => 0 } });
  const rn = instance.exports;
  memory = rn.memory;
  rn.emscripten_stack_init?.();
  rn.__wasm_call_ctors?.();
  if (rn.rnnoise_get_frame_size() !== FRAME) throw new Error("RNNoise frame size is " + rn.rnnoise_get_frame_size());
  return {
    create() {
      const state = rn.rnnoise_create(0);
      const input = rn.malloc(FRAME * 4);
      const output = rn.malloc(FRAME * 4);
      if (!state || !input || !output) throw new Error("RNNoise could not allocate memory");
      let heap = new Float32Array(memory.buffer);
      return {
        /** Filters a frame in place (samples from -1 to 1) and returns how likely it is to be speech */
        process(frame) {
          if (heap.buffer !== memory.buffer) heap = new Float32Array(memory.buffer);
          // RNNoise expects 16-bit sample values
          for (let i = 0; i < FRAME; i++) heap[(input >> 2) + i] = frame[i] * 32768;
          const vad = rn.rnnoise_process_frame(state, output, input);
          if (heap.buffer !== memory.buffer) heap = new Float32Array(memory.buffer);
          for (let i = 0; i < FRAME; i++) frame[i] = heap[(output >> 2) + i] / 32768;
          return vad;
        },
        destroy() {
          rn.rnnoise_destroy(state);
          rn.free(input);
          rn.free(output);
        }
      };
    }
  };
}

/**
 * Everything between the microphone's samples and the samples sent: framing, filtering, gating, fades, and the
 * delays that line them up. Works on blocks of any size; browsers use 128 samples.
 */
export class InputEngine {
  /**
   * @param {{process: (frame: Float32Array) => number} | null} denoiser RNNoise, or null to go by level alone
   * @param {object} settings as for gate_params
   */
  constructor(denoiser, settings = {}) {
    this.denoiser = denoiser;
    this.settings = settings;
    this.gate = new VoiceGate(gate_params(settings, !!denoiser));
    this.frame = new Float32Array(FRAME);
    this.filled = 0;
    // unfiltered frames waiting to line up with RNNoise's output
    this.dry_queue = Array.from({ length: denoiser ? DENOISE_DELAY_FRAMES : 0 }, () => new Float32Array(FRAME));
    // frames already decided on, waiting to go out
    this.lookahead = Array.from({ length: LOOKAHEAD_FRAMES }, () => new Float32Array(FRAME));
    this.fifo = new Float32Array(FRAME * 8);
    this.read = 0;
    this.write = OUTPUT_PREFILL;
    this.gain = this.gate.open ? 1 : 0;
    this.frames = 0;
    this.open_frames = 0;
    this.metering = false;
    /** messages for the main thread: gate changes and meter readings */
    this.events = [];
    this.last = { raw: -100, out: -100, vad: null };
  }

  /** Applies new settings (strictness, manual threshold, whisper, push-to-talk...) without losing what it learned */
  configure(settings) {
    this.settings = settings;
    this.gate.params = gate_params(settings, !!this.denoiser);
    if (this.gate.params.gate === "open") this.gate.open = true;
  }

  /**
   * @param {Float32Array | null} input the block that came in (null when the microphone sent nothing)
   * @param {Float32Array} output the block to send, same length
   */
  process(input, output) {
    const n = output.length;
    for (let i = 0; i < n; i++) {
      this.frame[this.filled++] = input ? input[i] : 0;
      if (this.filled === FRAME) {
        this.filled = 0;
        this._frame();
      }
    }
    const size = this.fifo.length;
    for (let i = 0; i < n; i++) {
      if (this.read === this.write) {
        output[i] = 0;
        continue;
      }
      output[i] = this.fifo[this.read];
      this.read = (this.read + 1) % size;
    }
  }

  _frame() {
    const raw = this.frame;
    const raw_db = level_db(raw);
    let vad = null;
    let wet = null;
    let dry;
    if (this.denoiser) {
      wet = raw.slice();
      vad = this.denoiser.process(wet);
      this.dry_queue.push(raw.slice());
      dry = this.dry_queue.shift();
    } else {
      dry = raw.slice();
    }
    const dry_share = this.gate.params.dry;
    let mixed;
    if (!wet || dry_share >= 1) mixed = dry;
    else if (dry_share <= 0) mixed = wet;
    else {
      mixed = new Float32Array(FRAME);
      for (let i = 0; i < FRAME; i++) mixed[i] = wet[i] * (1 - dry_share) + dry[i] * dry_share;
    }
    const out_db = level_db(mixed);
    const was_open = this.gate.open;
    const open = this.gate.step(raw_db, out_db, vad);
    this.frames++;
    if (open) this.open_frames++;
    this.last = { raw: raw_db, out: out_db, vad };
    if (open !== was_open && this.gate.params.gate !== "open") this.events.push({ type: "decision", open });
    this.lookahead.push(mixed);
    this._emit(this.lookahead.shift(), open);
    if (this.metering && this.frames % METER_EVERY === 0) {
      this.events.push({
        type: "meter", raw: raw_db, out: out_db, vad, floor: this.gate.floor, speech: this.gate.speech,
        needed: this.gate.params.gate === "manual" ? this.gate.params.threshold : this.gate.needed, open
      });
    }
  }

  /** Writes a frame out through the fade, and reports when what's sent starts and stops */
  _emit(frame, open) {
    const size = this.fifo.length;
    for (let i = 0; i < FRAME; i++) {
      const before = this.gain;
      if (open) this.gain = Math.min(1, this.gain + 1 / ATTACK_SAMPLES);
      else this.gain = Math.max(0, this.gain - 1 / RELEASE_SAMPLES);
      if (before === 0 && this.gain > 0) this.events.push({ type: "gate", open: true });
      if (before > 0 && this.gain === 0) this.events.push({ type: "gate", open: false });
      this.fifo[this.write] = frame[i] * this.gain;
      this.write = (this.write + 1) % size;
      // never expected: drop the oldest sample rather than overrun
      if (this.write === this.read) this.read = (this.read + 1) % size;
    }
  }
}

if (typeof registerProcessor === "function") {
  class VoiceInputProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const config = options?.processorOptions ?? {};
      this.settings = config.settings ?? {};
      this.engine = new InputEngine(null, this.settings);
      this.loaded = false;
      this.stopped = false;
      this.failed = false;
      this.port.onmessage = (event) => this.message(event.data);
      const loading = config.wasm ? load_rnnoise(config.wasm) : Promise.reject(new Error("no RNNoise file"));
      loading.then(rnnoise => {
        this.engine = new InputEngine(rnnoise.create(), this.settings);
        this.engine.metering = this.metering ?? false;
        this.ready(true, null);
      }).catch(error => {
        this.ready(false, String(error?.message ?? error));
      });
    }

    ready(denoiser, error) {
      this.loaded = true;
      this.port.postMessage({ type: "ready", version: WORKLET_SCRIPT_VERSION, denoiser, error, sampleRate });
    }

    message(data) {
      if (!data || typeof data !== "object") return;
      if (data.type === "settings") {
        this.settings = data.settings ?? {};
        this.engine.configure(this.settings);
      } else if (data.type === "meter") {
        this.metering = !!data.on;
        this.engine.metering = this.metering;
      } else if (data.type === "stats") {
        const e = this.engine;
        this.port.postMessage({
          type: "stats", frames: e.frames, open_frames: e.open_frames, floor: e.gate.floor, speech: e.gate.speech,
          open: e.gate.open, denoiser: !!e.denoiser, failed: this.failed
        });
      } else if (data.type === "stop") {
        this.stopped = true;
      }
    }

    process(inputs, outputs) {
      if (this.stopped) return false;
      const output = outputs[0]?.[0];
      if (!output) return true;
      const input = inputs[0]?.[0] ?? null;
      if (this.failed || !this.loaded) {
        // until RNNoise has loaded (or after a failure), sound passes as it is; the main thread doesn't send it
        if (input) output.set(input);
        return true;
      }
      try {
        this.engine.process(input, output);
        if (this.engine.events.length) {
          for (const event of this.engine.events) this.port.postMessage(event);
          this.engine.events.length = 0;
        }
      } catch (error) {
        this.failed = true;
        this.port.postMessage({ type: "error", error: String(error?.message ?? error) });
        if (input) output.set(input);
      }
      return true;
    }
  }
  registerProcessor("pvc-voice-input", VoiceInputProcessor);
}

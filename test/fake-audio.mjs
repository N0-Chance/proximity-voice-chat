// A stand-in for the browser's Web Audio API, for the Node suites: nodes that remember what they were connected to
// and parameters that remember how they were set. It behaves like a browser where it matters to the module:
// a context starts suspended until resume() is called after a click, createMediaStreamSource() needs a stream,
// and setTargetAtTime() eases a parameter towards a value instead of jumping.

export class FakeParam {
  constructor(value) { this.value = value; this.ramps = []; }
  setTargetAtTime(value, time, constant) { this.ramps.push({ value, time, constant }); this.value = value; }
}

export class FakeNode {
  constructor(context, kind, params = {}) {
    this.context = context; this.kind = kind; this.outputs = []; this.disconnected = false;
    for (const [name, value] of Object.entries(params)) this[name] = new FakeParam(value);
  }
  connect(node) { this.outputs.push(node); this.disconnected = false; return node; }
  disconnect() { this.outputs = []; this.disconnected = true; }
}

export class FakeAudioContext {
  /** every context made, newest last */
  static instances = [];
  /** how a new context starts: "suspended" until a click, as in Chrome and Firefox, or "running" */
  static startState = "suspended";
  /** "ok", "reject" (resume() fails) or "hang" (resume() never settles and the context stays suspended) */
  static resumeMode = "ok";
  /** a function that says which streams createMediaStreamSource() should refuse */
  static refuseStream = null;
  static reset() { this.instances = []; this.startState = "suspended"; this.resumeMode = "ok"; this.refuseStream = null; }

  constructor(options) {
    this.options = options; this.state = FakeAudioContext.startState; this.sampleRate = 48000; this.currentTime = 0;
    this.listeners = {}; this.sources = [];
    FakeAudioContext.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  _state(state) { this.state = state; (this.listeners.statechange ?? []).forEach(fn => fn()); }
  resume() {
    if (this.state === "closed") return Promise.reject(new Error("the context is closed"));
    if (FakeAudioContext.resumeMode === "reject") return Promise.reject(new Error("resume refused"));
    if (FakeAudioContext.resumeMode === "hang") return new Promise(() => {});
    this._state("running");
    return Promise.resolve();
  }
  close() { this._state("closed"); return Promise.resolve(); }
  createMediaStreamSource(stream) {
    if (!stream?.getAudioTracks?.().length) throw new Error("MediaStream has no audio track");
    if (FakeAudioContext.refuseStream?.(stream)) throw new Error("this stream can't be used");
    const node = new FakeNode(this, "source"); node.stream = stream; this.sources.push(node); return node;
  }
  createGain() { return new FakeNode(this, "gain", { gain: 1 }); }
  createBiquadFilter() { const node = new FakeNode(this, "filter", { frequency: 350, Q: 1 }); node.type = "lowpass"; return node; }
  createStereoPanner() { return new FakeNode(this, "panner", { pan: 0 }); }
  createDynamicsCompressor() { return new FakeNode(this, "limiter", { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); }
  createMediaStreamDestination() { const node = new FakeNode(this, "destination"); node.stream = { id: "voice-output" }; return node; }
}

/** An <audio> element as far as the module uses one */
export class FakeAudioElement {
  static instances = [];
  /** device IDs setSinkId() refuses, as a browser does for a device that's gone */
  static badSinks = new Set(["default"]);// Firefox refuses "default"; the empty string is the default device
  static playMode = "ok";
  static reset() { this.instances = []; this.badSinks = new Set(["default"]); this.playMode = "ok"; }

  constructor() { this.tagName = "AUDIO"; this.style = {}; this.sinkId = ""; this.sinkCalls = []; this.plays = 0; this.paused = true; this.attached = false; FakeAudioElement.instances.push(this); }
  setSinkId(id) {
    this.sinkCalls.push(id);
    if (FakeAudioElement.badSinks.has(id)) return Promise.reject(new Error("NotFoundError: " + id));
    this.sinkId = id; return Promise.resolve();
  }
  play() { this.plays++; if (FakeAudioElement.playMode === "reject") return Promise.reject(new Error("NotAllowedError")); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  remove() { this.attached = false; }
}

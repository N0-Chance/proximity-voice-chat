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
  static reset() { this.instances = []; this.startState = "suspended"; this.resumeMode = "ok"; this.refuseStream = null; this.deviceRate = 48000; this.workletMode = "ok"; }

  /** the sample rate a context gets when it asks for none, as a browser picks the output device's */
  static deviceRate = 48000;
  /** "ok" or "reject": whether audioWorklet.addModule() loads the module */
  static workletMode = "ok";

  constructor(options) {
    this.options = options; this.state = FakeAudioContext.startState; this.sampleRate = options?.sampleRate ?? FakeAudioContext.deviceRate; this.currentTime = 0;
    this.listeners = {}; this.sources = [];
    // like a browser: a worklet's processors can be made only after its module has loaded
    this.audioWorklet = { modules: [], addModule: url => {
      if (FakeAudioContext.workletMode === "reject") return Promise.reject(new Error("AbortError: Unable to load a worklet's module."));
      return Promise.resolve().then(() => { this.audioWorklet.modules.push(url); });
    } };
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
  createMediaStreamDestination() { const node = new FakeNode(this, "destination"); node.stream = new FakeMediaStream([new FakeTrack("audio", "destination")]); node.stream.id = "voice-output"; return node; }
}

/** A media track: enabled is what's sent (Foundry mutes by switching it off), clones are independent, stop() ends it */
export class FakeTrack {
  static count = 0;
  constructor(kind = "audio", label = "track") { this.kind = kind; this.label = label; this.id = "track" + (++FakeTrack.count); this.enabled = true; this.readyState = "live"; this.muted = false; }
  clone() { const copy = new FakeTrack(this.kind, this.label + " (copy)"); copy.enabled = this.enabled; copy.readyState = this.readyState; copy.original = this.original ?? this; return copy; }
  stop() { this.readyState = "ended"; }
}

export class FakeMediaStream {
  static count = 0;
  constructor(tracks = []) { this.id = "stream" + (++FakeMediaStream.count); this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === "video"); }
  addTrack(track) { if (!this.tracks.includes(track)) this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(t => t !== track); }
  clone() { return new FakeMediaStream(this.tracks.map(t => t.clone())); }
}

/**
 * An AudioWorkletNode whose processor the test plays: messages the page posts are kept in port.sent, and
 * emit() delivers a message from the processor, as the browser would, a moment later
 */
export class FakeWorkletNode extends FakeNode {
  static instances = [];
  constructor(context, name, options) {
    super(context, "worklet");
    // like a browser: the processor must have been registered by a loaded module
    if (!context.audioWorklet.modules.length) throw new Error("InvalidStateError: AudioWorkletNode cannot be created: the node name '" + name + "' is not defined");
    this.name = name; this.options = options;
    this.port = { sent: [], onmessage: null, postMessage: message => this.port.sent.push(message) };
    FakeWorkletNode.instances.push(this);
  }
  emit(data) { return Promise.resolve().then(() => this.port.onmessage?.({ data })); }
  /** the settings the page last told the processor */
  get settings() { return this.port.sent.filter(m => m.type === "settings").at(-1)?.settings ?? this.options.processorOptions.settings; }
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

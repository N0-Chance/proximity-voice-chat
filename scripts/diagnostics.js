/**
 * Voice diagnostics without the browser console: a window anyone can open (Configure Settings, or right-click
 * yourself in the players list), and for GMs, the ability to run it on a player's browser remotely.
 *
 * Reports reach GMs as chat cards. A player's browser sends its report to a GM's browser over the module socket,
 * and the GM's browser posts the card, whispered to GMs. If the player's browser posted it, the player could read
 * the full report (hidden token names included) in their own chat log, since authors always see their whispers.
 *
 * Requests that act on a player's browser (run diagnostics, show someone again) must come from a GM, and module socket
 * messages can't prove that: Foundry doesn't tell listeners who sent one, so a "from" field is just a claim. Those
 * requests are written as a flag on the player's own user record instead. The server only lets a GM (or the player
 * themselves) write it, and the updateUser hook's userId is the server's record of who did. Reports still return over
 * the socket, since user records are readable by everyone and reports can carry hidden token names.
 *
 * Talks to proximity-voice-chat.js only through game.modules.get(MODULE_ID).api, at runtime.
 */
const MODULE_ID = "proximity-voice-chat";

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const DIAG_SCRIPT_VERSION = "1.6.6";

const SOCKET = "module." + MODULE_ID;
const REQUEST_TIMEOUT_MS = 10000;
const L = key => game.i18n.localize("proximity-voice-chat.Diagnostics." + key);
const F = (key, data) => game.i18n.format("proximity-voice-chat.Diagnostics." + key, data);
const api = () => game.modules.get(MODULE_ID).api;

/** The window class, defined in init once Foundry's application classes exist */
let VoiceDiagnostics = null;

/** Requests this GM has sent and not yet had an answer to, by user ID */
const _pending = new Map();

/** GM request IDs this browser has acted on, so a request is only handled once */
const _handled_requests = new Set();

/**
 * Writes a request onto a player's user record, where only a GM can put it (see the file comment). Every field is
 * written each time: setFlag merges objects, so a field left out would keep its value from the previous request.
 * @param {foundry.documents.User} user the player whose browser should act
 * @param {"diagnose" | "unhide"} action
 * @param {string | null} [target] for "unhide", the user to show again
 * @returns {Promise}
 */
function write_gm_request(user, action, target = null) {
  const id = foundry.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
  return user.setFlag(MODULE_ID, "gmRequest", { id, action, user: target });
}

/* -------------------------------------------- */
/*  Verdicts                                    */
/* -------------------------------------------- */

/**
 * Plain-language problems with this browser's own setup
 * @param {object} self the report's self section
 * @returns {Array<{level: string, text: string}>} level: "bad", "warn" or "info"
 */
export function self_issues(self) {
  const issues = [];
  if (!self.voiceActive) issues.push({ level: "bad", text: L("VoiceOff") });
  if (self.addressProblem === "webrtc-disabled" || self.addressProblem === "no-addresses") {
    issues.push({ level: "bad", text: game.i18n.localize("proximity-voice-chat.SelfTest." + self.addressProblem) });
  } else if (self.addressProblem === "relay-unreachable") {
    issues.push({ level: "warn", text: game.i18n.localize("proximity-voice-chat.SelfTest.relay-unreachable") + reason_suffix(self.relayError) });
  }
  // the end-to-end relay test: only failures and inconclusive results need a line here; success is in the facts
  const test = self.relayTest;
  if (test && ["no-allocation", "no-route"].includes(test.status)) {
    issues.push({ level: "warn", text: L("Relay." + test.status) + reason_suffix(test.error) });
  } else if (test && ["no-answer", "error"].includes(test.status)) {
    issues.push({ level: "info", text: L("Relay." + test.status) });
  }
  if (self.deafened) issues.push({ level: "warn", text: L("Deafened") });
  const mic = self.mic;
  if (mic && self.voiceActive && !mic.capturing) {
    // Foundry calls all of these "muted"; say which it actually is
    if (mic.device === "disabled") issues.push({ level: "bad", text: L("Mic.Off") });
    else if (mic.permission === "denied") issues.push({ level: "bad", text: L("Mic.Denied") });
    else if (mic.deviceFound === false) issues.push({ level: "bad", text: L("Mic.Missing") });
    else issues.push({ level: "bad", text: L("Mic.NotCapturing") });
  } else if (self.micMuted) {
    issues.push({ level: "info", text: L("MicMuted") });
  } else if (mic?.activation === "ptt" && !mic.transmitting) {
    issues.push({ level: "info", text: L("Mic.PushToTalk") });
  }
  if (self.connectionFix === false) issues.push({ level: "warn", text: L("FixOff") });
  // reports from before 2.0 have no audio section
  const audio = self.audio;
  if (audio?.problem) issues.push({ level: "warn", text: game.i18n.localize("proximity-voice-chat.Audio.Fallback") + " " + audio_reason_text(audio) });
  else if (audio?.reason === "waiting") issues.push({ level: "info", text: L("Audio.Waiting") });
  if (self.propagationError) issues.push({ level: "warn", text: L("PropagationError") + " [" + self.propagationError + "]" });
  return issues;
}

const SEVERITY = { ok: 0, info: 1, warn: 2, bad: 3 };

/**
 * " (the relay server is full, error 486)" and the like
 * @param {{code: number, reason: string} | null | undefined} error
 * @returns {string}
 */
function reason_suffix(error) {
  if (!error) return "";
  return " " + game.i18n.format("proximity-voice-chat.RelayTest.Because", {
    reason: game.i18n.localize("proximity-voice-chat.RelayTest.Reason." + error.reason), code: error.code
  });
}

/**
 * Why a browser or a voice is on the old audio path, in words, with the browser's own error if there was one
 * @param {{reason: string | null, detail?: string | null}} audio
 * @returns {string}
 */
function audio_reason_text(audio) {
  if (!audio?.reason) return "";
  return game.i18n.localize("proximity-voice-chat.Audio.Reason." + audio.reason) + (audio.detail ? " [" + audio.detail + "]" : "");
}

/**
 * This browser's audio path as a short phrase, e.g. "advanced (boost 150%)" or "old path: turned off on this device"
 * @param {object | undefined} audio the report's self.audio
 * @returns {string}
 */
function audio_path_text(audio) {
  if (!audio) return L("Audio.Unknown");
  if (audio.path === "advanced") return F("Audio.Advanced", { boost: Math.round((audio.boost ?? 1) * 100) });
  return L("Audio.Old") + (audio.reason ? ": " + audio_reason_text(audio) : "");
}

/**
 * How one user sounds: how the sound gets here, and what the audio path is doing to it, e.g.
 * "around a corner (route 14 tiles, 1 bend); advanced audio: 120% volume, filter 2.4 kHz, 30% right"
 * @param {object} peer an entry of the report's peers
 * @returns {string} empty for reports from before 2.0, and for users who aren't being played
 */
export function peer_sound(peer) {
  const parts = [];
  if (peer.heard) parts.push(peer.heard);
  const audio = peer.audio;
  if (audio?.path === "advanced") {
    const filter = audio.cutoff >= 20000 ? L("Audio.NoFilter") : F("Audio.Filter", { khz: (audio.cutoff / 1000).toFixed(1) });
    const side = Math.abs(audio.pan) < 0.01 ? L("Audio.Centre") : F(audio.pan < 0 ? "Audio.Left" : "Audio.Right", { percent: Math.round(Math.abs(audio.pan) * 100) });
    parts.push(F("Audio.PeerAdvanced", { gain: Math.round(audio.gain * 100), filter, side }));
  } else if (audio?.reason && peer.volume > 0) {
    parts.push(L("Audio.PeerOld") + ": " + audio_reason_text(audio));
  }
  return parts.join("; ");
}

/**
 * The relay test result as a short phrase, e.g. "works (42 ms round trip)"
 * @param {object | null | undefined} test
 * @returns {string}
 */
function relay_test_text(test) {
  if (!test) return L("Relay.untested");
  if (test.status === "ok") return F("Relay.ok", { rtt: test.rttMs });
  return L("Relay." + test.status) + reason_suffix(test.error);
}

/**
 * One other user's status, in plain language: whether you hear them, and whether your audio reaches them
 * @param {object} peer an entry of the report's peers
 * @param {object} [self] the report's self section, for whether your own microphone is capturing
 * @returns {{level: string, text: string}} level: "ok", "info", "warn" or "bad"
 */
export function peer_status(peer, self) {
  const incoming = _incoming_status(peer);
  // your microphone works, the connection is up, but no audio of yours is going out on it
  if (peer.connected && self?.mic?.capturing && peer.sendingAudio === false) {
    const outgoing = { level: "warn", text: L("Peer.NotReachingThem") };
    const worst = SEVERITY[outgoing.level] > SEVERITY[incoming.level] ? outgoing : incoming;
    return { level: worst.level, text: incoming.text + " " + outgoing.text };
  }
  return incoming;
}

function _incoming_status(peer) {
  if (peer.problem === "own-browser") return { level: "bad", text: L("Peer.OwnBrowser") };
  if (peer.problem === "no-connection") return { level: "bad", text: L("Peer.NoConnection") };
  if (peer.problem === "not-established") return { level: "bad", text: F("Peer.NotEstablished", { state: peer.connectionState ?? "?" }) + reason_suffix(peer.relayError) };
  if (peer.problem === "hidden") return { level: "warn", text: L("Peer.Hidden") };
  if (peer.problem === "no-audio-element") return { level: "warn", text: L("Peer.NoAudioElement") };
  if (peer.problem === "paused") return { level: "warn", text: L("Peer.Paused") };
  if (peer.muted) return { level: "info", text: L("Peer.Muted") };
  // older reports (1.6.3) called incoming audio "sendingAudio"
  const receiving = peer.receivingAudio ?? peer.sendingAudio;
  if (peer.connected && receiving === false) return { level: "info", text: L("Peer.NotSending") };
  if (peer.volume > 0) return { level: "ok", text: L("Peer.Hear") + (peer.route?.startsWith("relayed") ? " " + L("Peer.Relayed") : "") };
  return { level: "info", text: F("Peer.CantHear", { reason: peer.reason }) };
}

/**
 * The one-line verdict for a whole report
 * @param {object} report
 * @returns {{level: string, text: string}}
 */
export function summary(report) {
  const connected = report.peers.filter(peer => peer.connected).length;
  const broken = report.peers.filter(peer => peer_status(peer, report.self).level === "bad").length;
  const bad_self = self_issues(report.self).some(issue => issue.level === "bad");
  if (bad_self || broken) return { level: "bad", text: F("Summary.Problems", { connected, total: report.peers.length }) };
  if (!report.peers.length) return { level: "info", text: L("Summary.Alone") };
  if (report.peers.some(peer => peer_status(peer, report.self).level === "warn")) return { level: "warn", text: F("Summary.Warnings", { connected, total: report.peers.length }) };
  return { level: "ok", text: F("Summary.Working", { connected, total: report.peers.length }) };
}

/**
 * A plain-text version for pasting into Discord or an email
 * @param {object} report
 * @returns {string}
 */
export function report_text(report) {
  const { self } = report;
  const lines = [
    F("Text.Heading", { name: self.name, time: new Date(report.at).toLocaleString() }),
    summary(report).text,
    ...self_issues(self).map(issue => "! " + issue.text),
    "",
    ...report.peers.map(peer => "- " + peer.name + ": " + peer_status(peer, self).text + " [" + (peer.route ?? "?") + "]"
      + (peer_sound(peer) ? "\n    " + peer_sound(peer) : "")),
    "",
    "Foundry " + self.foundry + ", module " + self.module + " (scripts " + self.scripts + ")",
    "Relay: " + (self.relay ?? "none") + "; your addresses: "
      + (self.webrtcSupported ? Object.entries(self.addresses).map(([type, count]) => type + " " + count).join(", ") || "NONE" : "WebRTC disabled"),
    "Relay test: " + (self.relay ? relay_test_text(self.relayTest) : "no relay configured"),
    "Microphone: " + (self.mic ? (self.mic.capturing ? "capturing" : "NOT capturing") + ", permission " + self.mic.permission
      + ", device " + (self.mic.deviceLabel ?? self.mic.device ?? "?") + ", " + (self.mic.activation ?? "?") : "unknown"),
    "Fix Voice Connection Drops: " + (self.connectionFix === undefined ? "unknown" : self.connectionFix ? "on" : "OFF"),
    "Voice audio: " + audio_path_text(self.audio) + "; sound through and around walls: "
      + (self.soundPropagation === undefined ? "unknown" : self.soundPropagation ? "on" : "off")
      + "; directional voice: " + (self.directional ? self.directional + "%" : "off"),
    "Browser: " + self.browser
  ];
  return lines.join("\n");
}

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

const LEVEL_ICONS = {
  ok: "fa-solid fa-circle-check",
  info: "fa-solid fa-circle-info",
  warn: "fa-solid fa-triangle-exclamation",
  bad: "fa-solid fa-circle-xmark"
};

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text] set with textContent, so names can't inject markup
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function status_line(level, text) {
  const line = el("div", "pvc-status pvc-" + level);
  line.append(el("i", LEVEL_ICONS[level] ?? LEVEL_ICONS.info), el("span", "", text));
  return line;
}

/**
 * Builds the report's contents
 * @param {object} report
 * @param {object} [options]
 * @param {"own" | "remote" | null} [options.unhide] which Show Again button hidden users get: "own" changes this
 *   browser's setting, "remote" asks the reporting player's browser to (GMs only)
 * @returns {HTMLElement}
 */
export function render_report(report, { unhide = null } = {}) {
  const root = el("div", "pvc-report");
  const verdict = summary(report);
  root.append(status_line(verdict.level, verdict.text));
  for (const issue of self_issues(report.self)) root.append(status_line(issue.level, issue.text));

  if (report.peers.length) {
    const table = el("table", "pvc-peers");
    const head = el("tr");
    for (const key of ["Player", "Status", "Route"]) head.append(el("th", "", L("Column." + key)));
    table.append(head);
    for (const peer of report.peers) {
      const status = peer_status(peer, report.self);
      const row = el("tr", "pvc-" + status.level);
      row.dataset.userId = peer.id;
      const cell = el("td");
      cell.append(el("i", LEVEL_ICONS[status.level]), document.createTextNode(" " + status.text));
      if (peer.problem === "hidden" && unhide) {
        const show = el("button", "pvc-unhide");
        show.type = "button";
        show.dataset.action = unhide === "own" ? "unhide" : "remoteUnhide";
        show.dataset.userId = peer.id;
        show.append(el("i", "fa-solid fa-eye"), document.createTextNode(" " + L(unhide === "own" ? "Button.Unhide" : "Button.RemoteUnhide")));
        cell.append(show);
      }
      const sound = peer_sound(peer);
      if (sound) cell.append(el("div", "pvc-sound", sound));
      row.append(el("td", "", peer.name + (peer.isGM ? " [GM]" : "")), cell, el("td", "", peer.route ?? "?"));
      table.append(row);
    }
    root.append(table);
  }

  const self = report.self;
  const facts = el("ul", "pvc-facts");
  const fact = (label, value) => facts.append(el("li", "", L("Fact." + label) + ": " + value));
  fact("Mode", game.i18n.localize("proximity-voice-chat.UI.Mode." + self.voiceMode));
  fact("Listening", self.listeningThrough.join(", ") || L("Nothing"));
  fact("Speaking", self.speakingThrough.join(", ") || L("Nothing"));
  fact("Relay", self.relay ?? L("NoRelay"));
  if (self.relay) fact("RelayTest", relay_test_text(self.relayTest));
  if (self.audio) {
    fact("Audio", audio_path_text(self.audio));
    fact("Propagation", L(self.soundPropagation ? "On" : "Off"));
    fact("Directional", self.directional ? self.directional + "%" : L("Off"));
  }
  root.append(facts);

  const details = el("details", "pvc-details");
  const copy = el("button", "pvc-copy-details");
  copy.type = "button";
  copy.dataset.action = "copyDetails";
  copy.append(el("i", "fa-solid fa-copy"), document.createTextNode(" " + L("Button.CopyDetails")));
  details.append(el("summary", "", L("Details")), copy, el("pre", "", JSON.stringify(report, null, 2)));
  root.append(details);
  return root;
}

/**
 * A short HTML summary for the chat card. Built with DOM methods so player names are escaped.
 * @param {object} report
 * @returns {string}
 */
function card_html(report) {
  const card = el("div", "pvc-report-card");
  card.append(el("strong", "", F("Card.Title", { name: report.self.name })));
  const verdict = summary(report);
  card.append(status_line(verdict.level, verdict.text));
  const button = el("button", "pvc-open-report");
  button.type = "button";
  button.append(el("i", "fa-solid fa-stethoscope"), document.createTextNode(" " + L("Card.Open")));
  card.append(button);
  return card.outerHTML;
}

/* -------------------------------------------- */
/*  Sending and receiving                       */
/* -------------------------------------------- */

/**
 * Posts a report as a chat card whispered to the GMs. Only a GM's browser does this (see the file comment).
 * @param {object} report
 * @returns {Promise<ChatMessage>}
 */
function post_card(report) {
  return ChatMessage.implementation.create({
    content: card_html(report),
    whisper: ChatMessage.implementation.getWhisperRecipients("GM").map(user => user.id),
    speaker: { alias: report.self.name },
    flags: { [MODULE_ID]: { report } }
  });
}

/**
 * Sends this browser's full report to the GMs
 * @param {string | null} to the GM who asked for it, or null when the player sends it themselves
 * @returns {Promise<boolean>} whether a GM was online to receive it
 */
async function send_report(to = null) {
  const report = await api().collect_diagnostics({ redact: false });
  if (game.user.isGM) {
    await post_card(report);
    return true;
  }
  if (!game.users.activeGM) return false;
  game.socket.emit(SOCKET, { action: "diagnostics-report", from: game.user.id, to, report });
  return true;
}

/**
 * Undoes "Hide User" for someone in this browser, so their audio plays again
 * @param {string} user_id
 */
async function show_user(user_id) {
  await game.webrtc.settings.set("client", `users.${user_id}.blocked`, false);
  ui.webrtc?.render();
}

/**
 * Asks a player's browser to run diagnostics and send the report back
 * @param {foundry.documents.User} user
 */
export function request_diagnostics(user) {
  clearTimeout(_pending.get(user.id));
  _pending.set(user.id, setTimeout(() => {
    _pending.delete(user.id);
    ui.notifications.warn(F("NoReply", { name: user.name }));
  }, REQUEST_TIMEOUT_MS));
  write_gm_request(user, "diagnose");
  ui.notifications.info(F("Requested", { name: user.name }));
}

/**
 * Acts on a GM's request written to this player's user record, if the server says a GM wrote it
 * @param {foundry.documents.User} user the updated user record
 * @param {object} changed
 * @param {object} _options
 * @param {string} author_id the server's record of who made the update; the request's content is not trusted
 */
async function on_gm_request(user, changed, _options, author_id) {
  if (!user.isSelf || !changed.flags?.[MODULE_ID]?.gmRequest) return;
  // read the whole stored request: the diff only holds the fields that changed
  const request = user.getFlag(MODULE_ID, "gmRequest");
  const author = game.users.get(author_id);
  if (!request?.id || !author?.isGM || _handled_requests.has(request.id)) return;
  _handled_requests.add(request.id);
  if (request.action === "unhide" && game.users.get(request.user)) {
    await show_user(request.user);
    ui.notifications.info(F("Unhidden", { gm: author.name, name: game.users.get(request.user).name }));
  } else if (request.action === "diagnose") {
    ui.notifications.info(F("RanByGM", { name: author.name }));
  } else {
    return;
  }
  await send_report(author.id);
}

async function on_message(message) {
  // reports are only ever posted to GMs, so a forged one can mislead a GM but can't act on anyone's browser
  if (message?.action === "diagnostics-report" && game.user.isGM) {
    // the GM who asked posts it; for a report the player sent unprompted, the designated active GM does
    const poster = message.to ?? game.users.activeGM?.id;
    if (poster !== game.user.id) return;
    clearTimeout(_pending.get(message.from));
    _pending.delete(message.from);
    await post_card(message.report);
    if (message.to === game.user.id) open_report(message.report);
  }
}

/**
 * @param {object | null} [report] a received report; omit to diagnose this browser
 * @returns {Promise<ApplicationV2 | null>}
 */
export function open_report(report = null) {
  if (!VoiceDiagnostics) return Promise.resolve(null);
  const app = new VoiceDiagnostics({ report });
  return app.render({ force: true }).then(() => app);
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/**
 * Defines the window and registers the settings menu entry. Called from init.
 */
export function register_diagnostics() {
  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (!ApplicationV2) return;

  VoiceDiagnostics = class VoiceDiagnostics extends ApplicationV2 {
    /**
     * @param {object} [options]
     * @param {object | null} [options.report] a report received from someone else; omit to diagnose this browser
     */
    constructor({ report = null, ...options } = {}) {
      super(options);
      this.report = report;
      this.remote = !!report;
    }

    static DEFAULT_OPTIONS = {
      id: "pvc-diagnostics-{id}",
      classes: ["pvc-diagnostics"],
      window: { title: "proximity-voice-chat.Diagnostics.Title", icon: "fa-solid fa-stethoscope", resizable: true },
      position: { width: 560, height: "auto" },
      actions: {
        rerun: VoiceDiagnostics.#onRerun,
        copy: VoiceDiagnostics.#onCopy,
        copyDetails: VoiceDiagnostics.#onCopyDetails,
        send: VoiceDiagnostics.#onSend,
        request: VoiceDiagnostics.#onRequest,
        unhide: VoiceDiagnostics.#onUnhide,
        remoteUnhide: VoiceDiagnostics.#onRemoteUnhide
      }
    };

    get title() {
      return this.remote ? F("TitleFrom", { name: this.report.self.name }) : L("Title");
    }

    async _prepareContext(options) {
      // a player's own view is redacted; GMs see everything
      if (!this.report) this.report = await api().collect_diagnostics({ redact: !game.user.isGM });
      return super._prepareContext(options);
    }

    async _renderHTML(_context, _options) {
      const body = el("div", "pvc-diagnostics-body");
      const unhide = !this.remote ? "own" : (game.user.isGM && game.users.get(this.report.self.id)?.active ? "remote" : null);
      body.append(render_report(this.report, { unhide }));
      const buttons = el("div", "pvc-diagnostics-buttons");
      const button = (action, icon, label) => {
        const b = el("button");
        b.type = "button";
        b.dataset.action = action;
        b.append(el("i", icon), document.createTextNode(" " + L("Button." + label)));
        buttons.append(b);
      };
      if (!this.remote) button("rerun", "fa-solid fa-rotate", "Rerun");
      button("copy", "fa-solid fa-copy", "Copy");
      if (!this.remote && !game.user.isGM) button("send", "fa-solid fa-paper-plane", "Send");
      if (this.remote && game.user.isGM && game.users.get(this.report.self.id)?.active) button("request", "fa-solid fa-rotate", "Request");
      body.append(buttons);
      return body;
    }

    _replaceHTML(result, content, _options) {
      content.replaceChildren(result);
    }

    static async #onRerun() {
      // the relay test takes a few seconds, so it only re-runs when asked for, not for every report
      await api().run_relay_test?.();
      this.report = null;
      await this.render();
    }

    static async #onCopy() {
      await game.clipboard.copyPlainText(report_text(this.report));
      ui.notifications.info(L("Copied"));
    }

    static async #onCopyDetails() {
      await game.clipboard.copyPlainText(JSON.stringify(this.report, null, 2));
      ui.notifications.info(L("CopiedDetails"));
    }

    static async #onSend() {
      const sent = await send_report(null);
      ui.notifications[sent ? "info" : "warn"](L(sent ? "Sent" : "NoGM"));
    }

    static async #onUnhide(_event, target) {
      await show_user(target.dataset.userId);
      this.report = null;
      await this.render();
    }

    static #onRemoteUnhide(_event, target) {
      const player = game.users.get(this.report.self.id);
      const hidden = game.users.get(target.dataset.userId);
      if (!player || !hidden) return;
      write_gm_request(player, "unhide", hidden.id);
      ui.notifications.info(F("AskedUnhide", { player: player.name, name: hidden.name }));
    }

    static #onRequest() {
      const user = game.users.get(this.report.self.id);
      if (user) request_diagnostics(user);
    }
  };

  game.settings.registerMenu(MODULE_ID, "diagnostics", {
    name: "proximity-voice-chat.Diagnostics.Menu.Name",
    label: "proximity-voice-chat.Diagnostics.Menu.Label",
    hint: "proximity-voice-chat.Diagnostics.Menu.Hint",
    icon: "fa-solid fa-stethoscope",
    type: VoiceDiagnostics,
    restricted: false
  });
}

Hooks.once("ready", () => {
  game.socket?.on(SOCKET, on_message);
});

Hooks.on("updateUser", on_gm_request);

Hooks.on("getUserContextOptions", (_application, options) => {
  options.push(
    {
      label: "proximity-voice-chat.Diagnostics.Menu.Label",
      icon: "fa-solid fa-stethoscope",
      visible: li => li.dataset.userId === game.user.id,
      onClick: () => open_report()
    },
    {
      label: "proximity-voice-chat.Diagnostics.Request",
      icon: "fa-solid fa-stethoscope",
      visible: li => game.user.isGM && li.dataset.userId !== game.user.id && !!game.users.get(li.dataset.userId)?.active,
      onClick: (_event, li) => request_diagnostics(game.users.get(li.dataset.userId))
    }
  );
});

// the chat card's button opens the full report it carries
Hooks.on("renderChatMessageHTML", (message, html) => {
  const report = message.getFlag?.(MODULE_ID, "report");
  if (!report) return;
  html.querySelector(".pvc-open-report")?.addEventListener("click", (event) => {
    event.preventDefault();
    open_report(report);
  });
});

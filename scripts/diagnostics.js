/**
 * Voice diagnostics without the browser console: a window anyone can open (Configure Settings, or right-click
 * yourself in the players list), and for GMs, the ability to run it on a player's browser remotely.
 *
 * Reports reach GMs as chat cards. A player's browser sends its report to a GM's browser over the module socket,
 * and the GM's browser posts the card, whispered to GMs. If the player's browser posted it, the player could read
 * the full report (hidden token names included) in their own chat log, since authors always see their whispers.
 *
 * Talks to proximity-voice-chat.js only through game.modules.get(MODULE_ID).api, at runtime.
 */
const MODULE_ID = "proximity-voice-chat";

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const DIAG_SCRIPT_VERSION = "1.6.2";

const SOCKET = "module." + MODULE_ID;
const REQUEST_TIMEOUT_MS = 10000;
const L = key => game.i18n.localize("proximity-voice-chat.Diagnostics." + key);
const F = (key, data) => game.i18n.format("proximity-voice-chat.Diagnostics." + key, data);
const api = () => game.modules.get(MODULE_ID).api;

/** The window class, defined in init once Foundry's application classes exist */
let VoiceDiagnostics = null;

/** Requests this GM has sent and not yet had an answer to, by user ID */
const _pending = new Map();

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
    issues.push({ level: "warn", text: game.i18n.localize("proximity-voice-chat.SelfTest.relay-unreachable") });
  }
  if (self.deafened) issues.push({ level: "warn", text: L("Deafened") });
  if (self.micMuted) issues.push({ level: "info", text: L("MicMuted") });
  return issues;
}

/**
 * One other user's status, in plain language
 * @param {object} peer an entry of the report's peers
 * @returns {{level: string, text: string}} level: "ok", "info", "warn" or "bad"
 */
export function peer_status(peer) {
  if (peer.problem === "own-browser") return { level: "bad", text: L("Peer.OwnBrowser") };
  if (peer.problem === "no-connection") return { level: "bad", text: L("Peer.NoConnection") };
  if (peer.problem === "not-established") return { level: "bad", text: F("Peer.NotEstablished", { state: peer.connectionState ?? "?" }) };
  if (peer.problem === "no-audio-element") return { level: "warn", text: L("Peer.NoAudioElement") };
  if (peer.problem === "paused") return { level: "warn", text: L("Peer.Paused") };
  if (peer.muted) return { level: "info", text: L("Peer.Muted") };
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
  const broken = report.peers.filter(peer => peer_status(peer).level === "bad").length;
  const bad_self = self_issues(report.self).some(issue => issue.level === "bad");
  if (bad_self || broken) return { level: "bad", text: F("Summary.Problems", { connected, total: report.peers.length }) };
  if (!report.peers.length) return { level: "info", text: L("Summary.Alone") };
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
    ...report.peers.map(peer => "- " + peer.name + ": " + peer_status(peer).text + " [" + (peer.route ?? "?") + "]"),
    "",
    "Foundry " + self.foundry + ", module " + self.module + " (scripts " + self.scripts + ")",
    "Relay: " + (self.relay ?? "none") + "; your addresses: "
      + (self.webrtcSupported ? Object.entries(self.addresses).map(([type, count]) => type + " " + count).join(", ") || "NONE" : "WebRTC disabled"),
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
 * @returns {HTMLElement}
 */
export function render_report(report) {
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
      const status = peer_status(peer);
      const row = el("tr", "pvc-" + status.level);
      row.dataset.userId = peer.id;
      const cell = el("td");
      cell.append(el("i", LEVEL_ICONS[status.level]), document.createTextNode(" " + status.text));
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
  root.append(facts);

  const details = el("details", "pvc-details");
  details.append(el("summary", "", L("Details")), el("pre", "", JSON.stringify(report, null, 2)));
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
 * Asks a player's browser to run diagnostics and send the report back
 * @param {foundry.documents.User} user
 */
export function request_diagnostics(user) {
  clearTimeout(_pending.get(user.id));
  _pending.set(user.id, setTimeout(() => {
    _pending.delete(user.id);
    ui.notifications.warn(F("NoReply", { name: user.name }));
  }, REQUEST_TIMEOUT_MS));
  game.socket.emit(SOCKET, { action: "diagnostics-request", from: game.user.id, to: user.id });
  ui.notifications.info(F("Requested", { name: user.name }));
}

async function on_message(message) {
  if (message?.action === "diagnostics-request" && message.to === game.user.id) {
    ui.notifications.info(F("RanByGM", { name: game.users.get(message.from)?.name ?? "GM" }));
    await send_report(message.from);
  }
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
        send: VoiceDiagnostics.#onSend,
        request: VoiceDiagnostics.#onRequest
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
      body.append(render_report(this.report));
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
      this.report = null;
      await this.render();
    }

    static async #onCopy() {
      await game.clipboard.copyPlainText(report_text(this.report));
      ui.notifications.info(L("Copied"));
    }

    static async #onSend() {
      const sent = await send_report(null);
      ui.notifications[sent ? "info" : "warn"](L(sent ? "Sent" : "NoGM"));
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

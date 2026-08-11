/**
 * Browser entry point: binds the conversation orchestrator to the DOM.
 *
 * Wiring only. Every rule worth testing lives in conversation.ts, micGate.ts, latency.ts
 * and view.ts, none of which know that a browser exists.
 */
import { LANGUAGES, requireLanguage } from "../shared/languages.js";
import { createConversation, type ConversationState, type ParticipantId } from "./conversation.js";
import {
  createMicrophoneSource,
  createSpeechChannel,
  createSpeechPlayer,
} from "./azureSpeech.js";
import { createSpeechTokenClient } from "./speechToken.js";
import { captionFor, formatLatency, statusLabel } from "./view.js";
import "./styles.css";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const ui = {
  status: el<HTMLDivElement>("status"),
  statusText: el<HTMLSpanElement>("status-text"),
  notice: el<HTMLDivElement>("notice"),
  noticeTitle: el<HTMLSpanElement>("notice-title"),
  noticeBody: el<HTMLParagraphElement>("notice-body"),
  transcript: el<HTMLUListElement>("transcript"),
  transcriptEmpty: el<HTMLParagraphElement>("transcript-empty"),
  release: el<HTMLButtonElement>("release"),
  a: {
    channel: el<HTMLElement>("channel-a"),
    lang: el<HTMLSelectElement>("lang-a"),
    caption: el<HTMLParagraphElement>("caption-a"),
    hint: el<HTMLParagraphElement>("hint-a"),
    floor: el<HTMLButtonElement>("floor-a"),
    floorLabel: el<HTMLSpanElement>("floor-a-label"),
    badge: el<HTMLSpanElement>("badge-a"),
  },
  b: {
    channel: el<HTMLElement>("channel-b"),
    lang: el<HTMLSelectElement>("lang-b"),
    caption: el<HTMLParagraphElement>("caption-b"),
    hint: el<HTMLParagraphElement>("hint-b"),
    floor: el<HTMLButtonElement>("floor-b"),
    floorLabel: el<HTMLSpanElement>("floor-b-label"),
    badge: el<HTMLSpanElement>("badge-b"),
  },
} as const;

const DEFAULTS: Record<ParticipantId, string> = { a: "en", b: "hi" };

function populateLanguages(select: HTMLSelectElement, selected: string): void {
  select.replaceChildren(
    ...LANGUAGES.map((language) => {
      const option = document.createElement("option");
      option.value = language.code;
      option.textContent = `${language.name} — ${language.nativeName}`;
      option.selected = language.code === selected;
      return option;
    }),
  );
}

populateLanguages(ui.a.lang, DEFAULTS.a);
populateLanguages(ui.b.lang, DEFAULTS.b);

const tokens = createSpeechTokenClient();
const player = createSpeechPlayer(tokens);
const microphone = createMicrophoneSource();

let conversation = buildConversation();

function buildConversation() {
  return createConversation({
    participants: {
      a: { name: "You", language: ui.a.lang.value },
      b: { name: "Them", language: ui.b.lang.value },
    },
    createChannel: (spec, callbacks) => createSpeechChannel(spec, callbacks, tokens, microphone),
    player,
    microphone,
  });
}

function setStatus(state: "connecting" | "ready" | "error", text: string): void {
  ui.status.dataset["state"] = state;
  ui.statusText.textContent = text;
}

type NoticeOwner = "conversation" | "bootstrap" | "microphone" | null;
let noticeOwner: NoticeOwner = null;

function showNotice(title: string, body: string, owner: NoticeOwner = "conversation"): void {
  noticeOwner = owner;
  ui.noticeTitle.textContent = title;
  ui.noticeBody.textContent = body;
  ui.notice.hidden = false;
}

function hideNotice(): void {
  noticeOwner = null;
  ui.notice.hidden = true;
}

function renderTranscript(state: ConversationState): void {
  ui.transcriptEmpty.hidden = state.transcript.length > 0;

  ui.transcript.replaceChildren(
    ...state.transcript.map((entry) => {
      const item = document.createElement("li");
      item.className = "turn";
      item.dataset["speaker"] = entry.speaker;

      const who = document.createElement("span");
      who.className = "turn__who";
      who.textContent = entry.speaker === "a" ? "YOU" : "THEM";

      const body = document.createElement("div");
      const original = document.createElement("p");
      original.className = "turn__original";
      original.lang = entry.sourceLanguage;
      original.textContent = entry.original;

      const translated = document.createElement("p");
      translated.className = "turn__translated";
      const target = requireLanguage(entry.targetLanguage);
      translated.lang = entry.targetLanguage;
      translated.dir = target.dir;
      translated.textContent = entry.translated;
      body.append(original, translated);

      const latency = document.createElement("span");
      latency.className = "turn__latency";
      latency.textContent = formatLatency(entry.latency);
      latency.title = "Time to caption · to translation · until heard";

      item.append(who, body, latency);
      return item;
    }),
  );

  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function renderPanel(state: ConversationState, id: ParticipantId): void {
  const panel = ui[id];
  const language = requireLanguage(id === "a" ? ui.a.lang.value : ui.b.lang.value);
  const caption = captionFor(state, id);
  const holdsFloor = state.floor === id;

  panel.caption.textContent = caption.text;
  panel.caption.dataset["pending"] = String(caption.pending);
  panel.caption.lang = language.code;
  panel.caption.dir = language.dir;
  panel.hint.hidden = caption.text.length > 0;

  panel.channel.dataset["live"] = String(holdsFloor);
  panel.floor.setAttribute("aria-pressed", String(holdsFloor));
  panel.floorLabel.textContent = holdsFloor ? "Listening…" : "Hold to speak";
  panel.badge.hidden = !(holdsFloor && state.phase === "listening");
  panel.lang.disabled = state.floor !== null;
}

function render(state: ConversationState): void {
  renderPanel(state, "a");
  renderPanel(state, "b");
  renderTranscript(state);
  ui.release.disabled = state.floor === null;

  if (state.error) {
    setStatus("error", "Problem");
    showNotice("Something interrupted the conversation", state.error);
    return;
  }

  // Only clear a notice this function raised. Bootstrap and microphone-permission
  // failures are owned elsewhere and must not be wiped by an unrelated state change.
  if (noticeOwner === "conversation") hideNotice();
  if (noticeOwner === null) {
    setStatus(state.floor === null ? "ready" : "connecting", statusLabel(state.phase));
    if (state.floor !== null && state.phase === "listening") {
      setStatus("ready", statusLabel(state.phase));
    }
  }
}

function bind(): void {
  conversation.subscribe(render);
  render(conversation.getState());
}

bind();

async function takeFloor(id: ParticipantId): Promise<void> {
  try {
    await conversation.takeFloor(id);
  } catch (cause) {
    showNotice(
      "Could not start the microphone",
      cause instanceof Error ? cause.message : String(cause),
      "microphone",
    );
    setStatus("error", "Problem");
  }
}

/**
 * Press-and-hold to talk, which is what the label promises.
 *
 * A pure hold gesture would fail anyone who cannot sustain a press, so the keyboard path
 * (1 / 2 to latch, Esc to release) stays as an equal alternative rather than a fallback.
 * `heldBy` distinguishes the two so releasing the pointer never cancels a latched turn.
 */
let heldBy: ParticipantId | null = null;

function bindHoldToTalk(id: ParticipantId, button: HTMLButtonElement): void {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    // Keep receiving events even if the finger slides off the button.
    button.setPointerCapture(event.pointerId);
    heldBy = id;
    void takeFloor(id);
  });

  const release = (event: PointerEvent): void => {
    if (heldBy !== id) return;
    heldBy = null;
    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    void conversation.releaseFloor();
  };

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);

  // Space and Enter activate a button by default; make them hold rather than toggle so the
  // keyboard behaves like the label says, while 1 / 2 remain the latching alternative.
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (event.repeat) return;
    event.preventDefault();
    heldBy = id;
    void takeFloor(id);
  });

  button.addEventListener("keyup", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (heldBy !== id) return;
    heldBy = null;
    void conversation.releaseFloor();
  });

  // A press interrupted by the tab losing focus must not leave the microphone open.
  button.addEventListener("blur", () => {
    if (heldBy !== id) return;
    heldBy = null;
    void conversation.releaseFloor();
  });
}

bindHoldToTalk("a", ui.a.floor);
bindHoldToTalk("b", ui.b.floor);

ui.release.addEventListener("click", () => void conversation.releaseFloor());

// Changing a language rebuilds the conversation: the recognizers are configured per
// language pair, so an in-flight one would still be translating into the old language.
for (const select of [ui.a.lang, ui.b.lang]) {
  select.addEventListener("change", () => {
    void conversation.releaseFloor().then(() => {
      conversation = buildConversation();
      bind();
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLSelectElement) return;
  // Space/Enter are handled by the buttons themselves as a hold gesture.
  if (event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) {
    return;
  }
  if (event.repeat) return;
  // 1 and 2 latch the microphone on, for anyone who cannot hold a press.
  if (event.key === "1") void takeFloor("a");
  if (event.key === "2") void takeFloor("b");
  if (event.key === "Escape") {
    heldBy = null;
    void conversation.releaseFloor();
  }
});

// Releasing on tab-switch: a hidden tab holding an open microphone is a surprise.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && heldBy !== null) {
    heldBy = null;
    void conversation.releaseFloor();
  }
});

// Prove the credential path works before anyone clicks, so a misconfiguration surfaces
// immediately rather than as a dead microphone mid-demo.
void tokens
  .get()
  .then(() => setStatus("ready", statusLabel("idle")))
  .catch((cause: unknown) => {
    setStatus("error", "No connection");
    showNotice(
      "Could not reach Azure Speech",
      cause instanceof Error ? cause.message : String(cause),
      "bootstrap",
    );
  });


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
  panel.floorLabel.textContent = holdsFloor ? "Listening… tap to stop" : "Tap to speak";
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
 * Click to start talking, click again to stop.
 *
 * A toggle rather than a press-and-hold: holding a button for the length of a sentence is
 * tiring, impossible for some users, and makes the mouse unavailable for anything else.
 * Clicking the party who already holds the microphone releases it, so the same control
 * both starts and stops — there is never a state you cannot leave from the same button.
 */
function toggleFloor(id: ParticipantId): void {
  if (conversation.getState().floor === id) {
    void conversation.releaseFloor();
    return;
  }
  void takeFloor(id);
}

ui.a.floor.addEventListener("click", () => toggleFloor("a"));
ui.b.floor.addEventListener("click", () => toggleFloor("b"));
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
  // Space/Enter already activate a focused button; leave them to the browser.
  if (event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) {
    return;
  }
  if (event.repeat) return;
  if (event.key === "1") toggleFloor("a");
  if (event.key === "2") toggleFloor("b");
  if (event.key === "Escape") void conversation.releaseFloor();
});

// A background tab with an open microphone is a surprise nobody wants.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && conversation.getState().floor !== null) {
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


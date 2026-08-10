/**
 * Pure presentation logic — what each panel should say, given the conversation state.
 *
 * The governing rule: **each panel always shows text in that participant's own language.**
 * When you speak, your panel shows your words and theirs shows the translation; when they
 * speak, it mirrors. Nobody is ever asked to read a language they do not speak.
 */
import type { ConversationPhase } from "./micGate.js";
import type { ConversationState, ParticipantId } from "./conversation.js";
import type { LatencySnapshot } from "./latency.js";

export interface Caption {
  readonly text: string;
  /** True while the text is still an interim hypothesis and may still change. */
  readonly pending: boolean;
}

const EMPTY: Caption = { text: "", pending: false };

export function captionFor(state: ConversationState, viewer: ParticipantId): Caption {
  const live = state.live;
  if (live) {
    return {
      text: viewer === live.speaker ? live.original : live.translated,
      pending: true,
    };
  }

  const last = state.transcript[state.transcript.length - 1];
  if (!last) return EMPTY;

  return {
    text: viewer === last.speaker ? last.original : last.translated,
    pending: false,
  };
}

function seconds(ms: number | undefined): string {
  return ms === undefined ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

/** "caption · translation · heard" — the three moments a watching human cares about. */
export function formatLatency(latency: LatencySnapshot): string {
  return [
    seconds(latency.firstPartialMs),
    seconds(latency.finalMs),
    seconds(latency.audioStartMs),
  ].join(" · ");
}

const PHASE_LABELS: Record<ConversationPhase, string> = {
  idle: "Ready — nobody is holding the floor",
  listening: "Listening",
  translating: "Translating",
  speaking: "Speaking the translation — microphone muted",
  cooldown: "Speaking the translation — microphone muted",
};

export function statusLabel(phase: ConversationPhase): string {
  return PHASE_LABELS[phase];
}

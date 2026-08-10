/**
 * Decides when the microphone may be believed.
 *
 * The demo speaks its translation through the same machine that is listening. Without a
 * countermeasure the microphone hears that translation, translates it back, speaks *that*,
 * and loops — the classic interpreter feedback failure (ADR-0006). `TranslationRecognizer`
 * has no echo cancellation of its own, so this gate provides it in software.
 *
 * The recognizer is deliberately left running throughout: stopping and restarting it costs
 * a reconnect, which would appear as latency on the following turn. Instead, results that
 * arrive while we are speaking are simply not believed.
 *
 * Pure and clock-free — the caller supplies `now`, so the whole thing is unit-testable and
 * cannot become flaky.
 */

export type ConversationPhase = "idle" | "listening" | "translating" | "speaking" | "cooldown";

/** Silence held after playback ends, to let speakers ring out and rooms stop reverberating. */
export const PLAYBACK_TAIL_MS = 400;

export interface MicGateOptions {
  readonly tailMs?: number;
  readonly onPhaseChange?: (phase: ConversationPhase) => void;
}

export interface MicGate {
  readonly phase: ConversationPhase;
  /** Whether a recognition result arriving now should be believed. */
  acceptsSpeech(now: number): boolean;
  /** This party takes the floor. */
  beginTurn(now: number): void;
  /** This party gives up the floor. Always succeeds, from any phase. */
  endTurn(): void;
  /** A final translation arrived; we are no longer listening for new speech. */
  noteFinalResult(now: number): void;
  notePlaybackStarted(now: number): void;
  notePlaybackEnded(now: number): void;
}

export function createMicGate(options: MicGateOptions = {}): MicGate {
  const tailMs = options.tailMs ?? PLAYBACK_TAIL_MS;
  const onPhaseChange = options.onPhaseChange;

  let phase: ConversationPhase = "idle";
  let cooldownUntil = 0;

  function setPhase(next: ConversationPhase): void {
    if (next === phase) return;
    phase = next;
    onPhaseChange?.(next);
  }

  /** Cooldown expires on the clock, so it is resolved lazily whenever time is observed. */
  function settle(now: number): void {
    if (phase === "cooldown" && now >= cooldownUntil) {
      setPhase("listening");
    }
  }

  return {
    get phase(): ConversationPhase {
      return phase;
    },

    acceptsSpeech(now: number): boolean {
      settle(now);
      return phase === "listening";
    },

    beginTurn(now: number): void {
      cooldownUntil = now;
      setPhase("listening");
    },

    endTurn(): void {
      setPhase("idle");
    },

    noteFinalResult(now: number): void {
      settle(now);
      if (phase !== "listening") return;
      setPhase("translating");
    },

    notePlaybackStarted(now: number): void {
      settle(now);
      // Only meaningful mid-turn; a stray event must not wake an idle gate.
      if (phase !== "translating" && phase !== "speaking") return;
      setPhase("speaking");
    },

    notePlaybackEnded(now: number): void {
      if (phase !== "speaking") return;
      cooldownUntil = now + tailMs;
      setPhase("cooldown");
    },
  };
}

/**
 * Orchestrates a two-party interpreted conversation.
 *
 * The Speech SDK sits behind the `TranslationChannel`, `SpeechPlayer` and `MicrophoneControl`
 * seams, so every rule in here — who holds the floor, which results are believed, whose voice
 * speaks the translation, what gets committed to the transcript — is testable without a
 * network, a microphone or a browser.
 *
 * One party holds the floor at a time. That is not a simplification: the machine has one
 * microphone, so two simultaneous recognizers would both hear the same audio (ADR-0005).
 */
import { requireLanguage } from "../shared/languages.js";
import {
  createMicGate,
  PLAYBACK_TAIL_MS,
  type ConversationPhase,
  type MicGate,
} from "./micGate.js";
import { createLatencyMeter, type LatencyMeter, type LatencySnapshot } from "./latency.js";

export type ParticipantId = "a" | "b";

export interface ParticipantConfig {
  readonly name: string;
  /** Translation code from the shared catalog, e.g. "en", "hi". */
  readonly language: string;
}

export interface ChannelSpec {
  readonly speaker: ParticipantId;
  /** Recognition locale for the speaker, e.g. "en-US". */
  readonly speechLocale: string;
  /** Translation target code for the listener, e.g. "hi". */
  readonly targetLanguage: string;
}

export interface ChannelCallbacks {
  /** The service detected the start of speech — the honest zero point for latency. */
  onSpeechStart(): void;
  /** Interim hypothesis — changes as the speaker continues. Never committed. */
  onRecognizing(original: string, translated: string): void;
  /** Settled result for one utterance. */
  onRecognized(original: string, translated: string): Promise<void> | void;
  onError(message: string): void;
}

export interface TranslationChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SpeakHooks {
  /** Fired when audio actually starts coming out of the speaker, not when it was requested. */
  readonly onAudioStart?: () => void;
}

export interface SpeechPlayer {
  speak(text: string, voice: string, hooks?: SpeakHooks): Promise<void>;
  cancel(): void;
}

/** Control over the capture device itself, so playback cannot be recorded at all. */
export interface MicrophoneControl {
  setMuted(muted: boolean): void;
}

export interface TranscriptEntry {
  readonly id: string;
  readonly speaker: ParticipantId;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly original: string;
  readonly translated: string;
  readonly latency: LatencySnapshot;
}

export interface LiveLine {
  readonly speaker: ParticipantId;
  readonly original: string;
  readonly translated: string;
}

export interface ConversationState {
  readonly floor: ParticipantId | null;
  readonly phase: ConversationPhase;
  readonly live: LiveLine | null;
  readonly transcript: readonly TranscriptEntry[];
  readonly error: string | null;
}

export interface ConversationOptions {
  readonly participants: Record<ParticipantId, ParticipantConfig>;
  readonly createChannel: (spec: ChannelSpec, callbacks: ChannelCallbacks) => TranslationChannel;
  readonly player: SpeechPlayer;
  readonly microphone?: MicrophoneControl;
  readonly now?: () => number;
  readonly gate?: MicGate;
  readonly meter?: LatencyMeter;
  /** Injected so the cooldown re-emit is testable without real timers. */
  readonly schedule?: (task: () => void, ms: number) => void;
}

export interface Conversation {
  getState(): ConversationState;
  subscribe(listener: (state: ConversationState) => void): () => void;
  takeFloor(participant: ParticipantId): Promise<void>;
  releaseFloor(): Promise<void>;
}

const OTHER: Record<ParticipantId, ParticipantId> = { a: "b", b: "a" };

export function createConversation(options: ConversationOptions): Conversation {
  const now = options.now ?? (() => Date.now());
  const meter = options.meter ?? createLatencyMeter();
  const schedule = options.schedule ?? ((task, ms) => void setTimeout(task, ms));
  const microphone = options.microphone;
  const listeners = new Set<(state: ConversationState) => void>();

  let floor: ParticipantId | null = null;
  let live: LiveLine | null = null;
  let error: string | null = null;
  let transcript: TranscriptEntry[] = [];
  let entrySeq = 0;
  /** Incremented on every floor change so a slow start can tell it has been superseded. */
  let generation = 0;

  const gate = options.gate ?? createMicGate({ onPhaseChange: () => emit() });
  const channels = new Map<ParticipantId, TranslationChannel>();

  function getState(): ConversationState {
    return { floor, phase: gate.phase, live, transcript, error };
  }

  function emit(): void {
    const snapshot = getState();
    for (const listener of listeners) listener(snapshot);
  }

  function setMuted(muted: boolean): void {
    microphone?.setMuted(muted);
  }

  function channelFor(speaker: ParticipantId): TranslationChannel {
    const existing = channels.get(speaker);
    if (existing) return existing;

    const source = requireLanguage(options.participants[speaker].language);
    const target = requireLanguage(options.participants[OTHER[speaker]].language);

    const channel = options.createChannel(
      { speaker, speechLocale: source.speechLocale, targetLanguage: target.code },
      {
        onSpeechStart: () => handleSpeechStart(speaker),
        onRecognizing: (original, translated) => handlePartial(speaker, original, translated),
        onRecognized: (original, translated) => handleFinal(speaker, original, translated),
        onError: (message) => {
          error = message;
          emit();
        },
      },
    );
    channels.set(speaker, channel);
    return channel;
  }

  /** A new utterance begins. Each gets its own measurement, or every line but the first lies. */
  function handleSpeechStart(speaker: ParticipantId): void {
    if (speaker !== floor) return;
    if (!gate.acceptsSpeech(now())) return;
    meter.startUtterance(now());
  }

  function handlePartial(speaker: ParticipantId, original: string, translated: string): void {
    if (speaker !== floor) return;
    if (!gate.acceptsSpeech(now())) return;
    meter.notePartial(now());
    live = { speaker, original, translated };
    emit();
  }

  async function handleFinal(
    speaker: ParticipantId,
    original: string,
    translated: string,
  ): Promise<void> {
    if (speaker !== floor) return;
    if (!gate.acceptsSpeech(now())) {
      // Almost certainly our own synthesized voice coming back through the microphone.
      live = null;
      emit();
      return;
    }
    if (original.trim().length === 0 || translated.trim().length === 0) {
      live = null;
      emit();
      return;
    }

    gate.noteFinalResult(now());
    meter.noteFinal(now());

    const listener = OTHER[speaker];
    const targetLanguage = requireLanguage(options.participants[listener].language);

    entrySeq += 1;
    const entryId = `${speaker}-${entrySeq}`;
    transcript = [
      ...transcript,
      {
        id: entryId,
        speaker,
        sourceLanguage: options.participants[speaker].language,
        targetLanguage: targetLanguage.code,
        original: original.trim(),
        translated: translated.trim(),
        latency: meter.snapshot(),
      },
    ];
    live = null;
    emit();

    await speakTranslation(entryId, translated.trim(), targetLanguage.voice);
  }

  /** Rebuilds one entry by id, so it stays correct even if another was appended meanwhile. */
  function refreshLatency(entryId: string): void {
    const snapshot = meter.snapshot();
    transcript = transcript.map((entry) =>
      entry.id === entryId ? { ...entry, latency: snapshot } : entry,
    );
  }

  async function speakTranslation(entryId: string, text: string, voice: string): Promise<void> {
    // Mute the capture device, not merely the results: audio recorded during playback can
    // finalise after the cooldown and be believed (ADR-0006).
    setMuted(true);
    gate.notePlaybackStarted(now());

    try {
      await options.player.speak(text, voice, {
        onAudioStart: () => {
          meter.noteAudioStart(now());
          refreshLatency(entryId);
          emit();
        },
      });
    } catch (cause) {
      // Autoplay blocking and device errors are expected failure modes, not crashes.
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      gate.notePlaybackEnded(now());
      emit();
      // The gate settles its cooldown lazily, so without this the interface would keep
      // saying "microphone muted" until the user happened to speak again.
      schedule(() => {
        if (gate.phase === "cooldown") gate.acceptsSpeech(now());
        if (floor !== null) setMuted(false);
        emit();
      }, PLAYBACK_TAIL_MS);
    }
  }

  async function stopCurrent(): Promise<void> {
    if (floor === null) return;
    const current = floor;
    options.player.cancel();
    setMuted(false);
    floor = null;
    live = null;
    gate.endTurn();
    emit();
    await channels.get(current)?.stop();
  }

  return {
    getState,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async takeFloor(participant: ParticipantId): Promise<void> {
      if (floor === participant) return;

      generation += 1;
      await stopCurrent();

      const mine = generation;
      error = null;
      live = null;
      floor = participant;
      gate.beginTurn(now());
      meter.startUtterance(now());
      setMuted(false);
      emit();

      try {
        await channelFor(participant).start();
      } catch (cause) {
        // Never leave the interface claiming to hold a microphone that never opened.
        if (generation === mine) {
          floor = null;
          gate.endTurn();
          error = cause instanceof Error ? cause.message : String(cause);
          emit();
        }
        throw cause;
      }

      if (generation !== mine) {
        // Someone took the floor while this one was starting; it is already stale.
        await channels.get(participant)?.stop();
        return;
      }
      emit();
    },

    async releaseFloor(): Promise<void> {
      if (floor === null) return;
      generation += 1;
      await stopCurrent();
      emit();
    },
  };
}

/**
 * The Azure Speech SDK adapter — the only file that knows the SDK exists.
 *
 * Everything above it (conversation.ts, micGate.ts, latency.ts, view.ts) is pure logic
 * tested without a network. This layer is deliberately thin for that reason: it translates
 * SDK events into the seams `conversation.ts` defines, and does nothing else.
 *
 * Three hazards are handled here explicitly, each of which produced a real defect during
 * development:
 *   - `start()` yields before the recognizer exists, so a `stop()` in that window must not
 *     silently no-op and leave an orphaned recognizer holding the microphone.
 *   - `SpeakerAudioDestination.onAudioEnd` does not fire when playback is paused or blocked,
 *     so a promise waiting only on it can hang forever and freeze the whole conversation.
 *   - The microphone must be muted at the track, not merely filtered at the result.
 */
import {
  AudioConfig,
  PropertyId,
  ResultReason,
  SpeakerAudioDestination,
  SpeechConfig,
  SpeechSynthesizer,
  SpeechTranslationConfig,
  TranslationRecognizer,
} from "microsoft-cognitiveservices-speech-sdk";
import type {
  ChannelCallbacks,
  ChannelSpec,
  MicrophoneControl,
  SpeakHooks,
  SpeechPlayer,
  TranslationChannel,
} from "./conversation.js";
import { describeCancellation } from "./speechErrors.js";
import type { SpeechTokenClient } from "./speechToken.js";

/**
 * How much silence ends an utterance. Documented range 100–5000 ms, default 500. Shorter
 * means the translation starts sooner, at the cost of occasionally splitting a sentence
 * that contains a long pause (ADR-0005).
 */
const SEGMENTATION_SILENCE_MS = "350";

/** Upper bound on a single playback, so a stalled audio element cannot wedge the app. */
const PLAYBACK_WATCHDOG_MS = 60_000;

// ── Microphone ────────────────────────────────────────────────────────────────

export interface MicrophoneSource extends MicrophoneControl {
  audioConfig(): Promise<AudioConfig>;
}

/**
 * One shared capture stream for both directions.
 *
 * Muting disables the track rather than stopping it: a disabled track keeps the stream
 * open and delivers silence, so the recognizer stays connected (a stop/start would cost a
 * reconnect on the next turn) but physically cannot hear the translation we are speaking.
 */
export function createMicrophoneSource(): MicrophoneSource {
  let stream: MediaStream | undefined;
  let muted = false;

  async function ensureStream(): Promise<MediaStream> {
    const live = stream?.getAudioTracks().some((track) => track.readyState === "live");
    if (!stream || !live) {
      stream = await navigator.mediaDevices.getUserMedia({
        // Browser AEC is defence in depth behind the mute (ADR-0006).
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      applyMute();
    }
    return stream;
  }

  function applyMute(): void {
    for (const track of stream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  return {
    async audioConfig(): Promise<AudioConfig> {
      return AudioConfig.fromStreamInput(await ensureStream());
    },
    setMuted(next: boolean): void {
      muted = next;
      applyMute();
    },
  };
}

// ── Recognition ───────────────────────────────────────────────────────────────

export function createSpeechChannel(
  spec: ChannelSpec,
  callbacks: ChannelCallbacks,
  tokens: SpeechTokenClient,
  microphone: MicrophoneSource,
): TranslationChannel {
  let recognizer: TranslationRecognizer | undefined;
  let starting: Promise<void> | undefined;
  let disposed = false;

  function attach(active: TranslationRecognizer): void {
    active.speechStartDetected = () => callbacks.onSpeechStart();

    active.recognizing = (_sender, event) => {
      const translated = event.result.translations.get(spec.targetLanguage) ?? "";
      if (event.result.text || translated) {
        callbacks.onRecognizing(event.result.text, translated);
      }
    };

    active.recognized = (_sender, event) => {
      if (event.result.reason !== ResultReason.TranslatedSpeech) return;
      const translated = event.result.translations.get(spec.targetLanguage) ?? "";
      void callbacks.onRecognized(event.result.text, translated);
    };

    active.canceled = (_sender, event) => {
      // A cancellation on a recognizer we have already discarded belongs to a turn that
      // is over; reporting it would surface a stale error against someone else's turn.
      if (recognizer !== active) return;
      if (event.reason !== 0 /* CancellationReason.Error */) return;
      callbacks.onError(describeCancellation(event.errorCode, event.errorDetails));
    };
  }

  async function closeQuietly(active: TranslationRecognizer): Promise<void> {
    await new Promise<void>((resolve) => {
      active.stopContinuousRecognitionAsync(
        () => resolve(),
        () => resolve(),
      );
    });
    try {
      active.close();
    } catch {
      // Already closed.
    }
  }

  async function begin(): Promise<void> {
    const credential = await tokens.get();
    if (disposed) return;

    const audioConfig = await microphone.audioConfig();
    if (disposed) return;

    const config = SpeechTranslationConfig.fromAuthorizationToken(
      credential.token,
      credential.region,
    );
    config.speechRecognitionLanguage = spec.speechLocale;
    config.addTargetLanguage(spec.targetLanguage);
    config.setProperty(PropertyId.Speech_SegmentationSilenceTimeoutMs, SEGMENTATION_SILENCE_MS);

    const active = new TranslationRecognizer(config, audioConfig);
    attach(active);
    recognizer = active;

    try {
      await new Promise<void>((resolve, reject) => {
        active.startContinuousRecognitionAsync(
          () => resolve(),
          (error: string) => reject(new Error(error)),
        );
      });
    } catch (cause) {
      // Leaving a populated `recognizer` here would make every later start() a silent
      // no-op against a microphone that never opened.
      recognizer = undefined;
      await closeQuietly(active);
      throw cause;
    }

    if (disposed) {
      recognizer = undefined;
      await closeQuietly(active);
    }
  }

  return {
    async start(): Promise<void> {
      if (recognizer || starting) return;
      disposed = false;
      starting = begin().finally(() => {
        starting = undefined;
      });
      return starting;
    },

    async stop(): Promise<void> {
      disposed = true;
      // Wait for an in-flight start, or it will finish after us and orphan a recognizer.
      if (starting) await starting.catch(() => undefined);
      const active = recognizer;
      if (!active) return;
      recognizer = undefined;
      await closeQuietly(active);
    },
  };
}

// ── Playback ──────────────────────────────────────────────────────────────────

interface PlaybackSession {
  readonly synthesizer: SpeechSynthesizer;
  readonly destination: SpeakerAudioDestination;
  finish(error?: Error): void;
}

export function createSpeechPlayer(tokens: SpeechTokenClient): SpeechPlayer {
  let current: PlaybackSession | undefined;

  function release(session: PlaybackSession, error?: Error): void {
    if (current === session) current = undefined;
    session.finish(error);
    try {
      session.destination.pause();
      session.destination.close();
    } catch {
      // Already closed.
    }
    try {
      session.synthesizer.close();
    } catch {
      // Already closed.
    }
  }

  return {
    async speak(text: string, voice: string, hooks?: SpeakHooks): Promise<void> {
      if (current) release(current);

      const credential = await tokens.get();
      const config = SpeechConfig.fromAuthorizationToken(credential.token, credential.region);
      config.speechSynthesisVoiceName = voice;

      // A SpeakerAudioDestination rather than the default speaker: it can be paused
      // mid-sentence when the other party takes the floor, and it reports when audio
      // genuinely starts, which is what the latency display needs.
      const destination = new SpeakerAudioDestination();
      const synthesizer = new SpeechSynthesizer(
        config,
        AudioConfig.fromSpeakerOutput(destination),
      );

      let settled = false;
      let resolveDone!: () => void;
      let rejectDone!: (error: Error) => void;
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });

      const session: PlaybackSession = {
        synthesizer,
        destination,
        finish(error?: Error) {
          if (settled) return;
          settled = true;
          if (error) rejectDone(error);
          else resolveDone();
        },
      };
      current = session;

      destination.onAudioStart = () => hooks?.onAudioStart?.();
      destination.onAudioEnd = () => release(session);

      // onAudioEnd does not fire when playback is paused or autoplay-blocked, so it cannot
      // be the only way out — without this the conversation would freeze permanently.
      const watchdog = setTimeout(() => release(session), PLAYBACK_WATCHDOG_MS);

      synthesizer.speakTextAsync(
        text,
        (result) => {
          if (result.reason !== ResultReason.SynthesizingAudioCompleted) {
            release(session, new Error(result.errorDetails || "Could not play the translation."));
          }
        },
        (error: string) => release(session, new Error(error)),
      );

      try {
        await done;
      } finally {
        clearTimeout(watchdog);
      }
    },

    cancel(): void {
      // Resolves the pending promise rather than abandoning it, so the caller's `finally`
      // always runs and the microphone is never left muted.
      if (current) release(current);
    },
  };
}

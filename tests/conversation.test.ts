import { describe, it, expect, vi } from "vitest";
import { createConversation } from "../src/client/conversation.js";
import type { ChannelCallbacks, TranslationChannel } from "../src/client/conversation.js";

/** A recording stand-in for the Speech SDK, so the orchestrator can be tested in isolation. */
function harness(
  options: { speakFails?: boolean; startFails?: boolean; noPrepare?: boolean } = {},
) {
  const started: string[] = [];
  const stopped: string[] = [];
  const spoken: { text: string; voice: string }[] = [];
  const prepared: string[] = [];
  const muteLog: boolean[] = [];
  const scheduled: { fn: () => void; ms: number }[] = [];
  let cancels = 0;
  const callbacks = new Map<string, ChannelCallbacks>();
  const clock = { value: 0 };

  const conversation = createConversation({
    participants: {
      a: { name: "You", language: "en" },
      b: { name: "Them", language: "hi" },
    },
    createChannel: (spec, cb): TranslationChannel => {
      callbacks.set(spec.speaker, cb);
      return {
        start: async () => {
          if (options.startFails) throw new Error("microphone permission denied");
          started.push(spec.speaker);
        },
        stop: async () => {
          stopped.push(spec.speaker);
        },
      };
    },
    player: {
      speak: async (text, voice, hooks) => {
        hooks?.onAudioStart?.();
        if (options.speakFails) throw new Error("audio blocked");
        spoken.push({ text, voice });
      },
      cancel: () => {
        cancels += 1;
      },
      ...(options.noPrepare
        ? {}
        : {
            prepare: (voice: string) => {
              prepared.push(voice);
            },
          }),
    },
    microphone: { setMuted: (muted) => muteLog.push(muted) },
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
    },
    now: () => clock.value,
  });

  return {
    conversation,
    started,
    stopped,
    spoken,
    prepared,
    muteLog,
    clock,
    cancelCount: () => cancels,
    runScheduled: () => {
      const due = [...scheduled];
      scheduled.length = 0;
      for (const task of due) task.fn();
    },
    emit: (speaker: "a" | "b") => {
      const cb = callbacks.get(speaker);
      if (!cb) throw new Error(`no channel for ${speaker}`);
      return cb;
    },
  };
}

describe("conversation", () => {
  it("starts with nobody holding the floor and an empty transcript", () => {
    const h = harness();
    const state = h.conversation.getState();
    expect(state.floor).toBeNull();
    expect(state.transcript).toEqual([]);
    expect(state.phase).toBe("idle");
  });

  it("starts the speaker's channel when they take the floor", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    expect(h.started).toEqual(["a"]);
    expect(h.conversation.getState().floor).toBe("a");
    expect(h.conversation.getState().phase).toBe("listening");
  });

  it("stops the previous speaker when the floor changes", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.conversation.takeFloor("b");
    expect(h.stopped).toEqual(["a"]);
    expect(h.started).toEqual(["a", "b"]);
    expect(h.conversation.getState().floor).toBe("b");
  });

  it("does not restart a channel that already holds the floor", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.conversation.takeFloor("a");
    expect(h.started).toEqual(["a"]);
    expect(h.stopped).toEqual([]);
  });

  it("shows partial text live while the speaker is still talking", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onRecognizing("good morn", "सुप्रभ");
    const live = h.conversation.getState().live;
    expect(live).toEqual({ speaker: "a", original: "good morn", translated: "सुप्रभ" });
    // A partial must never be committed to the transcript — it is still changing.
    expect(h.conversation.getState().transcript).toEqual([]);
  });

  it("commits a final result to the transcript and clears the live line", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onRecognizing("good", "अच्छा");
    await h.emit("a").onRecognized("good morning", "सुप्रभात");
    const state = h.conversation.getState();
    expect(state.live).toBeNull();
    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({
      speaker: "a",
      original: "good morning",
      translated: "सुप्रभात",
      sourceLanguage: "en",
      targetLanguage: "hi",
    });
  });

  it("speaks the translation in the listener's own voice", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.emit("a").onRecognized("good morning", "सुप्रभात");
    // Participant b speaks Hindi, so the Hindi voice must be used.
    expect(h.spoken).toEqual([{ text: "सुप्रभात", voice: "hi-IN-AnanyaNeural" }]);
  });

  it("speaks in the other direction using the other participant's voice", async () => {
    const h = harness();
    await h.conversation.takeFloor("b");
    await h.emit("b").onRecognized("नमस्ते", "hello");
    expect(h.spoken).toEqual([{ text: "hello", voice: "en-US-AvaMultilingualNeural" }]);
  });

  it("ignores an empty final result rather than speaking silence", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.emit("a").onRecognized("   ", "   ");
    expect(h.spoken).toEqual([]);
    expect(h.conversation.getState().transcript).toEqual([]);
  });

  it("suppresses results that arrive while the translation is being spoken", async () => {
    // The anti-feedback rule: audio heard during playback is our own voice.
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.emit("a").onRecognized("first", "पहला");
    expect(h.conversation.getState().transcript).toHaveLength(1);

    // Playback has not finished, so this is the recognizer hearing our own output.
    h.emit("a").onRecognizing("pehla", "पहला");
    await h.emit("a").onRecognized("pehla", "पहला");
    expect(h.conversation.getState().transcript).toHaveLength(1);
    expect(h.conversation.getState().live).toBeNull();
  });

  it("records latency for the turn", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.clock.value = 50;
    h.emit("a").onSpeechStart();
    h.clock.value = 150;
    h.emit("a").onRecognizing("g", "ग");
    h.clock.value = 950;
    await h.emit("a").onRecognized("good", "अच्छा");
    const entry = h.conversation.getState().transcript[0];
    // Measured from when speech actually began, not from when the button was pressed.
    expect(entry?.latency.firstPartialMs).toBe(100);
    expect(entry?.latency.finalMs).toBe(900);
  });

  it("times each utterance separately instead of reusing the first one's numbers", async () => {
    // The recognizer stays running for a whole floor-hold, so one hold yields many
    // utterances. Reusing the first utterance's timings would print invented numbers
    // for every line after the first.
    const h = harness();
    await h.conversation.takeFloor("a");

    h.clock.value = 0;
    h.emit("a").onSpeechStart();
    h.clock.value = 500;
    await h.emit("a").onRecognized("first", "पहला");
    h.runScheduled();

    h.clock.value = 5000;
    h.emit("a").onSpeechStart();
    h.clock.value = 7000;
    await h.emit("a").onRecognized("second", "दूसरा");

    const [one, two] = h.conversation.getState().transcript;
    expect(one?.latency.finalMs).toBe(500);
    expect(two?.latency.finalMs).toBe(2000);
  });

  it("measures audio start from the player actually beginning playback", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onSpeechStart();
    h.clock.value = 1000;
    await h.emit("a").onRecognized("hello", "नमस्ते");
    const entry = h.conversation.getState().transcript[0];
    expect(entry?.latency.audioStartMs).toBe(1000);
  });

  it("mutes the microphone hardware while the translation plays", async () => {
    // Filtering results is not enough: audio captured during playback can finalise after
    // the cooldown and be accepted. The capture itself has to stop.
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onSpeechStart();
    await h.emit("a").onRecognized("hello", "नमस्ते");
    expect(h.muteLog).toContain(true);
    // ...and comes back afterwards.
    h.runScheduled();
    expect(h.muteLog[h.muteLog.length - 1]).toBe(false);
  });

  it("unmutes the microphone when the floor is released mid-playback", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onSpeechStart();
    await h.emit("a").onRecognized("hello", "नमस्ते");
    await h.conversation.releaseFloor();
    expect(h.muteLog[h.muteLog.length - 1]).toBe(false);
  });

  it("rolls the floor back when the channel fails to start", async () => {
    // Otherwise the panel says "Holding the floor" over a microphone that never opened,
    // and clicking again is a no-op because the floor is already claimed.
    const h = harness({ startFails: true });
    await expect(h.conversation.takeFloor("a")).rejects.toThrow(/permission denied/);
    const state = h.conversation.getState();
    expect(state.floor).toBeNull();
    expect(state.phase).toBe("idle");
    expect(state.error).toMatch(/permission denied/);
  });

  it("allows a retry after a failed start", async () => {
    const h = harness({ startFails: true });
    await h.conversation.takeFloor("a").catch(() => undefined);
    // The floor was released, so the same participant can try again.
    await h.conversation.takeFloor("a").catch(() => undefined);
    expect(h.conversation.getState().floor).toBeNull();
  });

  it("warms the listener's voice connection as soon as the floor is taken", async () => {
    // A cold synthesis connection costs ~557ms measured — a fifth of the whole turn.
    // Opening it while the speaker is still talking makes that cost free.
    const h = harness();
    await h.conversation.takeFloor("a");
    expect(h.prepared).toEqual(["hi-IN-AnanyaNeural"]);
  });

  it("warms the other voice when the floor changes direction", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.conversation.takeFloor("b");
    expect(h.prepared).toEqual(["hi-IN-AnanyaNeural", "en-US-AvaMultilingualNeural"]);
  });

  it("re-warms after a turn so the next utterance is fast too", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onSpeechStart();
    await h.emit("a").onRecognized("hello", "नमस्ते");
    h.runScheduled();
    // Once for the floor, once after the turn completes.
    expect(h.prepared.filter((v) => v === "hi-IN-AnanyaNeural").length).toBe(2);
  });

  it("works with a player that cannot warm up", async () => {
    // prepare() is optional on the seam; a player without it must still function.
    const h = harness({ noPrepare: true });
    await h.conversation.takeFloor("a");
    h.emit("a").onSpeechStart();
    await h.emit("a").onRecognized("hello", "नमस्ते");
    expect(h.conversation.getState().transcript).toHaveLength(1);
  });

  it("cancels playback and stops the channel when the floor is released", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.conversation.releaseFloor();
    expect(h.stopped).toEqual(["a"]);
    expect(h.cancelCount()).toBeGreaterThan(0);
    expect(h.conversation.getState().floor).toBeNull();
    expect(h.conversation.getState().phase).toBe("idle");
  });

  it("cancels in-flight playback when the other party interrupts", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.emit("a").onRecognized("hello", "नमस्ते");
    const before = h.cancelCount();
    await h.conversation.takeFloor("b");
    expect(h.cancelCount()).toBeGreaterThan(before);
  });

  it("surfaces a channel error without losing the transcript", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    await h.emit("a").onRecognized("hello", "नमस्ते");
    h.emit("a").onError("network dropped");
    const state = h.conversation.getState();
    expect(state.error).toMatch(/network dropped/);
    expect(state.transcript).toHaveLength(1);
  });

  it("clears a previous error when a new turn starts", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onError("network dropped");
    await h.conversation.takeFloor("b");
    expect(h.conversation.getState().error).toBeNull();
  });

  it("reports an audio failure as an error instead of throwing", async () => {
    const h = harness({ speakFails: true });
    await h.conversation.takeFloor("a");
    await h.emit("a").onRecognized("hello", "नमस्ते");
    const state = h.conversation.getState();
    expect(state.error).toMatch(/audio blocked/i);
    // The translation still belongs in the transcript — only the audio failed.
    expect(state.transcript).toHaveLength(1);
  });

  it("notifies subscribers whenever the state changes", async () => {
    const seen = vi.fn();
    const h = harness();
    h.conversation.subscribe(seen);
    await h.conversation.takeFloor("a");
    expect(seen).toHaveBeenCalled();
  });

  it("gives each transcript entry a distinct id", async () => {
    const h = harness();
    await h.conversation.takeFloor("a");
    h.emit("a").onSpeechStart();
    await h.emit("a").onRecognized("one", "एक");
    // The clock must advance past the playback tail, or the second result is (correctly)
    // suppressed as echo and this assertion runs over a single element.
    h.runScheduled();
    h.clock.value = 5000;
    h.emit("a").onSpeechStart();
    await h.emit("a").onRecognized("two", "दो");
    const ids = h.conversation.getState().transcript.map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

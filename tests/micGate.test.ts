import { describe, it, expect } from "vitest";
import { createMicGate, PLAYBACK_TAIL_MS } from "../src/client/micGate.js";

describe("mic gate", () => {
  it("starts idle and ignores speech until a turn begins", () => {
    const gate = createMicGate();
    expect(gate.phase).toBe("idle");
    expect(gate.acceptsSpeech(0)).toBe(false);
  });

  it("listens once a turn begins", () => {
    const gate = createMicGate();
    gate.beginTurn(0);
    expect(gate.phase).toBe("listening");
    expect(gate.acceptsSpeech(0)).toBe(true);
  });

  it("stops accepting speech while the translation is being spoken", () => {
    // This is the whole point: without it, the microphone hears our own voice,
    // translates it back, speaks that, and loops forever.
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.noteFinalResult(100);
    gate.notePlaybackStarted(200);
    expect(gate.phase).toBe("speaking");
    expect(gate.acceptsSpeech(250)).toBe(false);
  });

  it("stays deaf during the tail after playback ends", () => {
    // Speakers ring out and rooms reverb; resuming instantly re-captures the tail.
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.noteFinalResult(100);
    gate.notePlaybackStarted(200);
    gate.notePlaybackEnded(1000);
    expect(gate.acceptsSpeech(1000 + PLAYBACK_TAIL_MS - 1)).toBe(false);
    expect(gate.phase).toBe("cooldown");
  });

  it("listens again once the tail has elapsed", () => {
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.noteFinalResult(100);
    gate.notePlaybackStarted(200);
    gate.notePlaybackEnded(1000);
    expect(gate.acceptsSpeech(1000 + PLAYBACK_TAIL_MS)).toBe(true);
    expect(gate.phase).toBe("listening");
  });

  it("honours a custom tail", () => {
    const gate = createMicGate({ tailMs: 50 });
    gate.beginTurn(0);
    gate.noteFinalResult(10);
    gate.notePlaybackStarted(20);
    gate.notePlaybackEnded(100);
    expect(gate.acceptsSpeech(149)).toBe(false);
    expect(gate.acceptsSpeech(150)).toBe(true);
  });

  it("suppresses speech between the final result and playback starting", () => {
    // The translation is already being synthesized; anything heard now is not a new turn.
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.noteFinalResult(100);
    expect(gate.phase).toBe("translating");
    expect(gate.acceptsSpeech(150)).toBe(false);
  });

  it("returns to idle when the turn ends", () => {
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.endTurn();
    expect(gate.phase).toBe("idle");
    expect(gate.acceptsSpeech(10)).toBe(false);
  });

  it("ends the turn even while audio is playing", () => {
    // Taking the floor away must always work, or the UI can deadlock.
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.noteFinalResult(10);
    gate.notePlaybackStarted(20);
    gate.endTurn();
    expect(gate.phase).toBe("idle");
  });

  it("ignores playback events that arrive without a turn", () => {
    const gate = createMicGate();
    gate.notePlaybackStarted(0);
    gate.notePlaybackEnded(10);
    expect(gate.phase).toBe("idle");
    expect(gate.acceptsSpeech(9999)).toBe(false);
  });

  it("ignores a final result when not listening", () => {
    const gate = createMicGate();
    gate.noteFinalResult(0);
    expect(gate.phase).toBe("idle");
  });

  it("is idempotent — repeated calls do not advance the state twice", () => {
    const gate = createMicGate();
    gate.beginTurn(0);
    gate.noteFinalResult(10);
    gate.noteFinalResult(20);
    expect(gate.phase).toBe("translating");
    gate.notePlaybackStarted(30);
    gate.notePlaybackStarted(40);
    expect(gate.phase).toBe("speaking");
  });

  it("survives a full turn cycle and can run another", () => {
    const gate = createMicGate({ tailMs: 10 });
    for (let i = 0; i < 3; i++) {
      const base = i * 1000;
      gate.beginTurn(base);
      expect(gate.acceptsSpeech(base)).toBe(true);
      gate.noteFinalResult(base + 100);
      gate.notePlaybackStarted(base + 200);
      expect(gate.acceptsSpeech(base + 250)).toBe(false);
      gate.notePlaybackEnded(base + 300);
      expect(gate.acceptsSpeech(base + 310)).toBe(true);
    }
  });

  it("notifies a listener whenever the phase changes", () => {
    const seen: string[] = [];
    const gate = createMicGate({ tailMs: 10, onPhaseChange: (p) => seen.push(p) });
    gate.beginTurn(0);
    gate.noteFinalResult(10);
    gate.notePlaybackStarted(20);
    gate.notePlaybackEnded(30);
    gate.acceptsSpeech(45);
    expect(seen).toEqual(["listening", "translating", "speaking", "cooldown", "listening"]);
  });

  it("does not notify when nothing changed", () => {
    const seen: string[] = [];
    const gate = createMicGate({ onPhaseChange: (p) => seen.push(p) });
    gate.beginTurn(0);
    gate.beginTurn(0);
    expect(seen).toEqual(["listening"]);
  });
});

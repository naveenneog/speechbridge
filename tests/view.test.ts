import { describe, it, expect } from "vitest";
import { captionFor, formatLatency, statusLabel } from "../src/client/view.js";
import type { ConversationState } from "../src/client/conversation.js";

const base: ConversationState = {
  floor: null,
  phase: "idle",
  live: null,
  transcript: [],
  error: null,
};

function withTranscript(): ConversationState {
  return {
    ...base,
    transcript: [
      {
        id: "a-1",
        speaker: "a",
        sourceLanguage: "en",
        targetLanguage: "hi",
        original: "good morning",
        translated: "सुप्रभात",
        latency: { firstPartialMs: 600, finalMs: 1900, audioStartMs: 2400 },
      },
    ],
  };
}

describe("captionFor", () => {
  it("shows nothing before anyone has spoken", () => {
    expect(captionFor(base, "a")).toEqual({ text: "", pending: false });
    expect(captionFor(base, "b")).toEqual({ text: "", pending: false });
  });

  it("shows the speaker their own words while they talk", () => {
    const state: ConversationState = {
      ...base,
      floor: "a",
      live: { speaker: "a", original: "good morn", translated: "सुप्रभ" },
    };
    expect(captionFor(state, "a")).toEqual({ text: "good morn", pending: true });
  });

  it("shows the listener the translation while the other person talks", () => {
    const state: ConversationState = {
      ...base,
      floor: "a",
      live: { speaker: "a", original: "good morn", translated: "सुप्रभ" },
    };
    expect(captionFor(state, "b")).toEqual({ text: "सुप्रभ", pending: true });
  });

  it("mirrors correctly when the other participant holds the floor", () => {
    const state: ConversationState = {
      ...base,
      floor: "b",
      live: { speaker: "b", original: "नमस्ते", translated: "hello" },
    };
    // Each panel always shows text in that participant's own language.
    expect(captionFor(state, "b")).toEqual({ text: "नमस्ते", pending: true });
    expect(captionFor(state, "a")).toEqual({ text: "hello", pending: true });
  });

  it("falls back to the last settled turn once the live line clears", () => {
    const state = withTranscript();
    expect(captionFor(state, "a")).toEqual({ text: "good morning", pending: false });
    expect(captionFor(state, "b")).toEqual({ text: "सुप्रभात", pending: false });
  });

  it("prefers the live line over the last settled turn", () => {
    const state: ConversationState = {
      ...withTranscript(),
      floor: "a",
      live: { speaker: "a", original: "and also", translated: "और भी" },
    };
    expect(captionFor(state, "a")).toEqual({ text: "and also", pending: true });
  });
});

describe("formatLatency", () => {
  it("summarises the three milestones in seconds", () => {
    expect(formatLatency({ firstPartialMs: 600, finalMs: 1900, audioStartMs: 2400 })).toBe(
      "0.6s · 1.9s · 2.4s",
    );
  });

  it("shows a dash for milestones that never happened", () => {
    expect(formatLatency({ firstPartialMs: 600 })).toBe("0.6s · — · —");
  });

  it("returns dashes when nothing was measured", () => {
    expect(formatLatency({})).toBe("— · — · —");
  });

  it("rounds to one decimal place", () => {
    expect(formatLatency({ firstPartialMs: 1549 })).toBe("1.5s · — · —");
  });

  it("handles a zero measurement without printing a negative", () => {
    expect(formatLatency({ firstPartialMs: 0 })).toBe("0.0s · — · —");
  });
});

describe("statusLabel", () => {
  it("describes each phase in words a user understands", () => {
    expect(statusLabel("idle")).toMatch(/ready|waiting/i);
    expect(statusLabel("listening")).toMatch(/listening/i);
    expect(statusLabel("translating")).toMatch(/translat/i);
    expect(statusLabel("speaking")).toMatch(/speaking|muted/i);
    expect(statusLabel("cooldown")).toMatch(/speaking|muted/i);
  });

  it("tells an idle user what to actually do", () => {
    // "Ready" alone leaves a first-time user staring at the screen.
    expect(statusLabel("idle")).toMatch(/hold/i);
  });

  it("never returns an empty label", () => {
    for (const phase of ["idle", "listening", "translating", "speaking", "cooldown"] as const) {
      expect(statusLabel(phase).length).toBeGreaterThan(0);
    }
  });
});

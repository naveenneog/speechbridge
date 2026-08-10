import { describe, it, expect } from "vitest";
import { createLatencyMeter } from "../src/client/latency.js";

describe("latency meter", () => {
  it("reports nothing before an utterance starts", () => {
    const meter = createLatencyMeter();
    expect(meter.snapshot()).toEqual({});
  });

  it("measures each milestone as an offset from the start of speech", () => {
    const meter = createLatencyMeter();
    meter.startUtterance(1000);
    meter.notePartial(1600);
    meter.noteFinal(2900);
    meter.noteAudioStart(3400);
    expect(meter.snapshot()).toEqual({
      firstPartialMs: 600,
      finalMs: 1900,
      audioStartMs: 2400,
    });
  });

  it("keeps the first partial, not the latest", () => {
    // "How quickly did text appear?" is the question; later partials do not change it.
    const meter = createLatencyMeter();
    meter.startUtterance(0);
    meter.notePartial(500);
    meter.notePartial(900);
    meter.notePartial(1400);
    expect(meter.snapshot().firstPartialMs).toBe(500);
  });

  it("omits milestones that have not happened yet", () => {
    const meter = createLatencyMeter();
    meter.startUtterance(0);
    meter.notePartial(300);
    const snap = meter.snapshot();
    expect(snap.firstPartialMs).toBe(300);
    expect(snap.finalMs).toBeUndefined();
    expect(snap.audioStartMs).toBeUndefined();
  });

  it("starts a fresh measurement for the next utterance", () => {
    const meter = createLatencyMeter();
    meter.startUtterance(0);
    meter.notePartial(300);
    meter.noteFinal(900);
    meter.startUtterance(5000);
    expect(meter.snapshot()).toEqual({});
    meter.notePartial(5200);
    expect(meter.snapshot()).toEqual({ firstPartialMs: 200 });
  });

  it("ignores milestones recorded before any utterance began", () => {
    const meter = createLatencyMeter();
    meter.notePartial(100);
    meter.noteFinal(200);
    meter.noteAudioStart(300);
    expect(meter.snapshot()).toEqual({});
  });

  it("never reports a negative duration when the clock jumps backwards", () => {
    // Monotonic clocks are not guaranteed across every browser and device.
    const meter = createLatencyMeter();
    meter.startUtterance(1000);
    meter.notePartial(900);
    expect(meter.snapshot().firstPartialMs).toBe(0);
  });

  it("records zero when a milestone lands on the start instant", () => {
    const meter = createLatencyMeter();
    meter.startUtterance(1000);
    meter.notePartial(1000);
    expect(meter.snapshot().firstPartialMs).toBe(0);
  });

  it("keeps the first final rather than a later correction", () => {
    const meter = createLatencyMeter();
    meter.startUtterance(0);
    meter.noteFinal(1000);
    meter.noteFinal(2000);
    expect(meter.snapshot().finalMs).toBe(1000);
  });

  it("keeps the first audio start across a multi-part playback", () => {
    const meter = createLatencyMeter();
    meter.startUtterance(0);
    meter.noteAudioStart(1500);
    meter.noteAudioStart(1800);
    expect(meter.snapshot().audioStartMs).toBe(1500);
  });
});

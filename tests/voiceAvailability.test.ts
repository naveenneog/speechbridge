import { describe, it, expect } from "vitest";
import {
  auditVoiceAvailability,
  MIN_AUDIO_BYTES,
  type SynthesisProbe,
} from "../src/shared/voiceAvailability.js";

const language = (code: string, voice: string) => ({ code, voice });

const listed = (...voices: string[]) => new Set(voices);
const targets = (...codes: string[]) => new Set(codes);
const probes = (entries: Record<string, SynthesisProbe>) =>
  new Map<string, SynthesisProbe>(Object.entries(entries));

const ok = (bytes = 50_000): SynthesisProbe => ({ status: "ok", bytes });
const failed = (httpStatus: number): SynthesisProbe => ({ status: "failed", httpStatus });

describe("voice availability audit", () => {
  it("passes a voice that is both listed and proven by synthesis", () => {
    const problems = auditVoiceAvailability([language("en", "en-US-AvaMultilingualNeural")], {
      listedVoices: listed("en-US-AvaMultilingualNeural"),
      translationTargets: targets("en"),
      probes: probes({ "en-US-AvaMultilingualNeural": ok() }),
    });

    expect(problems).toEqual([]);
  });

  it("reports a voice the region does not offer at all", () => {
    const problems = auditVoiceAvailability([language("en", "en-US-GhostNeural")], {
      listedVoices: listed("en-US-AvaMultilingualNeural"),
      translationTargets: targets("en"),
      probes: probes({ "en-US-GhostNeural": failed(400) }),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/en-US-GhostNeural/);
    expect(problems[0]).toMatch(/not offered/i);
  });

  // The reason this module exists. On 2026-08-18 the eastus2 voice list advertised
  // en-IN-Diya:DragonHDLatestNeural, but every synthesis attempt returned a bare 503
  // (0 ok / 8 attempts), while the same voice synthesised 4/4 in centralindia. A check
  // that only asks the catalogue "does this voice exist?" calls that voice healthy.
  it("reports a voice the catalogue lists but the service will not synthesise", () => {
    const problems = auditVoiceAvailability([language("en", "en-IN-Diya:DragonHDLatestNeural")], {
      listedVoices: listed("en-IN-Diya:DragonHDLatestNeural"),
      translationTargets: targets("en"),
      probes: probes({ "en-IN-Diya:DragonHDLatestNeural": failed(503) }),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/en-IN-Diya:DragonHDLatestNeural/);
    expect(problems[0]).toMatch(/listed .* will not synthesise|503/i);
  });

  it("refuses to call a voice verified when nothing was actually synthesised", () => {
    // An unprobed voice is unproven. Silence must not read as success, which is exactly
    // how the previous list-only check granted false confidence.
    const problems = auditVoiceAvailability([language("en", "en-US-AvaMultilingualNeural")], {
      listedVoices: listed("en-US-AvaMultilingualNeural"),
      translationTargets: targets("en"),
      probes: probes({}),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not proven|unverified|no synthesis/i);
  });

  it("rejects an empty or truncated audio body as proof of availability", () => {
    // A 200 with no audio is not a working voice.
    const problems = auditVoiceAvailability([language("en", "en-US-AvaMultilingualNeural")], {
      listedVoices: listed("en-US-AvaMultilingualNeural"),
      translationTargets: targets("en"),
      probes: probes({ "en-US-AvaMultilingualNeural": ok(MIN_AUDIO_BYTES - 1) }),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/too small|truncated|not proven/i);
  });

  it("still reports an invalid translation target code", () => {
    const problems = auditVoiceAvailability([language("zz", "en-US-AvaMultilingualNeural")], {
      listedVoices: listed("en-US-AvaMultilingualNeural"),
      translationTargets: targets("en"),
      probes: probes({ "en-US-AvaMultilingualNeural": ok() }),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/zz/);
  });

  it("reports every failing language rather than stopping at the first", () => {
    const problems = auditVoiceAvailability(
      [language("en", "en-US-AvaMultilingualNeural"), language("hi", "hi-IN-AnanyaNeural")],
      {
        listedVoices: listed("en-US-AvaMultilingualNeural", "hi-IN-AnanyaNeural"),
        translationTargets: targets("en", "hi"),
        probes: probes({
          "en-US-AvaMultilingualNeural": failed(503),
          "hi-IN-AnanyaNeural": failed(503),
        }),
      },
    );

    expect(problems).toHaveLength(2);
  });

  it("treats a voice as unavailable independently of whether other voices work", () => {
    // Guards against a bug where one healthy voice masks a broken one.
    const problems = auditVoiceAvailability(
      [language("en", "en-US-AvaMultilingualNeural"), language("hi", "hi-IN-AnanyaNeural")],
      {
        listedVoices: listed("en-US-AvaMultilingualNeural", "hi-IN-AnanyaNeural"),
        translationTargets: targets("en", "hi"),
        probes: probes({
          "en-US-AvaMultilingualNeural": ok(),
          "hi-IN-AnanyaNeural": failed(503),
        }),
      },
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/hi-IN-AnanyaNeural/);
  });
});

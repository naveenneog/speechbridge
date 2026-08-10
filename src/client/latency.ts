/**
 * Measures how long each stage of a turn actually took.
 *
 * "Near-realtime" is a claim, and a demo that makes it should show its working. Three
 * milestones matter to a watching human:
 *
 *   firstPartialMs — when words first appeared on screen (does it feel alive?)
 *   finalMs        — when the translation was settled (governed by segmentation silence)
 *   audioStartMs   — when the other person actually started hearing it
 *
 * All are offsets from the moment the speaker began. Clock-free by design: the caller
 * supplies `now`, so tests never depend on wall-clock timing.
 */

export interface LatencySnapshot {
  readonly firstPartialMs?: number;
  readonly finalMs?: number;
  readonly audioStartMs?: number;
}

export interface LatencyMeter {
  startUtterance(now: number): void;
  notePartial(now: number): void;
  noteFinal(now: number): void;
  noteAudioStart(now: number): void;
  snapshot(): LatencySnapshot;
}

export function createLatencyMeter(): LatencyMeter {
  let startedAt: number | undefined;
  let firstPartialMs: number | undefined;
  let finalMs: number | undefined;
  let audioStartMs: number | undefined;

  /** Guards against a non-monotonic clock reporting a negative duration. */
  function offsetFromStart(now: number): number | undefined {
    if (startedAt === undefined) return undefined;
    return Math.max(0, now - startedAt);
  }

  return {
    startUtterance(now: number): void {
      startedAt = now;
      firstPartialMs = undefined;
      finalMs = undefined;
      audioStartMs = undefined;
    },

    notePartial(now: number): void {
      // Only the first partial answers "how quickly did this come alive?".
      if (firstPartialMs !== undefined) return;
      firstPartialMs = offsetFromStart(now);
    },

    noteFinal(now: number): void {
      if (finalMs !== undefined) return;
      finalMs = offsetFromStart(now);
    },

    noteAudioStart(now: number): void {
      if (audioStartMs !== undefined) return;
      audioStartMs = offsetFromStart(now);
    },

    snapshot(): LatencySnapshot {
      const snap: {
        firstPartialMs?: number;
        finalMs?: number;
        audioStartMs?: number;
      } = {};
      if (firstPartialMs !== undefined) snap.firstPartialMs = firstPartialMs;
      if (finalMs !== undefined) snap.finalMs = finalMs;
      if (audioStartMs !== undefined) snap.audioStartMs = audioStartMs;
      return snap;
    },
  };
}

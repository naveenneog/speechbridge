# ADR-0009: Pre-warm the synthesis connection instead of switching to fused synthesis

- **Status:** Accepted
- **Relates to:** ADR-0005 (which asked for exactly this measurement)
- **Date:** 2026-08-10

## Context

End-to-end measurement showed the speech-synthesis leg dominated the turn: caption at 0.2 s and
translation settled at 0.3–0.4 s, but the listener did not hear anything until 1.2–2.4 s. Roughly
75–85% of the wait was synthesis.

ADR-0005 chose to chain an explicit `SpeechSynthesizer` rather than use the recognizer's built-in
`Synthesizing` event, and committed to revisiting that "if the measured synthesis leg dominates
total latency". It did, so `scripts/bench-synthesis.mjs` benchmarked three strategies against
live Azure over 5 trials each, measuring time from the start of the audio push to the first byte
of translated audio:

| Strategy | Median | vs chained |
|---|---|---|
| `chained` (what we shipped) | 2775 ms | — |
| `chained` + pre-opened connection | 2218 ms | **−557 ms (20%)** |
| `fused` (recognizer's own `voiceName` + `synthesizing`) | 2032 ms | −743 ms (27%) |

The interesting finding is the middle row. Most of the chained path's disadvantage was **not the
extra round trip** — it was paying for a cold TLS + WebSocket handshake at the worst possible
moment, immediately after the speaker stopped talking. Pre-opening the connection recovers 75% of
the total available win.

## Options considered

1. **Switch to fused synthesis.** The fastest option in the benchmark, but it changes the shape of
   the system rather than a detail: audio would arrive as chunks on the recognizer's
   `synthesizing` event instead of through the `SpeechPlayer` seam, so playback, barge-in
   cancellation, the microphone gate and the latency meter would all have to be rebuilt around a
   streaming source. The architecture review already identified that as the P-10 restructure. It
   also permanently forecloses more than one target language, and would risk the echo-control
   correctness that ADR-0008 had just established. A further 186 ms does not buy that.
2. **Accept the latency.** Rejected: it is the single largest component of a demo whose entire
   claim is being near-realtime.
3. **Keep the chained architecture and pre-warm the connection.** Chosen.

## Decision

`SpeechPlayer` gains an optional `prepare(voice)`. The conversation calls it at two moments when
the listener's voice is already known and the user is not waiting:

- when a participant takes the floor — the connection opens while they are still speaking, so it
  costs nothing;
- after each spoken translation, so a second utterance in the same turn is warm too.

The Azure implementation builds the synthesizer ahead of time and calls
`Connection.fromSynthesizer(...).openConnection()`. `speak()` uses the warm instance when the
voice matches and falls back to building one otherwise. `prepare` is optional on the seam and its
failures are swallowed: warming is an optimisation and must never break a turn.

## Consequences

Measured in Chromium against live Azure, before and after, on the same fixtures:

| Milestone | Before | After |
|---|---|---|
| First caption | 0.2 s | 0.2 s |
| Translation settled | 0.4–0.5 s | 0.2–0.5 s |
| **Listener hears it** | **1.2–2.4 s** | **0.4–0.7 s** |

The synthesis leg fell from roughly 800–2000 ms to about 200 ms — a larger gain than the Node
benchmark predicted, because in the browser a warm connection and progressive playback compound.

- **Good:** the dominant cost is gone, with no change to the architecture, the seams, or the
  echo-control logic.
- **Good:** `bench-synthesis.mjs` stays in the repo, so the question can be re-asked cheaply if
  Azure's characteristics change.
- **Cost:** one extra open WebSocket per turn, held during speech. Negligible for two parties;
  it would need thought at conference scale.
- **Cost:** a warm synthesizer built for a voice the user then changes is discarded. Bounded, and
  `prepare` is idempotent per voice.
- **Not taken:** fused synthesis remains ~186 ms faster in isolation. If the P-10 restructure
  happens for other reasons, re-measure and reconsider — ADR-0005's chained decision now rests on
  this measurement rather than on the reasoning it originally gave.

## How we would know this was wrong

If measured time-to-heard drifts back above ~1 s with the warm path in use, the connection is not
actually being reused — check that `prepare()`'s voice matches the voice `speak()` is called with,
since a mismatch silently falls back to building a cold synthesizer.

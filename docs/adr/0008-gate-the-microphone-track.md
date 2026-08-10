# ADR-0008: Gate the microphone track, not the recognition results

- **Status:** Accepted
- **Supersedes the mechanism in:** ADR-0006 (the decision to prevent feedback stands; how it is
  done changes)
- **Date:** 2026-08-10

## Context

ADR-0006 chose to prevent audio feedback by suppressing recognition *results* while our own
translation was being spoken, and claimed the feedback loop was thereby "structurally
impossible". The review council showed that claim is false.

The flaw: `acceptsSpeech(now)` is evaluated when an SDK callback **arrives**, not when the audio
it describes was **captured**. The recognizer keeps receiving microphone audio throughout
playback. So:

- Audio captured *during* playback (our own synthesized voice) can finalise *after* the 400 ms
  cooldown has elapsed — and is then accepted as a new utterance. The loop we set out to prevent
  is still reachable.
- Symmetrically, genuine speech captured *before* playback can finalise *during* playback and be
  discarded, losing a real turn.

ADR-0006 also stated that browser AEC was requested as defence in depth. It was not:
`AudioConfig.fromDefaultMicrophoneInput()` requests no constraints at all, so
`echoCancellation` was never asked for.

## Decision

Gate the capture device rather than the result stream.

- A single `MediaStream` is acquired once via
  `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`
  and shared by both directions, so the AEC that ADR-0006 claimed is now genuinely requested.
- Muting sets `track.enabled = false`. A disabled track keeps the stream open and delivers
  silence, so the recognizer stays connected — stopping it would cost a reconnect on the next
  turn, which was ADR-0006's original and still-valid reason for not tearing the recognizer down.
- The conversation mutes at playback start and unmutes after the tail, via a `MicrophoneControl`
  seam so the behaviour is unit-testable.
- Result-level suppression is **kept** as a second layer. It is no longer the primary defence,
  but it still discards anything that slips through the boundary instants.

## Consequences

- **Good:** audio produced during playback is not merely disbelieved, it is never captured. The
  timing hole closes because there is no in-flight audio to finalise late.
- **Good:** the claim in the charter is now true rather than aspirational, and it is tested
  (`tests/conversation.test.ts` asserts the microphone is muted during playback and restored
  after, including when the floor is released mid-playback).
- **Cost:** the demo now needs microphone permission at session start rather than at first use,
  because the shared stream is acquired up front.
- **Cost:** a disabled track still burns a little CPU in the SDK's audio pipeline, versus stopping
  the stream entirely. Negligible, and worth it to avoid the reconnect.
- **Unchanged:** a party still cannot interrupt while the translation is being spoken. Real
  barge-in requires an engine with genuine full-duplex AEC (Voice Live), which stays on the roadmap.

## How we would know this was wrong

If feedback is still observed on open speakers, the mute is not being applied to the stream the
recognizer actually reads — check that `AudioConfig.fromStreamInput` received the same
`MediaStream` object whose tracks are being disabled, rather than a clone.

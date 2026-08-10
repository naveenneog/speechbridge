# ADR-0006: Gate the microphone during playback instead of relying on echo cancellation

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The demo speaks its output through the same machine that is listening. On open speakers, the
synthesized translation is audible to the microphone. Without a countermeasure the system will
recognize its own voice, translate it back, speak *that*, and loop — the classic interpreter
feedback failure, and one that is embarrassing in a live demo.

`TranslationRecognizer` has **no built-in echo cancellation**. (The Voice Live API does — it
explicitly "prevents the agent from picking up its own responses" — which is one of the reasons it
is on the roadmap as an alternative engine.)

Browsers offer `getUserMedia({ audio: { echoCancellation: true } })`, but it is a best-effort
hint: quality varies by browser, OS and device, and it is designed for full-duplex calls rather
than for suppressing a loud local TTS voice.

## Options considered

1. **Rely on browser AEC alone.** Rejected: unpredictable across machines, and the failure mode is
   a runaway loop in front of an audience.
2. **Require headphones.** Sound advice, but not a mechanism — it fails open if ignored.
3. **Gate recognition in software while playback is active.** Chosen, with 1 and 2 as defence in
   depth.

## Decision

A small explicit state machine owns the microphone's relationship to playback:

```
idle ──speech starts──> listening ──final result──> translating ──audio plays──> speaking
  ^                                                                                 │
  └──────────────────────── playback ends (+ tail) ─────────────────────────────────┘
```

While in `speaking`, recognition results are **suppressed** rather than the recognizer being torn
down (stopping and restarting the recognizer costs a reconnect, which would show up as latency on
the next turn). A short tail after playback ends absorbs speaker ring-out and room reverb before
listening resumes.

Browser AEC is requested as well, and the README recommends a headset.

The gate is a pure state machine with no timers of its own — the caller injects the clock — so it
is fully unit-testable, which matters because this is the component whose failure is most visible.

## Consequences

- **Good:** the feedback loop is structurally impossible while the gate is engaged, regardless of
  hardware.
- **Good:** the user can see it. The UI shows "listening" vs "muted while speaking", so the system
  never appears to have silently stopped working.
- **Cost:** a party genuinely cannot interrupt while the translation is being spoken; their speech
  during that window is dropped. This is the correct trade for a two-party demo and matches how
  human consecutive interpretation works, but it is a real limitation and the roadmap notes
  barge-in as a reason to evaluate the Realtime/Voice Live engines.
- **Cost:** the tail adds a small fixed delay before the floor can change.

## How we would know this was wrong

If users repeatedly try to talk over the translation and are dropped, the tail is too long or
barge-in matters more than loop-safety for this audience. The mitigation is an engine with real
AEC (Voice Live), not a shorter tail.

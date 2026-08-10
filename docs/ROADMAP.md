# Roadmap

## Now — M1: A working bidirectional interpreter (target: 2026-08-10)

- [x] P-0  Project scaffold, charter, ledger, verified toolchain
- [x] P-1  Shared contracts + language catalog with verified voices
      Given a supported language code, when the catalog is asked for its voice,
      then it returns a voice `shortName` that exists in the live service.
      Unknowns: U-10 (closed). Detector: `npm run verify:voices`.
- [x] P-2  Token broker: Entra → short-lived Speech STS token, cached and refreshed
      Given a valid credential, when `/api/speech-token` is called twice inside the cache
      window, then Azure is contacted once and both callers get the same unexpired token.
      Unknowns: U-1, U-2, U-3, U-4 (all closed).
- [x] P-3  Mic gate: never translate our own synthesized speech
      Given playback is active, when recognition produces a result, then it is suppressed;
      and when playback ends, then recognition resumes.
      Unknowns: U-9 (guarded by tests/micGate.test.ts).
- [x] P-4  Latency metering: measurable, displayable timings per utterance
      Given an utterance, when first partial / final / audio-start occur, then each is
      recorded as a millisecond offset from speech start.
- [x] P-5  Translation session: recognizer lifecycle, partials, finals, spoken output
- [x] P-6  The interface: two-channel conversation console
- [x] P-7  Council review, security hardening, README  ← the council found four real defects
      (lifecycle race, never-settling playback promise, per-utterance latency, LAN exposure);
      all fixed with regression tests. See ADR-0008.

## Next — M2: What the council raised and we did not do yet

- [ ] P-8  Push a refreshed token onto a running recognizer (U-13)
      Today a single held floor is bounded by the ~10-minute token life. Given a floor held
      past expiry, when the token refreshes, then recognition continues uninterrupted.
- [ ] P-9  Benchmark fused synthesis against the chained synthesizer
      ADR-0005 chose an explicitly chained `SpeechSynthesizer`. The SDK does support
      `SpeechTranslationConfig.voiceName` with a `synthesizing` event for a single target,
      so the extra round trip should be measured, not assumed. The latency meter is the
      instrument; if fused wins, supersede ADR-0005.
- [ ] P-10 Separate input, output and connection state from the echo-suppression gate
      `conversation.ts` currently derives its whole user-visible phase from `micGate`, which
      cannot represent an engine that listens and speaks at once.
- [ ] P-11 Content-Security-Policy and `Permissions-Policy` on the served client
- [ ] P-12 Conversation transcript export (copy / download)
- [ ] P-13 Device picker (choose microphone and output device)
- [ ] P-14 Surface an empty translation result instead of dropping it silently

## Later (ideas, not commitments)

- Auto speaker detection via open-range multilingual translation (see U-12 — costs live captions)
- Azure OpenAI `gpt-realtime-translate` over WebRTC as a lower-latency second engine
- Voice Live API path for built-in echo cancellation and barge-in
- Personal-voice output so the translation keeps the speaker's timbre (needs MS approval)

## Out of scope (decided, with reasons)

- **Multi-party conferencing** — needs media routing (SFU) and per-participant streams; a different
  product, not a bigger version of this one.
- **Storing audio/transcripts** — privacy burden with no demo value. Nothing is persisted.
- **Our own key vault / secret rotation** — there are no keys to store (see U-1).

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
- [ ] P-3  Mic gate: never translate our own synthesized speech  ← ACTIVE
      Given playback is active, when recognition produces a result, then it is suppressed;
      and when playback ends, then recognition resumes.
      Unknowns: U-9.
- [ ] P-4  Latency metering: measurable, displayable timings per utterance
      Given an utterance, when first partial / final / audio-start occur, then each is
      recorded as a millisecond offset from speech start.
- [ ] P-5  Translation session: recognizer lifecycle, partials, finals, spoken output
      Given a speaker turn, when audio is spoken, then partial captions stream, a final
      translation is produced, and the translated audio plays in the listener's language.
      Unknowns: U-5, U-6, U-7, U-8.
- [ ] P-6  The interface: two-channel conversation console
      Given a running session, when either party speaks, then the UI shows who holds the
      floor, live captions in both languages, and the measured latency.
      Unknowns: U-11.
- [ ] P-7  End-to-end verification against live Azure + README

## Next — M2: Fit and finish

- [ ] P-8  Conversation transcript export (copy / download)
- [ ] P-9  Device picker (choose mic and output device)
- [ ] P-10 Reconnect and token-expiry recovery under a dropped network

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

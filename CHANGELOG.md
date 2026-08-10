# Changelog

All notable changes to SpeechBridge. Written for a user, not a compiler.
Format: [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- Project foundation: charter, roadmap, unknowns register, and a verified toolchain
  (TypeScript 5.9.3, Vite 8.2.0, Vitest 4.1.10, Express 5.2.1, Speech SDK 1.51.0). (P-0)
- 16 languages to translate between — English, Hindi, Kannada, Tamil, Telugu, Marathi,
  Spanish, French, German, Italian, Portuguese, Japanese, Korean, Chinese, Russian and
  Arabic — each with a neural voice verified against the live service. (P-1)
- `npm run verify:voices` re-checks every voice and translation code against Azure, so the
  catalog cannot silently drift out of date. (P-1)
- A token broker that mints short-lived, Speech-scoped credentials for the browser, so no
  API key and no broad Entra token ever reaches the client. Concurrent requests share one
  exchange, and tokens refresh automatically at 80% of their life. (P-2)
- The server now refuses to start on a misconfigured endpoint, explaining that Entra
  authentication needs the resource's custom subdomain. (P-2)

### Fixed
- The server exited silently when its port was already taken, leaving a confusing 404 from
  whatever else owned the port. It now names the clash and tells you to change `PORT`. (P-2)

### Added (continued)
- The microphone is now deaf while the translation is being spoken, so the app can never
  hear its own voice and translate it in an endless loop. The interface shows which state
  it is in, so it never looks like it has silently stopped listening. (P-3)
- Per-turn latency measurement — time to first caption, time to the settled translation,
  and time until the other person hears it. (P-4)
- The conversation itself: hold the floor, speak, and the other person hears you in their
  language. Live captions in both languages while you talk, an interleaved transcript, and
  the measured latency of every turn. Keyboard throughout — `1`, `2` and `Esc`. (P-5, P-6)
- 16 languages selectable per side, each caption rendered with its own script direction so
  Arabic reads correctly. (P-6)

### Fixed (from the review council)
- The microphone is now muted at the device during playback, not merely ignored. Audio
  captured while the translation played could previously arrive late and be treated as a
  new sentence — the feedback loop the mute was supposed to prevent. (ADR-0008)
- Latency is measured per sentence and from when speech actually starts. Previously every
  line after the first repeated the first line's numbers, and the "heard" figure was
  recorded before any sound had been produced.
- Releasing the floor while the app was still connecting no longer leaves an invisible
  microphone recording in the background.
- A blocked or interrupted translation no longer freezes the app in "speaking" forever.
- If the microphone fails to open, the app says so and lets you try again, instead of
  claiming you hold the floor over a dead microphone.

### Performance
- **Translations are now heard about three times sooner** — roughly 0.5 s after you stop
  speaking, down from 1.2–2.4 s. The synthesis connection is opened while you are still
  talking, so the translation no longer waits for a handshake at the exact moment you
  finish. (P-9, ADR-0009)

### Security
- The token endpoint now listens on loopback only. It previously bound every network
  interface, so anyone on the same network could mint Azure Speech tokens against this
  subscription — while the console said "localhost".
- Requests are rejected unless they genuinely come from this machine, closing a DNS
  rebinding path to the credential.
- A mistyped `SPEECH_ENDPOINT` can no longer send the Entra token somewhere unintended:
  only `https://…cognitiveservices.azure.com` is accepted.

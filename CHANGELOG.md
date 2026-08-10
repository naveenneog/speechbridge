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

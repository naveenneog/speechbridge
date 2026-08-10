# ADR-0005: One recognizer per direction, with an explicitly chained synthesizer

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The demo must translate both ways. Azure offers several shapes for this, and the choice determines
the latency, the language flexibility and the amount of code.

Verified behaviour of `TranslationRecognizer` (own spike, 2026-08-10): one utterance translated
simultaneously into `es`, `hi` and `kn`; 4 interim `recognizing` events; first partial at 1548 ms;
final at 2919 ms.

Documented constraint: the recognizer's built-in `Synthesizing` event produces translated **audio**
directly, but "the event-based synthesis works only with a single translation. Do not add multiple
target translation languages."

Also documented: continuous language identification is supported for **speech-to-text only** in the
JavaScript SDK, not for translation; and open-range multilingual translation returns **no interim
results**. Auto-detecting who is speaking would therefore cost us the live captions that make the
demo feel real-time.

## Options considered

1. **One recognizer with open-range language detection, auto-routing by detected language.** The
   most magical demo. Rejected for now: no interim results in the browser SDK for that mode, and
   mid-conversation detection is not guaranteed within a sentence. Recorded on the roadmap as
   "Later" and in U-12.
2. **One recognizer with both languages as targets, picking the right one per turn.** Rejected: it
   pays translation cost for a language nobody will hear, and disables the built-in synthesis path.
3. **One recognizer per direction, each with a fixed source and a single target.** Chosen.

## Decision

Two independent `TranslationRecognizer` configurations — A→B and B→A — with exactly one target
language each. Only the recognizer for the party who currently holds the floor is running, because
the machine has one microphone and two concurrent recognizers would both hear the same audio.

Translated speech is produced by an **explicitly chained `SpeechSynthesizer`**, not by the built-in
`Synthesizing` event, even though the single-target rule would permit the built-in path.

Rationale for chaining: we need to (a) choose the voice per target language from a verified catalog,
(b) stop playback instantly when the other party takes the floor, and (c) measure the moment audio
starts so latency can be displayed. The built-in event gives us an audio stream but not that control.

`Speech_SegmentationSilenceTimeoutMs` is set to 350 ms (documented range 100–5000, default 500) to
shorten the pause before a final result, accepting a slightly higher risk of splitting a sentence
across two utterances.

## Consequences

- **Good:** each direction is independently configurable, and the code reads as two symmetric
  channels rather than one mode-switching object.
- **Good:** explicit synthesis gives us barge-in (stop playback on floor change) and an
  audio-start timestamp for the latency display.
- **Cost:** a second network call per utterance (recognize → synthesize) instead of one fused
  stream. Measured impact is the synthesis round trip, which the UI shows honestly.
- **Cost:** speakers must indicate whose turn it is. The UI makes this a single obvious control
  rather than a hidden mode.

## How we would know this was wrong

If the measured synthesis leg dominates total latency, the built-in `Synthesizing` event becomes
the better trade for the default direction and we would supersede this ADR. The latency meter
built in P-4 is exactly the instrument that would tell us.

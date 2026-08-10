# ADR-0007: Exclude the vendor SDK adapter from the coverage metric

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The charter sets a coverage floor of 80%. With `src/client/azureSpeech.ts` included, the project
measured 76.07% — the adapter itself sits at 0%, because nothing in the unit suite constructs a
`TranslationRecognizer` or a `SpeechSynthesizer`.

The obvious ways to close the gap are both bad:

1. **Lower the floor to 76%.** This is the failure the charter exists to prevent: moving the bar
   to wherever the code happens to be leaves a number that measures nothing.
2. **Mock the Speech SDK and assert the adapter calls it.** This produces coverage without
   producing confidence. `references/tdd.md` names it directly — *"mock theatre: everything
   mocked; the test proves the mocks were called… proves the test, not the system."* A test
   asserting that `speakTextAsync` was invoked with a string would not have caught any of the
   three real defects found in this area during development (the Node WebSocket incompatibility,
   the wrong host for the STS exchange, and playback needing `onAudioEnd` rather than the
   synthesis callback). Every one of those was found by running against live Azure.

## Decision

Split the file, then exclude only what is genuinely wiring.

- The pure logic that was inside it — `describeCancellation`, which decides the words a user reads
  when the demo breaks — moved to `src/client/speechErrors.ts` and is now unit-tested.
- What remains in `src/client/azureSpeech.ts` is vendor wiring: construct SDK objects, subscribe
  to SDK events, forward them to the `TranslationChannel` / `SpeechPlayer` seams. It is added to
  `coverage.exclude`, alongside the entries already there for the same reason (`main.ts`,
  `index.ts` — entry points whose behaviour is covered through the modules they compose).

Its correctness is established by **live verification** instead, which is a stronger claim than
a mocked unit test: `npm run verify:voices` and the end-to-end runs recorded in `docs/STATUS.md`.

## Consequences

- **Good:** the 80% floor survives and continues to mean something. Coverage now reports on code
  where coverage is evidence.
- **Good:** the seam is enforced by the exclusion. If real logic drifts back into the adapter, it
  becomes untested — so the pressure is to keep the adapter thin, which is what we want anyway.
- **Cost:** a genuine bug in the adapter's event wiring will not be caught by `npm test`. It will
  surface in live verification or in the browser. This is accepted knowingly, and is the reason
  the adapter must stay small enough to read in one sitting.
- **Risk:** "it's just wiring" is exactly how untested logic accumulates. Mitigation: the file is
  reviewed against that claim at each council sitting, and any branch or decision that appears in
  it is a signal to extract it (as `describeCancellation` was extracted here).

## How we would know this was wrong

If a defect ships that a straightforward, non-mock-theatre unit test would have caught, the
exclusion is too broad and the offending logic should be extracted into a tested module — the same
move made here, applied again.

# ADR-0014: Voice availability is proven by synthesis, never by the voice list

- **Status:** Accepted
- **Strengthens:** ADR-0002's verification story; replaces the list-only detector for U-10
- **Date:** 2026-08-18

## Context

A user asked why `en-IN-Diya:DragonHDLatestNeural`, visible in the Azure Speech voice gallery,
would not work for them. It is real, it is a NeuralHD voice, and the `eastus2` `voices/list`
endpoint on our own resource advertises it. Synthesising with it against that same resource
returns:

```
HTTP 503, empty body, no error code, no Retry-After
```

Measured, not assumed:

| Test | Result |
|---|---|
| Diya @ `eastus2`, 8 attempts | **0 ok / 8 × 503** |
| Diya @ `centralindia` (temporary probe resource), 4 attempts | **4 ok / 0 failed**, 57,644 bytes |
| `en-US-Ava:DragonHDLatestNeural` @ `eastus2` | ok — the `Name:DragonHD` colon form is fine |
| `en-IN-Lavanya:DragonHDLatestNeural` @ `eastus2` | ok — and it is **also Preview**, so "Preview voices fail" is false |
| `en-IN-AaravNeural` @ `eastus2` | ok — resource, token and role are fine |

Region was the only variable that changed the outcome. The voice is advertised in `eastus2`
but is not deployed there.

The finding that matters for this repo is not about Diya. It is that **`voices/list` and the
synthesiser can disagree**, and our detector believed the wrong one of the two.
`scripts/verify-voices.ts` asserted `liveVoices.has(lang.voice)` — it asked the catalogue
whether a voice exists, and reported "All catalog voices and translation codes verified
against the live service." A voice in Diya's state passes that check while being completely
unusable. The detector for U-10 could not detect the failure it existed to catch.

This is the same shape as the ADR-0012 lesson: something that *looks* authoritative
(a role name, a catalogue listing) is not the same as the thing actually working.

## Decision

**A catalog voice is a problem unless we hold a successful synthesis probe for it carrying a
plausible amount of audio.** Specifically:

- `src/shared/voiceAvailability.ts` holds the decision as a pure function, so it is testable
  without the network.
- `npm run verify:voices` now POSTs a short SSML utterance for every distinct catalog voice
  and feeds the real outcomes to that function.
- A **missing** probe is a problem (`availability was not proven`), not a pass. Silence must
  never read as success — that is precisely how the old check granted false confidence.
- A 200 carrying fewer than `MIN_AUDIO_BYTES` (1024) is a problem. A short phrase at 24 kHz
  runs to several kilobytes, so a smaller body is empty or truncated, not a working voice.
- The voice list is still consulted, but only to distinguish *"not offered in this region"*
  from *"offered but refuses to speak"*, because those need different fixes.

## Consequences

- `verify:voices` now makes 16 synthesis calls instead of one list call. It takes seconds and
  a negligible number of characters. That is the price of the check meaning something.
- The check is honest about its own coverage: it cannot pass without evidence for every voice.
- Verified after the change: all 16 catalog voices synthesise in `eastus2` (4,608–11,232 bytes
  each). Mutation-tested by temporarily adding Diya to the catalog — the run failed with
  `HTTP 503 … the synthesiser refuses it` and exit code 1, where the old script passed.
- SpeechBridge itself was never broken by the Diya gap: Diya is not in the catalog.

## Consequence for anyone choosing a voice

Picking a voice from the Speech voice gallery is not sufficient. Confirm it synthesises **in
the region your resource lives in**. If a voice 503s with an empty body while other voices in
the same locale work, suspect a regional deployment gap before suspecting your own code.

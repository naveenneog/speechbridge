# Status

**Active packet:** none — M1 complete. Next up is P-8 (token refresh mid-session).
**State:** GREEN — gate 26/26, working tree clean
**Branch:** main

## M1 delivered

- [x] P-0..P-6  Foundation, keyless token broker, mic gate, latency meter, conversation, UI
- [x] P-7  Council review + security hardening (four real defects found and fixed)
- [x] P-9  Synthesis benchmark → pre-warmed connections (ADR-0009)

**Measured, in Chromium against live Azure, both directions:**

| Milestone | At P-7 | Now |
|---|---|---|
| First caption | 0.2 s | 0.2 s |
| Translation settled | 0.4–0.5 s | 0.2–0.5 s |
| Listener hears it | 1.2–2.4 s | **0.4–0.7 s** |

## Council verdicts — 2026-08-10

```
ARCHITECT: BLOCK -> resolved
  x mic gate filtered results, not audio: self-TTS captured during playback could
    finalise after the cooldown and be accepted. ADR-0006's "structurally impossible"
    was false.                                            -> fixed, ADR-0008
  x latency measured from the button press, reused the first utterance's numbers, and
    recorded "heard" before playback began.                -> fixed: per-utterance meter
                                                              driven by speechStartDetected
                                                              and the real onAudioStart
  x recognizer lifecycle not serialized or cancellable     -> fixed: generation + disposed
  ! CHARTER claimed S0 was needed for two concurrent recognitions, contradicting
    ADR-0005 (only one runs at a time).                    -> charter corrected
  ! seams are Azure-shaped, not engine-reversible          -> roadmap P-10
  ! token refresh never reaches a running recognizer       -> U-13, roadmap P-8

CODER: BLOCK -> resolved
  x stop() could not cancel an in-flight start(): a release during token fetch left an
    orphaned recognizer holding the microphone forever     -> fixed + regression test
  x speak() never settled when autoplay was blocked or on barge-in, pinning the gate in
    "speaking" for the rest of the session                 -> fixed: cancel resolves,
                                                              plus a watchdog
  x latency meter reset per floor-hold, not per utterance  -> fixed
  x a failed start() poisoned the channel and left the UI claiming to hold the floor
                                                           -> fixed with rollback + test
  ! "distinct id" test was vacuous - asserted over one element, which is why the latency
    bug survived                                           -> fixed, now advances the clock
  ! notices raised outside the conversation were erased    -> fixed via notice ownership
  ! panel.floor.firstChild! was fragile                    -> fixed, labelled span

SECURITY: BLOCK -> resolved
  x app.listen(port) bound the wildcard address, so the unauthenticated token endpoint was
    reachable by anyone on the LAN while the banner said "localhost"
                                                           -> fixed: loopback default,
                                                              verified unreachable from
                                                              10.46.0.19
  ! no Host/Origin check - DNS rebinding could read the token -> fixed, localGuard.ts
  ! SPEECH_ENDPOINT unvalidated; a typo could POST the Entra token to a third party
                                                           -> fixed: https + Azure host only
  ! concurrently pulled a vulnerable shell-quote           -> bumped to 9.2.4, prod audit clean
  ! no CSP                                                 -> roadmap P-11 (localhost demo)
  PASS: Entra token confinement, STS handling, error disclosure, XSS (textContent
        throughout), input validation, no secrets committed

QA: PASS
  162 tests, none skipped, none focused. Coverage 96.6% against an 80% floor.
  Every BLOCK above landed with the test that reproduces it.

UX: PASS-WITH-NOTES
  Loading, empty, error and success states all present; keyboard reachable (1 / 2 / Esc)
  with visible focus rings; captions carry lang and dir so Arabic renders correctly;
  prefers-reduced-motion honoured; contrast machine-tested.
  ! No device picker, and no visible indication of which microphone is in use -> roadmap P-13
```

## Commands that prove it

```powershell
npm test                 # 167 unit tests
npm run coverage         # 80% floor enforced
npm run verify:e2e       # real speech through a real browser, both directions
npm run bench:synthesis  # re-ask the ADR-0009 question if Azure changes
node .ironclad/gate.mjs --stage packet
```

## Open unknowns

U-13 (token refresh mid-session) — ASSUMED, bounded to ~10 minutes per held floor, with the
recognizer's error path as the detector. Packet P-8.

## Notes for the next session

The Azure resource is real and already provisioned:

- Resource group `rg-speech-bridge`, account `speechbridge27252`, region `eastus2`,
  kind `AIServices`, SKU `S0`, custom subdomain `speechbridge27252`
- The signed-in principal holds **Cognitive Services Speech User** on it
- There are **no keys** and there cannot be (ADR-0002) — authenticate with `az login`

The server binds to **127.0.0.1** deliberately. Setting `HOST` widens it and prints a warning;
do not do that without first adding authentication to `/api/speech-token`.

# Status

**Active packet:** P-7 — Council review, security hardening, README
**State:** GREEN — gate passing, ready to commit
**Branch:** main

## Acceptance criteria

- [x] Five council verdicts recorded, every BLOCK fixed with a regression test
- [x] End-to-end verification against live Azure (token minted, page served, bundle clean)
- [x] Token endpoint proven unreachable from the LAN
- [x] README written
- [x] Coverage above the 80% floor, honestly measured

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
npm test
npm run coverage
node .ironclad/gate.mjs --stage packet
npm run verify:voices
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

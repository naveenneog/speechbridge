# SpeechBridge — Charter

## What this is

A **near-realtime, bidirectional speech translation demo** on Azure AI Speech. Two people who do
not share a language sit at one machine. Each speaks naturally; the other hears it in their own
language, in a natural voice, within roughly a second and a half.

## Goals

1. **Bidirectional.** A→B and B→A, each with its own source and target language.
2. **Near-realtime.** Live partial captions while the speaker is still talking; spoken translation
   promptly after they stop. Latency is visible in the UI, not hidden.
3. **Keyless.** No API key anywhere — not in source, not in `.env`, not in the browser. This is not
   a preference; the tenant forbids keys (see Constraints).
4. **Demonstrable.** Runs on a laptop with one microphone and a pair of speakers or a headset.
5. **Honest about latency.** The UI shows measured milliseconds rather than claiming "instant".

## Non-goals

- Multi-party (3+ speakers) or room-scale conferencing.
- Telephony/SIP integration.
- Persisting or storing conversation audio or transcripts.
- Custom/personal voice cloning (requires separate Microsoft access approval — out of scope).
- Production authentication, tenanting, or user accounts. This is a demo, and says so.

## Constraints (verified, not assumed)

| Constraint | Evidence |
|---|---|
| **Local auth (API keys) is disabled tenant-wide.** `disableLocalAuth=true` is force-applied by policy even on a newly created resource. `az cognitiveservices account keys list` fails with `BadRequest`. | Verified 2026-08-10 against 4 existing Speech resources + 1 new one |
| Therefore **Microsoft Entra ID is the only auth path**, and Entra auth on Speech **requires a custom subdomain** on the resource. | ADR-0002 |
| The browser must never hold an Entra token (broad scope). A backend exchanges it for a **short-lived Speech STS token**. | ADR-0003 |
| **Node's native `WebSocket` (Node 22+/26) breaks the Speech SDK.** Recognition fails with a 1006 connection error unless the `ws` fallback is used. Browsers are unaffected. | ADR-0004 |
| **F0 (free) tier is unsuitable.** It caps text-to-speech at 20 transactions per 60 seconds and permits one concurrent recognition; a floor change briefly overlaps the outgoing and incoming recognizers. **S0 required.** | `speech-services-quotas-and-limits` |
| Speech translation bills 2 target languages; more incur Translator character costs. | `speech-translation` docs |

## Quality bar

- Test-first for all pure logic. The gate (`node .ironclad/gate.mjs --stage packet`) is the
  definition of done, not "it worked when I tried it".
- Coverage floor **80%**, enforced by the charter.
- **Design tokens are unit-tested for WCAG contrast.** A colour that fails contrast fails the build.
- Every interactive control reachable and operable by keyboard, with a visible focus ring.
- No secret, token, or resource key committed. Ever.

## Architecture in one line

`Browser (Speech SDK: mic + TTS) --/api/speech-token--> Express broker --DefaultAzureCredential--> Azure AI Services (STS)`

The browser talks **directly** to Azure for audio (lowest latency); the server exists only to mint
short-lived tokens. Audio never transits our backend.

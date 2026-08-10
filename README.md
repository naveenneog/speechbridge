# SpeechBridge

**Near-realtime, bidirectional speech translation on Azure AI Speech.**

Two people who don't share a language sit at one laptop. Each speaks naturally; the other hears
it in their own language, in a natural voice, about a second and a half later. Live captions
appear while you're still talking, and the interface shows you the measured latency rather than
asking you to take "realtime" on faith.

16 languages, including English, Hindi, Kannada, Tamil, Telugu, Marathi, Spanish, French,
German, Italian, Portuguese, Japanese, Korean, Chinese, Russian and Arabic.

---

## What makes this different from the samples

**There is no API key anywhere.** Not in the source, not in `.env`, not in the browser. That
isn't a stylistic preference — the Azure tenant this was built against force-applies
`disableLocalAuth=true` to every Cognitive Services account, so a key cannot be obtained at all:

```
az cognitiveservices account keys list ...
→ ERROR: (BadRequest) Failed to list key. disableLocalAuth is set to be true
```

So authentication is Microsoft Entra ID end to end, and the browser is given a credential that is
both narrow and short-lived:

```
Browser ──GET /api/speech-token──> Express broker ──DefaultAzureCredential──> Microsoft Entra ID
                                          │
                                          └──POST /sts/v1.0/issueToken──> Speech STS token (10 min)

Browser ══════ audio (WebSocket, direct) ══════> Azure AI Speech
```

The server never touches audio — that would add a hop to every frame. It only mints tokens.
The browser never receives the Entra token, only the Speech-scoped one that expires in ten
minutes. This is enforced mechanically: `src/client/**` is forbidden by the project charter from
importing `@azure/identity`, and the gate fails the build if it ever does.

Full reasoning in [`docs/adr/0002`](docs/adr/0002-entra-id-auth-no-keys.md) and
[`docs/adr/0003`](docs/adr/0003-short-lived-sts-token-broker.md).

---

## Running it

### Prerequisites

- Node 20+
- Azure CLI, logged in: `az login`
- An Azure AI Services (or Speech) resource **with a custom subdomain**, SKU **S0**

> **S0 is required, not preferred.** The free F0 tier allows only one concurrent recognition, and
> a bidirectional conversation needs two.

### Provision (once)

```powershell
az group create -n rg-speech-bridge -l eastus2

az cognitiveservices account create `
  -n <unique-name> -g rg-speech-bridge -l eastus2 `
  --kind AIServices --sku S0 --custom-domain <unique-name> --yes

# Grant yourself the data-plane role (this is what replaces the API key)
$rid = az cognitiveservices account show -n <unique-name> -g rg-speech-bridge --query id -o tsv
az role assignment create --assignee <your-upn> `
  --role "Cognitive Services Speech User" --scope $rid
```

The `--custom-domain` flag is not optional: Microsoft Entra authentication does not work on
regional endpoints. The server refuses to start if you point it at one.

### Configure and run

```powershell
npm install
Copy-Item .env.example .env    # then edit it — no key required, only identifiers

npm run dev                    # token broker + Vite dev server
```

Open <http://localhost:5173>. Pick a language for each side, click **Hold the floor** (or press
`1` / `2`), and talk. Press `Esc` to release.

### Use a headset

The app speaks its translation through the same machine that's listening. It mutes the microphone
during playback so it can't hear itself and loop, but on open speakers in a live room a headset is
still the better experience. ([ADR-0006](docs/adr/0006-mic-gating-for-echo-control.md).)

---

## How it works

| File | Responsibility |
|---|---|
| `src/shared/languages.ts` | The 16 languages, their recognition locales and their voices |
| `src/server/tokenBroker.ts` | Entra → Speech STS exchange, cached, refreshed at 80% of life |
| `src/server/app.ts` | `/api/speech-token`, `/api/languages`, `/api/health` |
| `src/client/conversation.ts` | Who holds the floor, what's believed, what's transcribed |
| `src/client/micGate.ts` | Mutes recognition during playback so the app can't hear itself |
| `src/client/latency.ts` | Per-turn timing: caption → translation → heard |
| `src/client/azureSpeech.ts` | The only file that knows the Speech SDK exists |
| `src/client/view.ts` | Pure presentation logic |

The Speech SDK sits behind two seams (`TranslationChannel`, `SpeechPlayer`), so all the rules that
matter are unit-tested without a network, a microphone or a browser.

---

## Commands

```powershell
npm test              # unit tests
npm run coverage      # coverage, floor enforced at 80%
npm run lint
npm run typecheck
npm run build

npm run verify:voices    # re-check every voice + language code against live Azure
npm run fixture:speech   # synthesize the spoken WAV used by the e2e check
npm run verify:e2e       # play it into a real browser, assert Hindi comes out
npm run verify:browser   # page loads, keyboard works, no console errors

node .ironclad/gate.mjs --stage packet   # the definition of done
```

`verify:voices` matters more than it looks: voices are added and retired by Azure, and a catalog
that was correct at commit time can quietly stop being true. It hits the live service and fails if
anything we claim to support no longer exists.

`verify:e2e` is the one that proves the product claim. It feeds recorded speech into Chromium's
microphone, drives the real UI, and checks **both directions** — because proving one direction
proves half a product:

```
A speaks English -> B hears Hindi
  heard      : Good morning.
  translated : सुप्रभात।  [lang=hi]
  latency    : 0.2s · 0.4s · 1.2s

B speaks Hindi   -> A hears English
  heard      : नमस्ते।
  translated : Hello.  [lang=en]
  latency    : 0.3s · 0.5s · 1.3s
```

---

## Latency, honestly

Measured end to end **in Chromium against live Azure**, English→Hindi, by playing a recorded
utterance into the browser's microphone (`npm run verify:e2e`):

| Milestone | Time |
|---|---|
| First caption on screen | **0.2 s** |
| Translation settled | **0.2 – 0.5 s** |
| Listener actually hears it | **0.4 – 0.7 s** |

Those numbers are the result of chasing the third row down. It originally read **1.2–2.4 s**,
because speech synthesis was paying for a cold TLS + WebSocket handshake at the worst possible
moment — right after the speaker stopped talking.

`scripts/bench-synthesis.mjs` measured three strategies against live Azure. Switching to the
recognizer's built-in fused synthesis would have saved 743 ms but required rebuilding playback,
barge-in and the microphone gate around a streaming source. Simply **opening the synthesis
connection early — while the user is still speaking, when the wait is free — recovered 75% of
that** for a few lines of code. The synthesis leg fell from ~800–2000 ms to about 200 ms.
Full reasoning in [ADR-0009](docs/adr/0009-prewarm-synthesis-connection.md).

The other tunable is end-of-utterance detection: the recognizer waits for a pause before
committing, set to 350 ms via `Speech_SegmentationSilenceTimeoutMs` (documented range
100–5000, default 500). That is why the fixture's opening sentence commits on its own — a
short pause ends the phrase. It is the deliberate trade for a snappier turnaround.

The interface shows all three timings on every turn, so you see the real numbers rather than
trusting this table.

---

## Engineering

Built under [Ironclad](docs/adr/0001-adopt-ironclad.md): test-first, one packet per commit, a
five-seat review council, and a machine-checked definition of done. Notable consequences:

- Design tokens are **contrast-tested** — a colour that fails WCAG fails the build
  (`tests/designTokens.test.ts`).
- Module boundaries are enforced, not merely intended.
- Every architectural claim in `docs/` is traced to a measurement or a citation.
  What we didn't know, and how each was closed, is in [`docs/UNKNOWNS.md`](docs/UNKNOWNS.md).

### Two landmines documented so you don't lose an afternoon

1. **Node's native `WebSocket` breaks the Speech SDK.** Recognition dies with an unexplained
   `1006` because Node negotiates WebSocket-over-HTTP/2, which the service rejects. Browsers are
   unaffected. ([ADR-0004](docs/adr/0004-node-native-websocket-breaks-speech-sdk.md).)
2. **`TranslationRecognizer` has no echo cancellation**, so a demo on open speakers will
   translate its own output in a loop unless you gate the microphone.
   ([ADR-0006](docs/adr/0006-mic-gating-for-echo-control.md).)

---

## Limits

This is a demo, and says so:

- **Two parties, one at a time.** One microphone means one recognizer; the floor is explicit.
- **No barge-in.** You can't interrupt a translation mid-playback — the microphone is muted then.
  Fixing that properly means a different engine (Voice Live has built-in AEC), which is on the roadmap.
- **Nothing is stored.** No audio, no transcripts, no accounts.
- Not hardened for public deployment: no CORS policy, rate limiting or authentication on the
  broker. It's built to run on localhost.

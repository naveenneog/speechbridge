# ADR-0003: Exchange the Entra token for a short-lived Speech STS token server-side

- **Status:** Accepted
- **Date:** 2026-08-10
- **Corrected by:** [ADR-0012](0012-cognitive-services-user-role.md) — this ADR names *Cognitive Services Speech User*, which is **wrong** for the STS token-exchange path. The correct role is *Cognitive Services User*. CORRECTED BY ADR-0012.

## Context

ADR-0002 commits us to Entra ID. The browser needs *some* credential to open its audio WebSocket
directly to Azure (going through our own server would add a hop to every audio frame and defeat the
latency goal).

Two token shapes are available:

1. An **Entra access token** for `https://cognitiveservices.azure.com/.default`, used by the SDK as
   `SpeechConfig.fromAuthorizationToken("aad#{resourceId}#{entraToken}", region)`. Verified working
   on 2026-08-10 (synthesized 105,644 bytes against a key-less resource).
2. A **Speech STS token**, obtained from `POST /sts/v1.0/issueToken`.

The published way to get an STS token uses `Ocp-Apim-Subscription-Key` — which we do not have. So
the question was whether an STS token can be obtained *without* a key.

## Investigation

It can, but only on the custom-subdomain host:

```
POST https://<subdomain>.cognitiveservices.azure.com/sts/v1.0/issueToken
Authorization: Bearer <entra token>
→ 200, a 929-character Speech token

POST https://eastus2.api.cognitive.microsoft.com/sts/v1.0/issueToken
Authorization: Bearer <entra token>
→ 400
```

The resulting STS token was confirmed to authorize a `TranslationRecognizer` session.

## Decision

The server holds the Entra credential (`DefaultAzureCredential`) and exposes exactly one endpoint,
`GET /api/speech-token`, which returns a **Speech-scoped STS token**, its region, and its expiry.
The browser never receives an Entra token.

The broker caches the token and refreshes at 80% of its 10-minute life.

## Consequences

- **Good — this is the security win.** An Entra access token is broad: it is accepted by every
  Cognitive Services resource the signed-in principal can reach. The STS token is scoped to Speech
  on one resource and dies in 10 minutes. Leaking it is a far smaller event.
- **Good:** the browser bundle contains no credential logic at all. The charter enforces this
  mechanically — `src/client/**` is forbidden from importing `@azure/identity`.
- **Cost:** an extra network hop at session start (~100 ms, once) and a refresh timer.
- **Cost:** binds us to the custom-subdomain host for the exchange (ADR-0002 already requires it).

## How we would know this was wrong

If the STS exchange begins returning 401 for a principal that still holds the Speech User role, the
`aad#{resourceId}#{token}` form remains a working fallback and is already proven. Swapping to it is
a change to one function in `tokenBroker.ts`.


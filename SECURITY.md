# Security

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Report them to the Microsoft Security Response Center at
[https://msrc.microsoft.com/create-report](https://aka.ms/opensource/security/create-report),
or email [secure@microsoft.com](mailto:secure@microsoft.com). More detail, including PGP keys,
is at [aka.ms/opensource/security/pgpkey](https://aka.ms/opensource/security/pgpkey) and
[aka.ms/opensource/security/policy](https://aka.ms/opensource/security/policy).

Please include as much of the following as you can: the type of issue, the affected source
files, how to reproduce it, and the impact. It helps us triage faster.

## How this accelerator is designed to be secure

Worth stating plainly, because it shapes what you should and should not change:

**There are no API keys, anywhere.** The Azure AI Services account is provisioned with
`disableLocalAuth: true`, so keys cannot be issued even by an administrator. The web app
authenticates with a **user-assigned managed identity** holding the *Cognitive Services
Cognitive Services User* role. Nothing secret is stored in configuration, in the repository, or in the
deployment outputs.

**The browser never receives a durable credential.** It gets a Speech-scoped token that
expires in ten minutes, minted server-side. It never sees a Microsoft Entra access token,
which would be accepted by every Cognitive Services resource the identity can reach.
See [`docs/adr/0003`](docs/adr/0003-short-lived-sts-token-broker.md).

**The deployed site requires sign-in.** App Service built-in authentication (Easy Auth) sits
in front of the app, and the app additionally refuses to mint a credential unless the
platform has supplied an authenticated principal. If authentication is misconfigured, the
app **fails closed** — it stops working rather than exposing your subscription.

**Locally, the server binds to loopback only** and validates the `Host` header, which closes
the DNS-rebinding path to the credential endpoint. Widening the bind requires setting `HOST`
explicitly and prints a warning.

## What this accelerator does *not* do

Be aware of these before using it for anything beyond a demo:

- **No rate limiting** on the credential endpoint. An authenticated user can request tokens
  as often as they like, and each is usable against your Speech resource for ten minutes.
- **No Content-Security-Policy** is set. See `docs/ROADMAP.md`.
- **No private networking.** The AI Services account uses public network access with
  `defaultAction: Allow`. For production, put it behind Private Endpoints.
- **No audio or transcripts are stored** by this application — but the Azure services it calls
  have their own data-handling behaviour. See
  [`docs/RESPONSIBLE_AI.md`](docs/RESPONSIBLE_AI.md).


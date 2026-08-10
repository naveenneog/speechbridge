# ADR-0004: Disable Node's native WebSocket for any Speech SDK use under Node

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

While verifying the translation path, every recognition attempt under Node 26.1.0 failed:

```
CANCELED reason=Error errorCode=4 (ConnectionFailure)
errorDetails=Unable to contact server. StatusCode: 1006, undefined Reason:
```

Text-to-speech through the *same* credential and the *same* resource worked perfectly, so the
credential, the resource, the region and the RBAC role were all proven good. The failure was
specific to the recognition WebSocket. Node also emitted:

```
ExperimentalWarning: WebSocket over HTTP2 is experimental, and subject to change.
```

Modern Node exposes a **native global `WebSocket`**. The Speech SDK prefers a global `WebSocket`
when one exists, falling back to the `ws` package otherwise. Node's native implementation negotiates
over HTTP/2, which the Speech service's WebSocket endpoints do not accept — hence the immediate
1006 abnormal closure.

Isolating it:

```js
delete globalThis.WebSocket;   // before the SDK opens a connection
→ STT  (SpeechRecognizer)   : SESSION STARTED — connection OK
→ XLT  (TranslationRecognizer): SESSION STARTED — connection OK
```

## Options considered

1. **Pin an older Node.** Rejected: punishes every future developer for a library detail, and the
   native `WebSocket` is not going away.
2. **Run the Node-side SDK with `--no-experimental-websocket`.** Works, but is a flag that must be
   remembered at every call site and is silently absent in CI or an IDE runner.
3. **Delete `globalThis.WebSocket` in one place, in code, before the SDK loads.** Chosen.

## Decision

Any Node-side entry point that touches the Speech SDK deletes `globalThis.WebSocket` first, in a
single documented helper, so the SDK resolves to the `ws` package it ships as a dependency.

**Browser code is unaffected and must not do this** — a browser's `WebSocket` is the standard one
and is exactly what the SDK should use. Our production audio path is the browser, so this is a
tooling/verification concern only.

## Consequences

- **Good:** Node-side verification scripts and any future server-side recognition work reliably.
- **Good:** the failure is documented, so the next person loses minutes rather than hours to a
  1006 with no explanatory message.
- **Cost:** a global mutation, which is inherently a smell. It is confined to one exported helper
  with a comment pointing at this ADR, and never runs in the browser.
- **Risk:** if a future dependency expects the native `WebSocket` in the same Node process, it will
  not find it. Nothing in the current tree does.

## How we would know this was wrong

If the Speech SDK ships a release that negotiates HTTP/1.1 explicitly, or Node's native client
stops preferring HTTP/2, the workaround becomes unnecessary. Test: remove the helper and run the
live verification script; if recognition connects, delete the helper and supersede this ADR.

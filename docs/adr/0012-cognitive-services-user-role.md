# ADR-0012: Grant Cognitive Services User, not Cognitive Services Speech User

- **Status:** Accepted
- **Corrects:** ADR-0002 and ADR-0003, which both named the wrong role
- **Date:** 2026-08-11

## Context

Every document in this project said the app's identity needs **Cognitive Services Speech
User**, and that this is "what replaces the API key". A fresh `azd up` proved that wrong: the
deployed app failed every token exchange with

```
HTTP 401 {"error":{"code":"PermissionDenied",
          "message":"Principal does not have access to API/Operation."}}
```

even though the role assignment demonstrably existed for the correct managed identity, with
`AZURE_CLIENT_ID` set correctly and the right endpoint configured. Retries over 15 seconds and
a wait of 40 minutes ruled out propagation.

Listing the role's data actions explains it. **Cognitive Services Speech User** grants:

```
Microsoft.CognitiveServices/accounts/SpeechServices/*/read
Microsoft.CognitiveServices/accounts/SpeechServices/*/transcriptions/*
Microsoft.CognitiveServices/accounts/SpeechServices/*/frontend/action
… and other paths under accounts/SpeechServices, CustomVoice, TTSPlayer …
```

Every one is scoped beneath a service path. **None authorises `/sts/v1.0/issueToken`**, which
is not under `SpeechServices/` at all. **Cognitive Services User** grants
`Microsoft.CognitiveServices/*`, which does.

### Why this hid for so long

Local development worked perfectly, and so did every manual probe. Both ran as a signed-in user
who — as `az role assignment list --include-inherited` eventually showed — holds **Owner** and
**Foundry User** at *subscription* scope. Those inherited roles supplied the missing permission,
so the explicitly-assigned Speech User role was never the thing making it work. The managed
identity had no such inheritance and was the first principal to exercise the role as written.

A test that only ever runs as a highly-privileged developer cannot detect a
too-narrow role. The deployed app was the first honest test of the permission model.

## Options considered

1. **Keep Speech User and switch the browser to `aad#{resourceId}#{token}`.** This is the
   narrower-privilege option and it does work — Speech User's `frontend/action` covers direct
   SDK use. Rejected because it requires handing the **browser a full Microsoft Entra access
   token**, which is accepted by every Cognitive Services resource the identity can reach. That
   is precisely the exposure ADR-0003 was written to eliminate. Trading a narrower server-side
   role for a far broader client-side credential is a bad exchange.
2. **Grant Cognitive Services User.** Chosen.

## Decision

The app's managed identity — and the developer running locally — are granted **Cognitive
Services User** (`a97b65f3-24c7-4388-baec-2e87135dc908`) on the AI Services account.

The trade is explicit and, I think, the right way round: **a broader role on the server, so the
browser can hold a much narrower credential.** The server is a controlled environment with a
managed identity and no interactive user; the browser is not.

## Consequences

- **Good:** a fresh deployment works. Verified: after the assignment, the token exchange
  returned HTTP 200 from inside the container.
- **Cost:** the identity can now reach every data-plane API on that account, not just Speech.
  Mitigated by the account being single-purpose and scoped to one resource — the assignment is
  at account scope, never at resource-group or subscription scope.
- **Documentation debt paid:** README, SECURITY.md, CHARTER.md, ADR-0002 and ADR-0003 all
  stated the wrong role and have been corrected.

## How we would know this was wrong

If Azure adds a data action to Speech User that authorises `sts/v1.0/issueToken`, the narrower
role becomes sufficient and should be preferred. The check is one command:

```
az role definition list --name "Cognitive Services Speech User" \
  --query "[0].permissions[0].dataActions"
```

## The general lesson

This is the second time on this project that something passed validation, unit tests and manual
inspection, and was only caught by deploying for real — after ADR-0011's quota and networking
defects. Both share a cause: **the development environment was more privileged and more
permissive than the deployment target.** Verifying as a subscription Owner proves very little
about what a managed identity can do.

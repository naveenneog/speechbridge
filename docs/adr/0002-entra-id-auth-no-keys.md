# ADR-0002: Authenticate to Azure Speech with Microsoft Entra ID, not an API key

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Every published sample for Azure Speech starts with a subscription key. This tenant makes that
impossible. Measured on 2026-08-10:

```
az cognitiveservices account keys list -n naveen-westus-speech -g neo-pikachu
→ ERROR: (BadRequest) Failed to list key. disableLocalAuth is set to be true
```

All four pre-existing Speech resources report `disableLocalAuth=true`. Crucially, a **brand-new**
resource created during this work came back with `disableLocalAuth=true` as well, so this is an
Azure Policy applied at tenant/subscription scope, not a per-resource setting we could turn off.

None of the existing resources had a `customSubDomainName`, and Entra authentication to Cognitive
Services **requires** a custom subdomain — the regional endpoints do not support it.

## Options considered

1. **Ask for the policy to be exempted so we can use a key.** Rejected: slow, requires someone
   else's approval, and argues for a weaker security posture to save a day of work.
2. **Reuse an existing Speech resource.** Rejected: none has a custom subdomain, and the subdomain
   cannot be added to an account after creation without recreating it.
3. **Create a new resource with a custom subdomain and use Entra ID.** Chosen.

## Decision

Create a dedicated `AIServices` account with an explicit custom subdomain, and authenticate with
Microsoft Entra ID throughout.

```
az cognitiveservices account create -n <name> -g <your-resource-group> -l eastus2 \
  --kind AIServices --sku S0 --custom-domain <name> --yes
```

`AIServices` (rather than `SpeechServices`) was chosen so the same resource can later host the
Realtime / Voice Live paths on the roadmap without a second provisioning step. `S0` is required:
the free tier permits only one concurrent recognition, and a bidirectional demo needs two.

Access is granted with the **Cognitive Services Speech User** role, scoped to the resource.

## Consequences

- **Good:** no key exists to leak, commit, or rotate. `.env` holds only non-secret identifiers.
- **Good:** works with managed identity unchanged when deployed — `DefaultAzureCredential` picks up
  a developer's `az login` locally and a managed identity in Azure.
- **Cost:** the caller needs an RBAC role assignment, which is a extra provisioning step compared
  to copying a key, and role assignments take up to a few minutes to propagate.
- **Cost:** the SDK path is less-travelled than the key path, so samples need adapting (see
  ADR-0003 for the exact token format).

## How we would know this was wrong

If `az cognitiveservices account keys list` starts succeeding on a new resource, the policy has been
lifted and the key path becomes available — but we would still not take it, because the Entra path
is strictly better. The decision only becomes wrong if Entra auth fails in a deployment target that
cannot obtain a managed identity.


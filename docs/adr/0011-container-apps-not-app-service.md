# ADR-0011: Host on Container Apps, not App Service

- **Status:** Accepted
- **Supersedes the hosting decision in:** ADR-0010 (the authentication design there stands)
- **Date:** 2026-08-10

## Context

ADR-0010 chose Azure App Service over Container Apps on one argument: Docker is not
installed on this machine, and a one-click deploy that first requires installing a container
runtime is not one click. The Bicep validated cleanly (`az deployment sub validate` →
`Succeeded`), so the decision looked sound.

Then it was actually deployed, and it failed:

```
InternalSubscriptionIsOverQuotaForSku
Current Limit (Total VMs): 0
Amount required for this deployment (Total VMs): 1
```

App Service is blocked in this subscription. Not rate-limited — **zero**. Dropping from B1 to
the free F1 tier failed identically, and `az appservice plan list` returned nothing at all,
confirming App Service has never worked here. Meanwhile `az appservice list-locations --sku B1`
happily listed East US 2 as available, so the capability API and the deployment path disagree.

This matters beyond one subscription: App Service VM quota is commonly zero in enterprise and
sponsored subscriptions, which is a large share of the people who would try an accelerator.

Container Apps, by contrast, already had three running apps in the same subscription.

## The premise that turned out to be wrong

The Docker objection does not survive contact with the facts. `azd` supports
`docker: { remoteBuild: true }`, which builds the image **in Azure Container Registry**. No
Docker daemon is involved on the developer's machine at any point. The original argument was
sound reasoning from a false premise — a good reminder that "I checked whether the tool is
installed" is not the same as "I checked whether the tool is needed".

## Decision

Host on **Azure Container Apps (Consumption)** with the image built remotely by ACR.

- No App Service VM quota required — the failure mode that blocked deployment disappears.
- No local Docker required — `remoteBuild: true` keeps the one-command claim honest.
- **Scales to zero.** The App Service B1 plan cost about $15/month whether or not anyone used
  it; Consumption bills per request and idles free. `minReplicas` is a parameter: `1` keeps a
  warm instance (the default, since cold start on a demo is a bad first impression), `0` costs
  nothing when idle.
- It is also the pattern Microsoft's own flagship AI accelerators use.

Authentication is unchanged in substance: the app registration is created by the same
postprovision hook, and built-in authentication is configured through
`Microsoft.App/containerApps/authConfigs` instead of `Microsoft.Web/sites/config/authsettingsV2`.
The app still independently requires an authenticated principal and still fails closed.

## Two defects this only exposed by being deployed

1. **The container could not pull its own image.** The registry credential block was written
   as `registries: empty(imageName) ? [] : [...]`, so at provision time — when no image exists
   yet — no credential was configured. `azd deploy` then pushed an image the app could not
   pull, failing with `UNAUTHORIZED: authentication required`, which reads like a registry
   problem rather than a missing identity binding. The registry is now always configured.
2. **The server bound to loopback inside the container.** The rule was "bind `0.0.0.0` when
   `WEBSITE_SITE_NAME` is set", which is App Service-specific, so in Container Apps it bound
   `127.0.0.1` and every request through the ingress timed out. The rule is now stated at the
   right level of generality: **bind all interfaces whenever the access mode is
   `authenticated`**, because that mode means a platform is in front of us authenticating
   callers, and that platform has to be able to reach us. `CONTAINER_APP_NAME` is also
   detected for the access-mode default.

Neither was reachable by `az deployment sub validate`, by the unit suite, or by reading the
template. Both took a real deployment.

## Consequences

- **Good:** `azd up` now genuinely works end to end. Verified: revision Running, app
  registration `59ef30c7-…` created automatically, unauthenticated request returns 302 to the
  Microsoft sign-in page.
- **Good:** cheaper at rest and it works in quota-constrained subscriptions.
- **Cost:** an extra resource to reason about (the container registry) and a Dockerfile to
  maintain. The image is multi-stage and runs as non-root.
- **Cost:** with `minReplicas: 0` the first request after idle pays a cold start. Default is
  `1` to avoid that, at the cost of a small always-on charge.

## How we would know this was wrong

If Container Apps proves unavailable in a target subscription the way App Service was here,
the same `azd` service definition supports `host: appservice` with the module deleted in this
ADR still in git history. The lesson to keep is the process one: **validate is not deploy**,
and an accelerator's central claim is not proven until someone has actually run it.

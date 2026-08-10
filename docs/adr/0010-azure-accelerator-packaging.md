# ADR-0010: Package as an azd accelerator on App Service, with fail-closed authentication

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The demo needed to become a deployable Azure Solution Accelerator with genuine one-click
deployment. Two things about the existing design made this easier than it might have been,
and one made it harder.

Easier: the app already authenticates with `DefaultAzureCredential` and holds no API keys,
which maps directly onto a managed identity in Azure. The accelerator "definition of done"
includes an automated security scan that specifically checks managed identity is used
wherever supported and that no secrets are leaked — a gate this design passes by
construction rather than by remediation.

Harder: **`/api/speech-token` has no user authentication.** Locally that is contained by
binding to loopback and checking the `Host` header (ADR-0003, and the review council's
finding that the original wildcard bind exposed it to the LAN). Deployed to a public URL,
the same endpoint would let anyone on the internet mint Speech tokens against the
subscription. Publishing it as-is would have shipped the exact vulnerability the council
caught, only worse.

## Options considered

### Hosting

1. **Azure Container Apps.** What Microsoft's flagship AI accelerators use, and the pattern
   with the best documented Easy Auth story (app registration created declaratively through
   the Microsoft Graph Bicep extension). Rejected as the default: it requires building and
   pushing a container image, and **Docker is not installed on this machine** — nor on many
   of the machines that will try this. A "one-click" deploy that first requires installing a
   container runtime is not one click.
2. **Azure App Service (Linux, Node 20).** Deploys from source; `azd` runs the build on the
   platform. No Docker anywhere in the path. Chosen.

### Authentication

1. **Ship without authentication and document the risk.** Rejected outright. A documented
   vulnerability is still a vulnerability, and accelerators get copied.
2. **Require the user to create an app registration first.** Secure, but breaks one-click and
   is the step people skip.
3. **Create the app registration automatically in a postprovision hook, and make the app
   refuse to work without it.** Chosen.

## Decision

**App Service (Linux, Node 20)** provisioned by Bicep at subscription scope, deployed with
`azd up`.

**Authentication is layered, and the layers fail in the safe direction:**

- App Service **built-in authentication** (Easy Auth) with Microsoft Entra sits in front,
  configured by an `azd` postprovision hook that creates the app registration. The hook has
  to exist because the redirect URI contains the site hostname, which does not exist until
  the site is provisioned.
- The application **independently requires an authenticated principal**. A new `ACCESS_MODE`
  setting selects how callers are authorised: `local` (loopback + Host check, the developer
  default) or `authenticated` (a platform-supplied `X-MS-CLIENT-PRINCIPAL-ID`). Bicep sets
  `authenticated` on the deployed site.

The consequence that matters: **if Easy Auth fails to configure — the likely case in a
locked-down tenant where the deployer lacks app-registration rights — the site does not
become an open credential endpoint. It stops working.** It fails closed. The hook says so
explicitly and prints the two commands an administrator's app registration would need.

The principal header is trusted **only** in `authenticated` mode. App Service strips
inbound `X-MS-CLIENT-*` headers at the front door, so its presence there is proof; nothing
strips it locally, so in `local` mode it is ignored entirely and would otherwise be a
trivially forgeable bypass.

Supporting decisions:

- **User-assigned** managed identity, not system-assigned, so the role assignment can be
  created in the same deployment — the principal ID exists before the app that consumes it.
- The server is **compiled to JavaScript** (`tsconfig.server.json`) rather than run through
  `tsx`, because App Service installs production dependencies only and `tsx` is a dev
  dependency.
- API versions are pinned to ones the installed Bicep can **type-check**. The newest
  available versions (`2026-07-01`, `2026-03-01`) produce `BCP081` "no types available"
  warnings, which silently disables property validation — worse for an accelerator that
  others will edit than being a few months behind.
- `azuredeploy.json` is committed for the portal "Deploy to Azure" button, because that
  path still cannot consume Bicep. CI fails if it drifts from `main.bicep`.

## Consequences

- **Good:** `azd up` produces a working, authenticated, key-free deployment in one command.
- **Good:** the security posture is not documentation, it is behaviour. Misconfiguration
  degrades to unavailable rather than to exposed.
- **Good:** no Docker requirement, so the one-click claim survives contact with a developer
  machine that has not got a container runtime.
- **Cost:** App Service B1 is a fixed ~$15/month while it exists, unlike Container Apps
  scale-to-zero. The README says so and tells people to run `azd down`.
- **Cost:** the postprovision hook is imperative glue that Bicep cannot express. It is
  written twice (PowerShell and shell) and uses only core Azure CLI commands —
  `az webapp auth microsoft` lives in a preview extension that may not be installed, so the
  hook configures `authsettingsV2` through `az rest` instead.
- **Accepted limitation:** no rate limiting on the token endpoint. An authenticated user can
  request tokens freely. Recorded in `SECURITY.md` and on the roadmap.

## How we would know this was wrong

If deployments routinely land in tenants where app registration is refused, the fail-closed
default will read as "the accelerator is broken" rather than "the accelerator is safe". The
signal would be issues reporting a deployed site that redirects to a login that does not
work. The remedy is not to weaken the default — it is to make the administrator path a
first-class documented flow rather than a fallback.

# ADR-0013: Admit users from other organisations as guests, not by going multi-tenant

- **Status:** Accepted
- **Date:** 2026-08-11

## Context

A Microsoft employee tried to open the deployed app and was refused:

> Selected user account does not exist in tenant 'Microsoft Non-Production' and cannot access
> the application '…' in that tenant. The account needs to be added as an external user in the
> tenant first.

The deployment lives in an MCAPS Non-Production tenant
(`16b3c013-d300-468d-ac64-7eda0820b6d3`), while `@microsoft.com` accounts live in the Microsoft
corporate tenant (`72f988bf-86f1-41af-91ab-2d7cd011db47`). The app registration created by the
postprovision hook is `AzureADMyOrg` — single-tenant — so Entra correctly refuses anyone whose
account is elsewhere.

## Options considered

1. **Make the app registration multi-tenant (`AzureADMultipleOrgs`).** The obvious fix, and
   the one I implemented first. It does not work here:

   ```
   az ad app update --sign-in-audience AzureADMultipleOrgs
   → SignInAudience value 'AzureADMultipleOrgs' not allowed as per assigned policy
     '9d2624cb-…'. Set the application to use single-tenant audience of 'AzureADMyOrg'.
   ```

   An application-management policy forbids it — the same class of tenant-wide restriction as
   the `disableLocalAuth` policy that shaped ADR-0002. Requesting an exception is a
   conversation with a tenant administrator, not something a deployment can assume.

   It is also broader than the requirement. Multi-tenant means *every* Entra organisation can
   reach the sign-in page; admitting one company would mean admitting all of them and then
   narrowing back down in the app.

2. **Deploy into the corporate tenant instead.** Not available: the subscription lives in the
   Non-Production tenant.

3. **Invite the people who need access as B2B guests.** Chosen.

## Decision

Keep the app registration single-tenant, and invite users from other organisations as guests.
`npm run invite -- alice@microsoft.com bob@microsoft.com` does it through the Graph
`invitations` endpoint, with `--file` for a list and `--notify` to send the Entra email.

Verified: inviting `sidpandey@microsoft.com` produced a guest in the tenant
(`sidpandey_microsoft.com#EXT#@…`), which is exactly what the sign-in error asked for.

A guest signs in with their own corporate credentials and MFA; the token is issued by *our*
tenant, so no configuration changes and no second identity to manage.

### The tenant allowlist that came with the multi-tenant attempt is kept

`ALLOWED_TENANT_IDS` and the `tid` claim check were built for option 1 and are retained,
defaulted off:

- With a single-tenant registration they are redundant — Entra already scopes sign-in — so the
  default is empty and nothing changes.
- If a tenant *does* permit multi-tenant registrations, `multiTenantSignIn=true` becomes
  usable, and then the allowlist is what stops "any organisation" from being the actual
  policy. Shipping the widening without the narrowing would be the unsafe half.

The check is enforced in the app rather than only in platform config, so it still holds if the
Easy Auth configuration drifts.

## Consequences

- **Good:** access is a named list. Every person who can use the deployment was deliberately
  invited, which is a stronger position than "anyone with a work account at any company".
- **Good:** it works under the tenant policy as it actually is, rather than requiring an
  exception before anyone can use the app.
- **Cost:** onboarding is a command per group of people rather than self-service. For a demo
  shared with colleagues that is proportionate; for a public product it would not be.
- **Cost:** whoever runs it needs guest-inviter permission. The script says so plainly when
  the call is refused, rather than failing with a raw Graph error.
- **Note:** guests appear in the directory. They are ordinary B2B guests and can be removed
  with `az ad user delete`.

## How we would know this was wrong

If the tenant's application-management policy is relaxed to permit `AzureADMultipleOrgs`, and
the audience genuinely is "anyone at company X" rather than a known list of people, then
`multiTenantSignIn=true` plus `ALLOWED_TENANT_IDS` becomes the better fit — the code for it is
already here and tested.

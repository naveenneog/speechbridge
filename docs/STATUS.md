# Status

**Active packet:** P-0 — Project scaffold, charter, ledger, verified toolchain
**State:** GREEN — committing
**Branch:** main

## Acceptance criteria

- [x] Toolchain installed and each gate command verified to run (`test`, `lint`, `typecheck`, `build`)
- [x] Charter declares real commands, budgets and module boundaries
- [x] Ledger written from evidence: CHARTER, ROADMAP, UNKNOWNS, CHANGELOG, ADRs 0002–0006
- [x] Every architectural claim traced to a measurement or a citation, not recall

## Commands that prove it

```powershell
npm run typecheck
npm run lint
node .ironclad/gate.mjs --stage packet
```

## Open unknowns

None blocking. U-9 and U-11 are ASSUMED with named detectors; all others RESOLVED or RESEARCHED.

## Last completed

Live verification spikes against Azure (since deleted, per the spike protocol). What they proved is
recorded in `docs/UNKNOWNS.md` U-1…U-10 and in ADR-0002 through ADR-0006.

## Notes for the next session

The Azure resource is real and already provisioned:

- Resource group `rg-speech-bridge`, account `speechbridge27252`, region `eastus2`, kind `AIServices`, SKU `S0`
- Custom subdomain `speechbridge27252` (required for Entra auth — see ADR-0002)
- The signed-in principal holds **Cognitive Services Speech User** on it

There are **no keys** and there cannot be (ADR-0002). Authenticate with `az login` locally.

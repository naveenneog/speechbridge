# Contributing

Thanks for your interest. This project welcomes contributions and suggestions.

## Contributor License Agreement

Most contributions require you to agree to a Contributor License Agreement (CLA) declaring
that you have the right to, and actually do, grant us the rights to use your contribution.
Details at [https://cla.opensource.microsoft.com](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to
provide a CLA and decorate the PR appropriately. You only need to do this once across all
repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](.github/CODE_OF_CONDUCT.md).

## How this repository expects work to be done

This project uses an executable engineering contract. It is not decoration — the gate will
reject a pull request that ignores it.

**The definition of done is a program, not an opinion:**

```powershell
node .ironclad/gate.mjs --stage packet
```

It must exit 0. It runs the tests, lint, typecheck and build, and audits file sizes, debt
markers, module boundaries, secrets and documentation freshness.

**Test first.** Write a failing test, read the failure, then make it pass. Never weaken,
skip or `.only` a test to get green — the gate detects all four.

**One packet per commit.** A packet is one behaviour, testable in isolation. Name it in
`docs/ROADMAP.md` and mark it active in `docs/STATUS.md`.

**Record decisions.** Anything architecturally significant — a dependency, a protocol, a
storage choice, an auth change — gets an ADR in `docs/adr/`. Say what you considered, what
you chose, what it costs, and how you would know it was wrong.

**Say what you do not know.** Uncertainties go in `docs/UNKNOWNS.md` before implementation
and are closed by research with a citation, or by an explicit assumption with a detector.

## Getting set up

```powershell
npm install
Copy-Item .env.example .env     # no API key required; run `az login`
npm run dev
```

## Before you open a pull request

```powershell
npm test                  # unit tests
npm run lint
npm run typecheck
npm run verify:voices     # catalogue still matches the live service
npm run verify:e2e        # real speech through a real browser, both directions
node .ironclad/gate.mjs --stage packet
```

If you changed anything in `infra/`, also regenerate the ARM template used by the
**Deploy to Azure** button, or it will silently drift from the Bicep:

```powershell
az bicep build --file infra/main.bicep --outfile azuredeploy.json
```

## What gets a change rejected

- A feature with no test, or a test that would pass before the feature existed
- A secret, key, token or connection string in source — there are no keys in this design,
  and adding one is a regression, not a feature
- Widening the default network bind or the access mode without an ADR
- A dependency added without justification in the pull request description

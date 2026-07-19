# Ontology Automation

Harvest now has a local CLI path for ontology normalization and Foundry comparison.

## Installed local tooling

- Palantir TypeScript OSDK base packages:
  - `@osdk/client`
  - `@osdk/oauth`
  - `@osdk/foundry`
- OpenClaw CLI:
  - `openclaw`

## Why this shape

This repo is TypeScript-based, so the TypeScript OSDK is the right fit.

Palantir's generated Ontology SDK is usually specific to your Foundry application, but the generic platform ontology packages are enough to:

- authenticate with Foundry
- list object types from a target ontology
- compare them to Harvest's local ontology contract
- export a normalized artifact for review and standardization

## Local env setup

Create `.env.foundry.local` from `.env.foundry.example` and fill in your Foundry values.

The ontology scripts auto-load:

- `.env`
- `.env.local`
- `.env.harvest.local`
- `.env.foundry.local`

## Commands

Export the current Harvest ontology snapshot:

```bash
npm run ontology:export
```

Compare Harvest ontology to a Foundry ontology:

```bash
PALANTIR_FOUNDRY_URL=https://your-stack.palantirfoundry.com \
PALANTIR_ONTOLOGY_RID=ri.ontology.main.ontology.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
PALANTIR_CLIENT_ID=... \
PALANTIR_CLIENT_SECRET=... \
npm run ontology:compare:foundry
```

Generate a suggested canonical mapping file from the comparison report:

```bash
npm run ontology:map:foundry
```

Generate a repo-native canonical mapping artifact to check in:

```bash
npm run ontology:canonicalize:foundry
```

PowerShell equivalent:

```powershell
$env:PALANTIR_FOUNDRY_URL = 'https://your-stack.palantirfoundry.com'
$env:PALANTIR_ONTOLOGY_RID = 'ri.ontology.main.ontology.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
$env:PALANTIR_CLIENT_ID = '...'
$env:PALANTIR_CLIENT_SECRET = '...'
npm run ontology:compare:foundry
```

OpenClaw local CLI helpers:

```bash
npm run openclaw:doctor
npm run openclaw:onboard
```

## Artifacts

The scripts write to `artifacts/ontology/`:

- `harvest-ontology.json`
- `foundry-ontology-report.json`
- `foundry-ontology-mapping.json`
- `src/intelligence/ontology/foundry-canonical-mapping.json`

## Suggested workflow

1. Run `npm run ontology:export`
2. Run `npm run ontology:compare:foundry`
3. Run `npm run ontology:map:foundry`
4. Run `npm run ontology:canonicalize:foundry`
5. Review `artifacts/ontology/foundry-ontology-report.json`
6. Review `artifacts/ontology/foundry-ontology-mapping.json`
7. Review `src/intelligence/ontology/foundry-canonical-mapping.json`
8. Use OpenClaw locally to reason over the diff and propose naming/mapping cleanup

Example prompt for OpenClaw:

```text
Review artifacts/ontology/foundry-ontology-report.json and artifacts/ontology/foundry-ontology-mapping.json.
Propose a canonical mapping between Harvest entity types and Foundry object types.
Flag missing object types, duplicate concepts, and identifier mismatches.
Return a migration-safe ontology standardization plan.
```

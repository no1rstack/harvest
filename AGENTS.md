# Harvest — Collection Platform

Standalone product extracted from Judicium. Owns:

- `collection_targets` registry + Cascades enqueue
- Observation store (`osint_harvest_findings`) + provenance lineage
- Intelligence Core v1 (`/api/intelligence/v1/*`)
- HarvestAdmin UI at `harvest.noirstack.com`

## Boundaries

| Repo | Role |
|------|------|
| **harvest** (this) | Collection + Intelligence Core system of record |
| **cascades** | Connector workflow execution |
| **judicium** | Investigation workbench — consumes Intelligence API |

## Env (Infisical)

**Project:** `f7f058b6-d267-45c1-9311-e0962a74e923` @ [crypt.noirstack.com](https://crypt.noirstack.com) (`prod`)

Bootstrap all keys from Judicium/Keycloak sources (one-time):

```bash
./scripts/infisical/bootstrap-harvest-secrets.sh
```

| Variable | Purpose |
|----------|---------|
| `HARVEST_DATABASE_URL` | Postgres (`harvest_user@harvest`) |
| `H3XA_DATABASE_URL` | Optional STIX bridge |
| `COLLECTION_INTERNAL_TOKEN` | Cascades → Harvest step APIs |
| `CASCADES_API_URL` | Enqueue workflows (`http://cascades:3000` on VPS) |
| `CASCADES_PUBLIC_URL` | UI links |
| `KEYCLOAK_*` | Harvest UI auth |
| `HARVEST_SCHEDULER_*` / `HARVEST_FEEDS_*` | Platform tab schedulers |
| `GHCR_*` | CI image push |

Deploy reads **only** the Harvest project (no Judicium/Keycloak project merge).

## Local dev

```bash
npm run osint:db:sync -- harvest
npm run osint:serve
```

Port **3020** locally; **3000** in container.

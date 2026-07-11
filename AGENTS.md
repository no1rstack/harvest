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

## Env

- `HARVEST_DATABASE_URL` — Postgres (`harvest_user@harvest`)
- `COLLECTION_INTERNAL_TOKEN` — Cascades → step APIs
- `CASCADES_API_URL` — enqueue workflows
- `KEYCLOAK_*` — UI auth

## Local dev

```bash
npm run osint:db:sync -- harvest
npm run osint:serve
```

Port **3020** locally; **3000** in container.

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
| **cascades** | Connector workflow execution; `submit_judicium` publishes findings |
| **judicium** | Investigation workbench — consumes Intelligence API + `/api/v1` evidence from Harvest/Cascades |

After collection finalize, Harvest also best-effort POSTs observations to Judicium (`JUDICIUM_SERVICE_TOKEN` + `JUDICIUM_URL` / `JUDICIUM_INTERNAL_URL`). Set these in Infisical / `compose.vps.yml`.

Connector `undata` pulls [UNdata](https://data.un.org/) SDMX + UNSD SDG catalogue hits for statistical context.
Additional open-data connectors: `worldbank`, `datagov`, `fincen`, `aleph`, `blockchain`, `iban`, `aptnotes`, `opensky`
(capabilities `statistical_context`, `financial_crime_context`, `crypto_ledger`, `aviation_adsb`, `threat_reports`).
OpenSecrets / Chainalysis / Flightradar24 / FlightAware / VesselFinder / Phantom Tide stay Judicium portals or keyed APIs — not Harvest community OP.

## Env (Infisical)

**Project:** `f7f058b6-d267-45c1-9311-e0962a74e923` @ [crypt.noirstack.com](https://crypt.noirstack.com) (`prod`)

Bootstrap all keys from Judicium/Keycloak sources (one-time):

```bash
./scripts/infisical/bootstrap-harvest-secrets.sh
```

| Variable | Purpose |
|----------|---------|
| `JUDICIUM_PUBLIC_URL` | Public Judicium URL (links) |
| `JUDICIUM_URL` / `JUDICIUM_INTERNAL_URL` | Base URL for posting collection evidence back to Judicium |
| `JUDICIUM_SERVICE_TOKEN` / `JUDICIUM_API_KEY` | Bearer token for `/api/v1/evidence` ingest |
| `HARVEST_DATABASE_URL` | Postgres (`harvest_user@harvest`) — only DB URL in production |
| `COLLECTION_INTERNAL_TOKEN` | Cascades → Harvest step APIs |
| `CASCADES_API_URL` | Enqueue workflows (`http://cascades:3000` on VPS) |
| `CASCADES_PUBLIC_URL` | UI links |
| `KEYCLOAK_*` | Harvest UI auth |
| `HARVEST_SCHEDULER_*` / `HARVEST_FEEDS_*` | Platform tab schedulers |
| `GHCR_*` | CI image push |

Deploy reads **only** the Harvest project (no Judicium/Keycloak project merge).

**Architecture Explorer** (`/harvest` → Architecture tab): live table stats, ownership registry, Cascades pipeline, schema-bleed detection, growth tracking. API: `GET /api/data-catalog`.

Human narratives and data lineage live in `src/data-catalog/narratives.ts` — add `TABLE_NARRATIVES` and `DATA_LINEAGE_JOURNEYS` when introducing new tables (foundation for future public data templates).

## Local dev

```bash
npm run infisical:sync    # full project → .env.harvest.local
npm run osint:db:sync -- harvest
npm run osint:serve
```

Port **3020** locally; **3000** in container.

# Collection Platform

Shared passive collection plane for Noir Stack. **Cascades is the sole execution engine** — Harvest enqueues workflow runs and provides step APIs for data-plane operations only.

## Production path

```
Cron (daily-pull.sh)
  → seed Target Registry from targets.txt
  → osint:collect:due (Harvest CLI / API)
  → Harvest queries due targets
  → Harvest POST /api/workflows/passive-domain-collection/run (Cascades)
  → Cascades executes parallel harvest_connector nodes + semantic pipeline
  → Cascades calls Harvest step APIs (collect, normalize, validate, dedupe, persist, finalize)
  → Observations persisted with workflow_run_id, node_id, connector_id
  → Run visible in Cascades UI history
```

There is **no** second in-process pipeline. CLI commands are thin clients that enqueue Cascades runs.

## Architecture

**Frozen system diagram, Phase 2 operational plan, and future event-bus notes:**
[COLLECTION-ARCHITECTURE.md](./COLLECTION-ARCHITECTURE.md)

Summary:

```
Harvest (registry, plans, observation store, collection API)
        ↓ enqueue
Cascades (catalog, engine, history, replay, retry failed nodes)
        ↓ parallel connectors → Observation Stream → persist → events
Observation Store
        ↓ project on demand
Judicium · H3XA · HexSocial
```

## Standards

| Layer | Standard |
|-------|----------|
| Observation identity | **STIX 2.1** (`stix_type`, `stix_id`, `object_json` in findings) |
| Lineage | **W3C PROV** JSON-LD in `provenance` |
| Execution linkage | `workflow_template`, `workflow_version`, `workflow_run_id`, `node_id`, `connector_id`, `target_id`, `collection_event_id` |

## Terminal run status

| Status | Meaning |
|--------|---------|
| `completed` | All connectors succeeded; observations persisted |
| `completed_with_warnings` | Some connector failures/timeouts but valid observations kept |
| `failed` | No useful observations or enqueue/persist failure |
| `cancelled` | Run cancelled in Cascades |

## Collection event types

| Event | When |
|-------|------|
| `collection.requested` | Harvest enqueues Cascades run |
| `collection.started` | Cascades run accepted |
| `collection.connector.completed` | Single connector finished |
| `collection.connector.failed` | Single connector failed (run may continue) |
| `observation.persisted` | Row inserted into findings |
| `collection.completed` | Run finished successfully |
| `collection.completed_with_warnings` | Run finished with partial connector failures |
| `collection.failed` | Run failed |

## Target Registry

Table: `collection_targets`

| Field | Purpose |
|-------|---------|
| `target_type` | domain, ip, person, organization, wallet, email, hostname |
| `value` | Target value |
| `workflow_template` | e.g. `passive-domain-collection` |
| `frequency` | hourly, daily, weekly, manual, on_change |
| `last_cascades_run_id` | Latest Cascades workflow run id |

`targets.txt` is synced into the registry on daily runs (`npm run osint:registry:seed`).

## Workflow templates

| Template | Collectors |
|----------|------------|
| `passive-domain-collection` | crtsh, dns, rdap, wayback, hackertarget, urlhaus, rss |

Templates live in `src/collection/templates.ts`. Cascades mirrors them in `passive-domain-collection` bundled workflow with parallel `harvest_connector` nodes.

## API (harvest host :3020)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/collection/templates` | List workflow templates |
| GET | `/api/collection/targets` | List registry |
| GET | `/api/collection/targets/due` | Due for collection |
| POST | `/api/collection/targets` | Upsert target |
| POST | `/api/collection/targets/seed` | Sync from targets.txt |
| POST | `/api/collection/run` | **Enqueue** Cascades run for targetId or target value |
| POST | `/api/collection/run/due` | **Enqueue** Cascades run per due target |
| POST | `/api/collection/steps/*` | Semantic step handlers (**Cascades only**, internal token) |
| GET | `/api/collection/events` | Published events |

Internal step auth: header `X-Collection-Token` = `COLLECTION_INTERNAL_TOKEN`. Cascades logs host, status, request_id, run_id — never the token.

## Semantic pipeline (batched)

Large domains no longer send monolithic JSON payloads. Cascades runs:

```
Merge findings → Observation Stream (500/batch) → Finalize
```

Each batch: normalize → validate → dedupe → persist (small HTTP bodies).

Runtime config (no restart for batch size):

- `GET /api/collection/config` — `observation_batch_size` (default 500)
- `PATCH /api/collection/config` — internal token; updates in-memory config

Env seeds: `COLLECTION_OBSERVATION_BATCH_SIZE`, `COLLECTION_MAX_STEP_BODY_BYTES`.

## Partial retry (Retry Failed Nodes)

Cascades can re-run only failed connector nodes plus downstream steps (merge → stream → finalize). Successful node outputs are seeded — no duplicate external API calls.

- `POST /api/runs/:runId/retry-failed` — optional body `{ "nodeIds": ["collector-rdap"] }`
- Creates a new Cascades run linked via `retryFailedOf`; appends observations to the original Harvest run (`collectionRunId`)
- Dashboard: **Retry Failed Nodes** button on collection runs with connector failures

Full **Replay** still re-enqueues the entire workflow.

## Phase 2 (operational hardening)

Full spec: [COLLECTION-ARCHITECTURE.md](./COLLECTION-ARCHITECTURE.md#phase-2-make-the-platform-operational)

| Deliverable | Purpose |
|-------------|---------|
| Connector health | Per-provider status + historical uptime |
| Provider dashboard | crt.sh, DNS, RDAP, … — last run, duration, failures, rate limits |
| Collection metrics | NOC page: today's collections, calls, observations, duplicates, failures |
| Workflow analytics | Per-template runtime, failure rate, avg observations |
| Observation explorer | Search → connector / workflow / run / confidence → click through to Cascades |
| Unified observations | Health, connector events, workflow events as queryable observations |

Reliability items already shipped or in progress: batched persist, replay, retry failed nodes, runtime batch config.

## CLI

```bash
npm run osint:registry:seed          # targets.txt → registry
npm run osint:collect -- --target noirstack.com [--wait]
npm run osint:collect -- --target-id <uuid> [--wait]
npm run osint:collect:due [--wait] [--force]   # daily cron path → Cascades (--force re-runs all enabled targets)
npm run osint:daily                  # seed + collect due
```

## Cascades integration

- Workflow: `passive-domain-collection` in bundled catalog
- Nodes: `resolve_target`, `harvest_connector` (×7 parallel), merge, **`persist_observation_stream`**, `finalize_collection`
- The stream node batches findings (default 500) and calls Harvest step APIs per batch: normalize → validate → dedupe → persist
- Cascades env: `COLLECTION_API_URL=http://127.0.0.1:3020`, `COLLECTION_INTERNAL_TOKEN=…`
- Harvest env: `CASCADES_API_URL=http://127.0.0.1:3102`, `COLLECTION_INTERNAL_TOKEN=…`

Run context (set by Harvest on enqueue):

```json
{ "targetId": "<uuid>", "target": "noirstack.com", "workflow_template": "passive-domain-collection" }
```

## Config ownership

Long term, Harvest secrets (`COLLECTION_INTERNAL_TOKEN`, DB URL) should live in a dedicated Harvest deployment path (e.g. `/home/hira/harvest/.env` or Infisical Harvest project), not under Judicium-only env files.

## Database

Schema applied automatically on first run (`src/collection/schema.ts`):

- `collection_targets` (+ `last_cascades_run_id`)
- `collection_events` (+ `cascades_run_id`, `request_id`)
- Extended `osint_harvest_findings` with STIX/PROV + execution linkage columns

## Legacy direct pipeline — retired

As of migration completion (2026-07-10):

- **Removed:** in-process `runCollectionPipeline` / `scripts/osint-harvest/collection/run.ts`
- **Enqueue-only:** `osint:collect`, `osint:collect:due`, `POST /api/collection/run`, `POST /api/collection/run/due`
- **Compatibility:** `osint:harvest --target` and `POST /api/harvest/run` delegate to Cascades enqueue (no direct connector orchestration)
- **Step APIs** (`/api/collection/steps/*`) are invoked by Cascades only (including batched Observation Stream)

All enabled registry targets must carry `last_cascades_run_id` after a full `--force` migration run.

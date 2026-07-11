# Judicium OSINT Harvest → PostgreSQL

Passive internet collection for investigative cases. Inspired by tools indexed on [ENNA](https://www.en-na.com/#tools). Findings land in Postgres (`osint_harvest_*`, optional `feed_items` / `evidence` / `case_entities`).

## Scope

| Included (passive OSINT) | Not included |
|---|---|
| crt.sh CT, DNS-over-HTTPS, RDAP/WHOIS | [Social-Engineer Toolkit](https://github.com/trustedsec/social-engineer-toolkit) phishing / credential harvest |
| Wayback CDX, HackerTarget, URLhaus | Active exploitation / scanning payloads |
| Public RSS intel feeds | Unauthorized targeting |
| Optional CLI: theHarvester, Amass (if installed) | |

SET is a TrustedSec red-team framework for **authorized** social-engineering assessments. Judicium harvest is for **investigative data collection** into your case graph — different job, different tools.

## Quick start

```bash
# Requires DATABASE_URL (or PGHOST/PG*) in .env.local
npm run osint:harvest -- --target example.com

# Attach to a case (also writes evidence + case_entities)
npm run osint:harvest -- --target example.com --case 12

# Subset of harvesters
npm run osint:harvest -- --target example.com --harvesters crtsh,dns,rdap

# Collect without writing DB
npm run osint:harvest -- --target example.com --dry-run

# List harvesters
npm run osint:harvest -- --list
```

## Harvesters

| ID | Source | Notes |
|---|---|---|
| `crtsh` | crt.sh | Certificate Transparency subdomains |
| `dns` | Cloudflare DoH | A/AAAA/MX/NS/TXT/CNAME/SOA |
| `rdap` | rdap.org | Registration / contacts / NS |
| `wayback` | Internet Archive CDX | Historical URLs |
| `hackertarget` | HackerTarget free API | Hostsearch + DNS (rate-limited) |
| `urlhaus` | abuse.ch | Malicious URLs matching target |
| `rss` | CISA / NVD / Krebs | Public intel feeds |
| `theharvester` | CLI if installed | Passive sources only |
| `amass` | CLI if installed | `amass enum -passive` |

## Postgres tables

Created automatically on first run:

- `osint_harvest_runs` — run metadata
- `osint_harvest_findings` — deduped findings (`content_hash` unique)

Also upserts into existing Judicium tables when enabled:

- `feed_items` (default on)
- `evidence` + `case_entities` (when `--case` is set)

## Env / Infisical

Secrets live at [crypt.noirstack.com](https://crypt.noirstack.com). Sync with the Infisical CLI (existing product DB roles only):

```bash
npm run osint:db:sync -- both          # judicium + h3xa
npm run osint:db:sync -- judicium      # → .env.local
npm run osint:db:sync -- h3xa          # → .env.h3xa.local
```

| Product | Infisical project | DB user | Database |
|---|---|---|---|
| judicium | `5b45a8a0-…` | `judicium_user` | `judicium` |
| h3xa | `d88b5ad3-…` | `h3xa_user` | `h3xa` |

```bash
# Harvest with Infisical-backed credentials
npm run osint:harvest -- --product h3xa --target example.com --case 1
npm run osint:harvest -- --product judicium --target example.com --sync-infisical
```

Token: `INFISICAL_TOKEN` or `/home/hira/scripts/.infisical-token`.

`--case` must reference an existing `cases.id` (FK). List cases:

```bash
podman exec postgres-main psql -U h3xa_user -d h3xa -c 'SELECT id,name,status FROM cases'
podman exec postgres-main psql -U judicium_user -d judicium -c 'SELECT id,name,status FROM cases'
```

## Harvest Admin UI

Standalone ungated panel (not behind app login):

**`/harvest`**

- View runs, findings, daily cron summary
- Edit `targets.txt`
- Trigger single harvest / daily / dry-run

API:
- `GET /api/harvest/status`
- `GET /api/harvest/runs/:id`
- `GET|PUT /api/harvest/targets`
- `POST /api/harvest/run`
- `POST /api/harvest/daily`

## Daily pull

Harvests every target in `scripts/osint-harvest/targets.txt` for each product (Infisical sync first).

```bash
# Edit targets (domain [case_id])
$EDITOR scripts/osint-harvest/targets.txt

# Dry-run
npm run osint:daily:dry

# Live write to Postgres
npm run osint:daily
```

**Production:** daily collection runs inside the Harvest container via the platform scheduler (`HARVEST_DAILY_PULL_*` env vars in Infisical). No VPS crontab or systemd timer is required.

Manual trigger via Harvest Admin **Platform** tab or `POST /api/platform/scheduler/trigger`.

Logs: `logs/osint-harvest/scheduler-daily-*.log` and platform config run history.

Env overrides: `PRODUCTS`, `HARVESTERS`, `MAX_RESULTS`, `TIMEOUT_MS`, `TARGETS_FILE`, `SYNC_INFISICAL=0`.

## Responsible use

Only harvest targets you are authorized to investigate. Respect source ToS and rate limits. Do not use this pipeline for unauthorized surveillance or social-engineering attacks.

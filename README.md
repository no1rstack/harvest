# Harvest — Collection Platform

OSINT collection registry, observation store, provenance graph, and Intelligence Core v1.

- **UI:** https://harvest.noirstack.com
- **Auth:** Keycloak (`harvest-noirstack` client)
- **Execution:** Cascades workflows call `/api/collection/steps/*`
- **Consumers:** Judicium reads `/api/intelligence/v1/*`

## Quick start

```bash
npm run osint:db:sync -- harvest
npm install
npm run osint:platform:bootstrap -- --skip-h3xa
npm run osint:serve
```

## Deploy

```bash
./deploy.sh
```

See `docs/COLLECTION-PLATFORM.md` for architecture.

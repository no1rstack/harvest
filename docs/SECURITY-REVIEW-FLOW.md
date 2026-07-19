# Security Review Flow

This repo now has a staged review path that makes the code movement visible from change to runtime checks.

## Visual flow

```mermaid
flowchart LR
  A[Code change] --> B[Semgrep policy rules]
  B --> C[Gitleaks secret scan]
  C --> D[Trivy dependency and config scan]
  D --> E[npm test and build]
  E --> F[Schemathesis API fuzzing]
  F --> G[OWASP ZAP baseline]
  G --> H[Artifacts in artifacts/review]

  B --> B1[Auth route review\nbounded external calls\nmissing timeouts]
  C --> C1[Secrets and tokens]
  D --> D1[Vulns, config drift, secrets]
  F --> F1[Contract mismatch\nvalidation gaps\nunexpected 5xx]
  G --> G1[Headers, auth surface, passive findings]
```

## What to run

Local baseline:

```bash
npm run review:security
```

The `npm` entrypoint uses PowerShell so it works in this Windows workspace. The existing `scripts/review/security-review.sh` remains available for Linux CI or shell users.

Dynamic API review against a running instance:

```bash
export SCHEMATHESIS_BASE_URL=http://127.0.0.1:3020
export ZAP_TARGET_URL=http://127.0.0.1:3020
npm run review:security
```

PowerShell equivalent:

```powershell
$env:SCHEMATHESIS_BASE_URL = 'http://127.0.0.1:3020'
$env:ZAP_TARGET_URL = 'http://127.0.0.1:3020'
npm run review:security
```

## Outputs

Artifacts are written to `artifacts/review/`:

- `npm-test.txt`
- `npm-build.txt`
- `semgrep.json`
- `gitleaks.json`
- `trivy.txt`
- `schemathesis-junit.xml`
- `zap-report.html`
- `zap-report.md`

## Repo-specific intent

- `Semgrep` is tuned to flag new privileged `/api/platform/v1/*` POST routes for manual auth review.
- `OpenAPI` is intentionally minimal and centered on the new v1 RPC surface.
- `Schemathesis` and `ZAP` are optional because this app may require auth, env, and data sources in different environments.
- `artifacts/review/` is ignored so the reports stay local or CI-only.

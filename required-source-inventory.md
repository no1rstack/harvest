## Required Source Inventory

Create a complete inventory of every source registered, discovered, tested, imported, or referenced by Harvest.

Do not report only aggregate RSS discovery counts. Produce a source-level list showing exactly which sources work, which do not work, which are partially integrated, and what is required to make each source operational.

For every source, record:

* Source name
* Organization
* Domain
* Country or region
* Category
* Source type
* Access method
* Feed or API URL
* Current status
* Last verification time
* Authentication requirement
* Direct-route availability
* Workflow-handler availability
* Scheduler availability
* Parser availability
* Normalizer availability
* Persistence status
* Search availability
* UI consumer
* Records collected
* Last successful collection
* Failure reason
* Recommended action
* Integration maturity

Use the following statuses consistently:

* `working` — tested and producing usable records
* `working_partial` — produces some usable data but has limitations
* `registered_unverified` — registered but not yet tested
* `workflow_only` — available through workflow execution but not direct search
* `route_only` — direct route exists but no workflow integration
* `api_required` — requires an API integration
* `key_required` — implementation exists but credentials are missing
* `scraping_required` — no feed or API is available; extraction must use scraping
* `page_diff_required` — suitable for monitored page changes rather than full scraping
* `portal_only` — only links users to an external portal
* `disabled` — intentionally unavailable
* `broken` — implementation exists but currently fails
* `dead` — placeholder, abandoned, or incapable of producing usable data
* `duplicate` — duplicates another registered source
* `deprecated` — retained for compatibility but should not be used

Separate transport availability from actual data value. A successful HTTP response does not make a source operational unless Harvest extracts and persists usable records from it.

## Required Output Views

Produce the following source lists:

### Working Sources

Sources that have been tested and are currently producing usable records.

For each source, show:

* records collected
* latest successful collection
* collection frequency
* data type
* downstream consumers

### Partially Working Sources

Sources that return some data but have incomplete coverage, unreliable parsing, missing fields, limited authentication, or partial integration.

### Registered but Untested Sources

Sources present in the registry that have not yet been verified end to end.

### RSS-Operational Sources

Sources with validated RSS or Atom feeds that have been imported and successfully parsed.

### No-RSS Sources

Domains where RSS discovery failed.

Classify each one by the best next acquisition method:

* public API
* authenticated API
* HTML scraping
* browser automation
* page-diff monitoring
* document download
* email ingestion
* manual review
* no viable collection method

### Workflow-Only Sources

Sources with collection handlers but no standalone search route.

### Route-Only Sources

Sources with a direct route but no workflow handler or federated-search integration.

### Credential-Blocked Sources

Sources that could operate after API keys, tokens, certificates, or account credentials are configured.

### Broken Sources

Sources with implemented integrations that fail because of parsing, network, schema, authentication, or code errors.

### Portal-Only and Stub Sources

Sources that expose links, acknowledgments, or placeholder responses but do not extract data.

### Dead or Deprecated Sources

Sources that should be removed, archived, replaced, or excluded from normal operational counts.

### Duplicate Sources

Sources that collect the same feed, endpoint, dataset, or records under different names.

## Source Capability Matrix

Create a matrix showing where every source is connected to the Harvest pipeline.

| Source | RSS | API | Scraper | Direct Route | Workflow | Scheduler | Parser | Normalizer | Persistence | Search | UI |
| ------ | --: | --: | ------: | -----------: | -------: | --------: | -----: | ---------: | ----------: | -----: | -: |

Do not infer capability from filenames or registry entries alone. Mark a capability as present only when the implementation exists and can be traced to a real code path.

## Source Verification Rules

A source is considered fully working only when the complete path is verified:

```text
Source
↓
Acquisition
↓
Parser
↓
Normalization
↓
Persistence
↓
Search or downstream processing
↓
UI, API, report, or Context Fabric consumer
```

Record separately whether the source:

* responds
* returns data
* parses successfully
* produces normalized records
* persists records
* is searchable
* is consumed downstream

This prevents portal links, empty responses, workflow registrations, and placeholder implementations from being counted as operational sources.

## Revised Summary

### 1. Strategic Analysis Review

The analysis correctly identifies acquisition and enrichment as Harvest’s main bottleneck rather than storage.

The recommended direction is to make Harvest an observation multiplier by:

* increasing collection coverage
* expanding the target registry
* running multi-source collection workflows
* enriching every observation
* correlating records across domains
* capturing changes over time
* deriving entities, events, claims, evidence, and relationships from collected material

The strategy is sound, but it must now be paired with a verified source-level operational inventory.

### 2. RSS Feed Discovery Results

| Metric                           | Count |
| -------------------------------- | ----: |
| Unique domains probed            |   765 |
| Domains with working RSS         |   126 |
| RSS success rate                 | 16.5% |
| RSS feed URLs discovered         |   268 |
| Categories covered               |    60 |
| Feeds imported into Harvest      |   125 |
| Total registered feeds           |   144 |
| Domains without discoverable RSS |   639 |
| No-RSS rate                      | 83.5% |

### 3. RSS Coverage Highlights

Major RSS coverage includes:

* Europe and United Kingdom government sources
* science and technology institutions
* international courts and justice organizations
* climate, maritime, and oceanographic organizations
* African government, statistical, and central-bank sources
* North and South American government and economic sources

### 4. Remaining Acquisition Gap

The 639 domains without discoverable RSS must not be treated as failed sources without further classification.

Each should be evaluated for:

* public APIs
* authenticated APIs
* static-page scraping
* rendered-page extraction
* document repositories
* change monitoring
* email subscriptions
* downloadable datasets
* portal-only access
* commercial restrictions
* licensing restrictions
* no viable access method

### 5. Deliverables

Produce and maintain:

* `data/discovered-rss-feeds.json`
* `data/source-inventory.json`
* `data/source-capability-matrix.json`
* `data/source-verification-results.json`
* `data/no-rss-acquisition-plan.json`
* `data/dead-and-disabled-sources.json`
* `data/source-duplicates.json`
* `harvest.md`

The final report must clearly distinguish:

* discovered sources
* registered sources
* verified working sources
* partially working sources
* untested sources
* credential-blocked sources
* workflow-only sources
* route-only sources
* scraping candidates
* broken sources
* dead sources
* duplicate sources

The objective is not merely to increase the source count. It is to establish which sources produce real, persistent, searchable, and analytically useful data inside Harvest.

Build this as a **daily encyclopedia enrichment pipeline** driven by the entities and keywords discovered during your existing scheduled pulls.

The flow should be:

```text
Daily OSINT pulls
→ extract entities, topics, places, organizations, technologies, events
→ rank and deduplicate keywords
→ resolve each term to a canonical Wikidata entity
→ retrieve Wikipedia/encyclopedia context
→ compare with the prior snapshot
→ store facts, relationships, summaries, and changes
→ feed Context Fabric, Graph, Search, Pulse, and editorial generation
```

Do not simply search Wikipedia once for every raw keyword. That will create noise, duplicates, ambiguous matches, and unnecessary requests.

## Sources to add

Start with:

| Source            | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| Wikidata          | Canonical entity IDs, structured facts, relationships, coordinates, dates, aliases |
| Wikipedia         | Narrative background and current article summaries                                 |
| DBpedia           | Structured relationships extracted from Wikipedia                                  |
| Wikimedia Commons | Images and media references where licensing permits                                |
| Wikisource        | Primary and historical documents                                                   |
| Wikinews          | Event-oriented background, where useful                                            |

Wikidata should be the canonical resolution layer. Its query service supports structured SPARQL queries, but Wikimedia advises using its search mechanisms rather than SPARQL regex for fuzzy text matching, and warns against using the public query service for very large extractions. ([Wikidata][1])

DBpedia can provide additional linked-data relationships through its public SPARQL endpoint, although its public service has fair-use and query limits. ([DBpedia Association][2])

## Daily keyword pipeline

### 1. Collect candidate terms

Extract candidates from the daily sources:

```text
people
organizations
government agencies
companies
countries
cities
ports
airports
vessels
aircraft
technologies
weapons systems
malware
threat actors
laws
regulations
court cases
industries
commodities
infrastructure
events
```

Each candidate needs more than a string:

```ts
interface EnrichmentCandidate {
  term: string;
  entityType?: string;
  sourceIds: string[];
  sourceRecordIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
  authorityWeightedCount: number;
  contexts: string[];
  aliases: string[];
}
```

### 2. Rank what deserves enrichment

Do not enrich every extracted noun. Assign a priority score.

```text
priority =
  source authority
  + number of independent sources
  + repetition across daily pulls
  + novelty
  + strategic relevance
  + product relevance
  + relationship potential
```

Example:

| Candidate            | Reason                                           | Priority |
| -------------------- | ------------------------------------------------ | -------: |
| Rosatom              | Mentioned by sanctions, energy, and news sources |     High |
| Port of Novorossiysk | Appears in maritime and sanctions data           |     High |
| CVE-2026-12345       | Appears in NVD and threat feeds                  |     High |
| John Smith           | One ambiguous social mention                     |      Low |

Only candidates above a threshold should enter the daily encyclopedia queue.

### 3. Resolve ambiguity before retrieval

A keyword such as `Mercury` could mean:

* a planet;
* an element;
* a newspaper;
* a vehicle;
* a company;
* a mythological figure.

Resolve it using context:

```text
term: Mercury
context: satellite launch, orbit, NASA
expected type: celestial body
```

Store the result:

```json
{
  "inputTerm": "Mercury",
  "canonicalLabel": "Mercury",
  "wikidataId": "Q308",
  "entityType": "planet",
  "resolutionConfidence": 0.97,
  "resolutionEvidence": [
    "NASA context",
    "orbital terminology",
    "space-domain source"
  ]
}
```

Low-confidence matches should go to a review queue rather than becoming canonical entities automatically.

## What to retrieve

For each resolved Wikidata entity, retrieve:

* canonical label;
* aliases;
* description;
* instance/type;
* parent classifications;
* country and jurisdiction;
* coordinates;
* inception and dissolution dates;
* ownership;
* leadership;
* subsidiaries;
* industry;
* official website;
* related organizations;
* relevant identifiers;
* Wikipedia article;
* references and source claims;
* image or media references;
* last-modified timestamps.

From Wikipedia, retrieve:

* lead summary;
* article URL;
* section headings;
* infobox-equivalent facts when available through structured services;
* revision ID;
* last revision time;
* language;
* redirect target;
* disambiguation status.

Do not treat Wikipedia narrative as authoritative evidence by itself. Store it as contextual enrichment and retain the underlying page revision and source attribution.

## Store snapshots and changes

You do not need to save the entire article every day if nothing changed.

Use:

```text
canonical entity ID
page revision ID
content hash
retrieved timestamp
previous revision ID
changed fields
```

Daily behavior:

```text
No previous record
→ create initial snapshot

Same revision/hash
→ update last checked only

New revision
→ retrieve changed content
→ calculate semantic and factual differences
→ create change event
```

Examples of useful changes:

* leadership changed;
* company ownership changed;
* a new subsidiary appeared;
* location or jurisdiction changed;
* an article gained a sanctions section;
* a technology classification changed;
* a person obtained a new office;
* aliases or identifiers were added;
* the article was merged, redirected, or removed.

## Recommended internal datasets

Create at least five canonical datasets:

### `enrichment_candidates`

Terms awaiting resolution.

```text
candidate_id
term
candidate_type
source_ids
contexts
priority_score
status
first_observed_at
last_observed_at
```

### `canonical_entities`

Resolved entities.

```text
entity_id
canonical_label
entity_type
wikidata_id
wikipedia_page_id
aliases
resolution_confidence
resolution_status
```

### `encyclopedia_snapshots`

Versioned source records.

```text
snapshot_id
entity_id
source
language
revision_id
content_hash
retrieved_at
raw_payload_location
```

### `encyclopedia_facts`

Normalized facts.

```text
entity_id
property
value
value_entity_id
valid_from
valid_to
source_snapshot_id
confidence
```

### `encyclopedia_changes`

Detected changes.

```text
change_id
entity_id
change_type
previous_value
current_value
detected_at
source_snapshot_id
significance
```

## Relationship generation

This enrichment becomes valuable when it produces graph edges.

Examples:

```text
Person → leads → Organization
Company → subsidiary_of → Parent Company
Organization → headquartered_in → Location
Vessel → owned_by → Company
Company → operates_in → Industry
Technology → developed_by → Organization
Threat Actor → associated_with → Country
Law → applies_in → Jurisdiction
Port → located_in → Country
CVE → affects → Product
```

Every relationship should retain:

```text
source
source revision
retrieval date
confidence
resolution method
supporting source records
```

## Collection policy

Add a new source class in the inventory:

```text
Encyclopedia Enrichment
```

Suggested entries:

| Source                     | Collection     | Extraction  | Role                       |
| -------------------------- | -------------- | ----------- | -------------------------- |
| Wikidata Entity Search     | Daily targeted | REST        | Entity resolution          |
| Wikidata Facts             | Daily targeted | REST/SPARQL | Structured enrichment      |
| Wikipedia Summaries        | Daily targeted | REST        | Narrative context          |
| Wikipedia Revision Monitor | Daily targeted | REST        | Change detection           |
| DBpedia Relationships      | Daily targeted | SPARQL      | Secondary graph enrichment |
| Wikimedia Commons          | On demand      | REST        | Media enrichment           |

Use `scheduled_targeted`, not a general daily crawl.

## Daily limits

The worker should enforce:

```text
Maximum candidates per day
Maximum requests per source
Per-host concurrency
Retry and backoff
Cache duration
Entity cooldown
Priority threshold
Maximum unresolved retries
```

A practical first version:

```text
Top 250 candidates per day
Maximum 3 languages per entity
Skip entities checked within 7 days unless newly mentioned
Immediately refresh high-priority entities
Cache unchanged responses
Retry failed requests with exponential backoff
```

High-interest watched entities can refresh daily. Stable historical topics may only need weekly or monthly refreshes.

## Product use

The enriched data should feed:

| Product              | Use                                                  |
| -------------------- | ---------------------------------------------------- |
| Context Fabric       | Background, classifications, canonical identity      |
| Graph                | Entities and relationships                           |
| Search               | Expanded aliases and descriptions                    |
| Pulse                | Topic and entity context                             |
| Crime                | Person, company, jurisdiction, ownership context     |
| Opinions             | Legal subjects, institutions, laws and jurisdictions |
| Signals              | Threat actors, technologies and event background     |
| Air / Maritime       | Aircraft, vessels, owners, ports, operators          |
| Editorial generation | Background paragraphs, timelines, explainers         |

## Important distinction

The daily OSINT sources tell you:

> What happened or changed?

The encyclopedia enrichment layer tells you:

> What is this entity, how is it related to the world, and why does it matter?

That combination is what will let Judicium generate richer articles and Context Fabrics rather than simple search results.

The inventory entry should look approximately like this:

```text
Wikimedia Daily Enrichment

Status: Configured
Category: Import / Sync
Invocation: Scheduled targeted
Extraction: Hybrid
Authority: 3–5 depending on fact type
Maturity: 5 initially
Frequency: Daily
Inputs: Ranked entities and keywords from scheduled pulls
Outputs:
- canonical entities
- aliases
- descriptions
- structured facts
- graph relationships
- revision changes
Used By:
- Search
- Graph
- ContextFabric
- Crime
- Opinions
- Signals
- Air
- Maritime
- Pulse
```

Do not create one generic “Wikipedia connector.” Create a small enrichment subsystem with separate resolution, structured-fact, narrative, revision-monitoring, and relationship-generation stages.

[1]: https://www.wikidata.org/wiki/Wikidata%3ASPARQL_query_service/Wikidata_Query_Help?utm_source=chatgpt.com "Wikidata:SPARQL query service/Wikidata Query Help - Wikidata"
[2]: https://www.dbpedia.org/resources/sparql/?utm_source=chatgpt.com "SPARQL over Online Databases - DBpedia Association"

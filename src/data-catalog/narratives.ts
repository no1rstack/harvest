import type { CatalogOwner, TableNarrative, LineageStep, DataLineageView } from './types.js';

export type { TableNarrative, LineageStep };
export type DataLineageJourney = DataLineageView['journey'];

/** Curated human explanations — documentation people actually read. */
export const TABLE_NARRATIVES: Record<string, TableNarrative> = {
  stix_attribute_history: {
    purpose: 'Immutable STIX attribute history',
    purposeDetail:
      'Maintains an immutable history of STIX attribute evolution. Enables auditability, rollback analysis, provenance verification, and historical intelligence comparison.',
    whyItExists:
      'Intelligence changes over time. This table preserves every change rather than overwriting previous knowledge — so analysts can answer "what did we know, and when?"',
    consumers: ['Judicium Intelligence API', 'Timeline', 'Entity diff', 'Provenance chain'],
    generatedBy: ['Harvest Intelligence Core', 'STIX materialization'],
  },
  community_items: {
    purpose: 'Community operating picture items',
    purposeDetail:
      'Represents intelligence published into the community operating picture — sensor layers, narratives, authority signals, and corroborated events surfaced on the Judicium map. Each item carries payload enrichment (keywords, entities) for slice/dice queries and keyword-driven collection expansion.',
    whyItExists:
      'Raw collection data is not directly consumable by analysts at scale. This table holds curated, time-bounded items ready for situational awareness, watchlisting, and seeding new Cascades threat-feed targets from extracted keywords.',
    produces: ['Operating picture', 'Community map', 'Timeline', 'Watchlists', 'Corroboration views', 'Collection target seeds'],
    generatedBy: ['Harvest feeds worker', 'Community layers scheduler', 'Feed enrichment backfill'],
    consumers: ['Judicium /community', 'Judicium /api/community/items', '/api/feeds/community/expand'],
  },
  osint_harvest_findings: {
    purpose: 'Primary observation store',
    purposeDetail:
      'The canonical store for passive and active OSINT observations — domains, IPs, certificates, feeds, and connector outputs normalized for search and intelligence APIs.',
    whyItExists:
      'Findings are the atomic unit of collected intelligence. Everything upstream (Cascades) and downstream (entities, STIX, community) references observations stored here.',
    consumers: ['Intelligence API v1', 'Harvest Admin', 'Judicium proxy', 'Entity resolution', 'STIX export'],
    generatedBy: ['Cascades connector steps', 'Harvest collection platform'],
  },
  source_artifacts: {
    purpose: 'Raw connector payloads',
    purposeDetail:
      'Preserves normalized payloads from Cascades connectors before extraction — the evidentiary "as collected" layer tied to ontology versions.',
    whyItExists:
      'Observations alone lose connector context. Artifacts retain source identity, hashes, and raw structure for re-processing and provenance.',
    consumers: ['Extraction runs', 'Observed entities', 'Provenance', 'STIX object sources'],
    generatedBy: ['Cascades workflows', 'Collection step handlers'],
  },
  observed_entities: {
    purpose: 'Extracted entity graph',
    purposeDetail:
      'Entities materialized from artifacts and findings — domains, IPs, persons, organizations — ready for graph traversal and STIX conversion.',
    whyItExists:
      'Analysts reason about entities, not raw JSON blobs. This table is the bridge between collection output and knowledge products.',
    consumers: ['Graph engine', 'STIX objects', 'Resolved entities', 'Judicium search enrichment'],
    generatedBy: ['Extraction runs', 'Intelligence bridge'],
  },
  stix_objects: {
    purpose: 'STIX 2.1 object store',
    purposeDetail:
      'Interchange-format intelligence objects derived from observed entities — indicators, identities, relationships — for export and fusion.',
    whyItExists:
      'STIX is the lingua franca for threat intel sharing. This table makes Harvest output portable to MISP, OpenCTI, and H3XA without bespoke transforms.',
    consumers: ['STIX export', 'Attribute history', 'H3XA fusion (optional)', 'Judicium threat intel'],
    generatedBy: ['Intelligence Core materialization'],
  },
  provenance: {
    purpose: 'Lineage and derivation chain',
    purposeDetail:
      'Records how each intelligence object was derived — which run, artifact, connector, and parent observation produced it.',
    whyItExists:
      'In investigations, source matters as much as conclusion. Provenance makes collection auditable and defensible.',
    consumers: ['Provenance API', 'Evidence capture in Judicium', 'Claims evaluation'],
    generatedBy: ['Collection pipeline', 'Intelligence bridge'],
  },
  collection_targets: {
    purpose: 'What to collect',
    purposeDetail:
      'The registry of domains, entities, and assets under active or scheduled collection — the intake queue for Cascades workflows.',
    whyItExists:
      'Collection without a target list is ad hoc. Targets connect analyst intent to automated Cascades runs.',
    consumers: ['Cascades enqueue', 'Due-target scheduler', 'Harvest Admin registry'],
    generatedBy: ['Harvest Admin', 'CLI seed', 'Platform bootstrap'],
  },
  collections: {
    purpose: 'Collection run aggregates',
    purposeDetail:
      'Parent records grouping artifacts, findings, entities, and knowledge for a single collection effort or campaign.',
    whyItExists:
      'Analysts and APIs need a handle on "this investigation's data" — collections bundle the subgraph.',
    consumers: ['Intelligence API', 'STIX export', 'Dashboard targets', 'Read models'],
    generatedBy: ['Harvest runs', 'Cascades workflow completion'],
  },
  workflow_runs: {
    purpose: 'Cascades execution ledger',
    purposeDetail:
      'Each Cascades workflow invocation — status, timing, inputs — persisted so Harvest can correlate connector output to runs.',
    whyItExists:
      'Harvest orchestrates via Cascades but owns the intelligence store. Workflow runs link execution to observations.',
    consumers: ['Harvest collection ops', 'Run events', 'Task runs', 'Execution logs'],
    generatedBy: ['Cascades DAG engine'],
  },
  feed_items: {
    purpose: 'Ingested RSS and news rows',
    purposeDetail:
      'Raw feed entries from RSS, news aggregators, and community pull workers before promotion to community_items.',
    whyItExists:
      'Feeds arrive continuously and need deduplication, health tracking, and staging before they enter the operating picture.',
    consumers: ['Community items', 'News APIs', 'Feed health'],
    generatedBy: ['Harvest feeds worker', 'Judicium news aggregator'],
  },
  feed_health: {
    purpose: 'Current feed health state',
    purposeDetail:
      'Mutable snapshot of each feed last check, latency, and error state — operational telemetry, not historical record.',
    whyItExists:
      'Operators need to know which feeds are stale or failing. This table is a materialized view of health, not an event log.',
    consumers: ['Judicium feed health dashboard', 'Ingestion metrics'],
    generatedBy: ['Feed health checker', 'Community pull worker'],
  },
  domain_events: {
    purpose: 'Cross-domain event backbone',
    purposeDetail:
      'Unified append-only log of meaningful platform events — collection started, artifact created, entity resolved — the seed of event-sourced projections.',
    whyItExists:
      'Dozens of small event tables become hard to reason about. domain_events is the beginning of a single timeline for the whole platform.',
    consumers: ['Event explorer', 'Future projections', 'Audit', 'Automation rules'],
    generatedBy: ['Harvest', 'Cascades', 'Intelligence Core'],
  },
  knowledge_objects: {
    purpose: 'Synthesized knowledge artifacts',
    purposeDetail:
      'Profiles, summaries, and network syntheses built atop collections — the "so what" layer above raw observations.',
    whyItExists:
      'Raw findings overwhelm analysts. Knowledge objects package intelligence into reviewable analytic products.',
    consumers: ['Intelligence API', 'Judicium reports', 'Claims'],
    generatedBy: ['Knowledge engine', 'Automation rules'],
  },
  claims: {
    purpose: 'Analytic claims with evidence',
    purposeDetail:
      'Structured assertions (with status and linkage to observations) that analysts can evaluate, dispute, or promote to evidence.',
    whyItExists:
      'Intelligence platforms must separate "what we observed" from "what we assess." Claims hold assessed judgments.',
    consumers: ['Judicium evidence shelf', 'Reports', 'Review workflows'],
    generatedBy: ['Analysts via API', 'Automation engine'],
  },
  cases: {
    purpose: 'Investigation workspace (Judicium)',
    purposeDetail:
      'Investigation dossiers — entities, timeline, tasks, and reports — owned by the Judicium workbench, not Harvest collection.',
    whyItExists:
      'Collection platforms produce intelligence; workbenches organize it into cases. This table belongs to Judicium's investigation model.',
    consumers: ['Judicium dashboard', 'Evidence', 'Reports', 'Graph'],
    generatedBy: ['Judicium analysts'],
  },
  evidence: {
    purpose: 'Evidence shelf (Judicium)',
    purposeDetail:
      'Captured claims and findings promoted into an investigation with lifecycle (collected → verified → archived).',
    whyItExists:
      'Cases need durable artifacts that survive search sessions. Evidence is the legal/investigative record in Judicium.',
    consumers: ['Evidence review queue', 'Reports', 'Hexarch proofs'],
    generatedBy: ['Judicium analysts', 'Search capture'],
  },
};

/** End-to-end intelligence journeys — educational lineage, not ERD. */
export const DATA_LINEAGE_JOURNEYS: DataLineageJourney[] = [
  {
    id: 'feed-keyword-expansion',
    title: 'RSS → keywords → more collection',
    subtitle: 'Slice feed data, extract terms, enqueue Cascades threat-feed workflows',
    steps: [
      { id: 'rss-pull', label: 'RSS digest pull', owner: 'harvest', kind: 'source', description: 'Harvest feeds worker persists RSS into community_items' },
      { id: 'enrich', label: 'Feed enrichment', owner: 'harvest', kind: 'process', description: 'Keywords and entities stored in payload_json.enrichment' },
      { id: 'slice', label: 'Slice / facets API', owner: 'harvest', kind: 'consumer', description: '/api/feeds/community/items, /facets' },
      { id: 'expand', label: 'Keyword expansion', owner: 'harvest', kind: 'process', description: '/api/feeds/community/expand expands seeds into search terms' },
      { id: 'target', label: 'Collection target', table: 'collection_targets', owner: 'harvest', kind: 'store' },
      { id: 'cascades', label: 'Cascades threat-feed', table: 'workflow_runs', owner: 'cascades', kind: 'process' },
      { id: 'finding', label: 'RSS / connector findings', table: 'osint_harvest_findings', owner: 'harvest', kind: 'store' },
    ],
  },
  {
    id: 'community-operating-picture',
    title: 'Community operating picture',
    subtitle: 'How a feed item becomes situational awareness on the map',
    steps: [
      { id: 'rss', label: 'RSS / sensor feed', table: 'feed_items', owner: 'harvest', kind: 'source', description: 'External feed ingested by Harvest or Judicium pull worker' },
      { id: 'cascades-extract', label: 'Cascades extraction', owner: 'cascades', kind: 'process', description: 'Optional connector normalization and enrichment' },
      { id: 'artifact', label: 'Source artifact', table: 'source_artifacts', owner: 'harvest', kind: 'store' },
      { id: 'finding', label: 'Finding', table: 'osint_harvest_findings', owner: 'harvest', kind: 'store' },
      { id: 'entity', label: 'Observed entity', table: 'observed_entities', owner: 'harvest', kind: 'store' },
      { id: 'stix', label: 'STIX object', table: 'stix_objects', owner: 'harvest', kind: 'store' },
      { id: 'history', label: 'Attribute history', table: 'stix_attribute_history', owner: 'harvest', kind: 'store' },
      { id: 'community', label: 'Community item', table: 'community_items', owner: 'harvest', kind: 'store' },
      { id: 'map', label: 'Operating picture', owner: 'judicium-ui', kind: 'consumer', description: 'Judicium /community map and corroboration' },
    ],
  },
  {
    id: 'collection-intelligence',
    title: 'Collection → intelligence',
    subtitle: 'Target to observation in the Harvest store',
    steps: [
      { id: 'target', label: 'Collection target', table: 'collection_targets', owner: 'harvest', kind: 'source' },
      { id: 'cascades', label: 'Cascades workflow', table: 'workflow_runs', owner: 'cascades', kind: 'process' },
      { id: 'run', label: 'Harvest run', table: 'osint_harvest_runs', owner: 'harvest', kind: 'store' },
      { id: 'collection', label: 'Collection', table: 'collections', owner: 'harvest', kind: 'store' },
      { id: 'artifact', label: 'Source artifact', table: 'source_artifacts', owner: 'harvest', kind: 'store' },
      { id: 'extraction', label: 'Extraction', table: 'extraction_runs', owner: 'harvest', kind: 'process' },
      { id: 'finding', label: 'Finding', table: 'osint_harvest_findings', owner: 'harvest', kind: 'store' },
      { id: 'provenance', label: 'Provenance', table: 'provenance', owner: 'harvest', kind: 'store' },
      { id: 'api', label: 'Intelligence API', owner: 'judicium-ui', kind: 'consumer', description: 'Judicium consumes /api/intelligence/v1/*' },
    ],
  },
  {
    id: 'stix-evolution',
    title: 'STIX evolution',
    subtitle: 'Entity to interchange format with full audit trail',
    steps: [
      { id: 'finding', label: 'Finding', table: 'osint_harvest_findings', owner: 'harvest', kind: 'source' },
      { id: 'entity', label: 'Observed entity', table: 'observed_entities', owner: 'harvest', kind: 'store' },
      { id: 'stix', label: 'STIX object', table: 'stix_objects', owner: 'harvest', kind: 'store' },
      { id: 'history', label: 'Attribute history', table: 'stix_attribute_history', owner: 'harvest', kind: 'store' },
      { id: 'export', label: 'STIX export / fusion', owner: 'judicium-ui', kind: 'consumer' },
    ],
  },
  {
    id: 'cascades-execution',
    title: 'Cascades execution',
    subtitle: 'How a workflow run is recorded',
    steps: [
      { id: 'target', label: 'Collection target', table: 'collection_targets', owner: 'harvest', kind: 'source' },
      { id: 'workflow', label: 'Workflow definition', table: 'workflows', owner: 'cascades', kind: 'store' },
      { id: 'run', label: 'Workflow run', table: 'workflow_runs', owner: 'cascades', kind: 'store' },
      { id: 'task', label: 'Task run', table: 'task_runs', owner: 'cascades', kind: 'store' },
      { id: 'log', label: 'Execution log', table: 'execution_logs', owner: 'cascades', kind: 'store' },
      { id: 'event', label: 'Run event', table: 'run_events', owner: 'cascades', kind: 'store' },
      { id: 'finding', label: 'Finding persisted', table: 'osint_harvest_findings', owner: 'harvest', kind: 'consumer' },
    ],
  },
  {
    id: 'investigation-workbench',
    title: 'Investigation workbench',
    subtitle: 'Intelligence consumed into a Judicium case',
    steps: [
      { id: 'intel', label: 'Intelligence API', owner: 'harvest', kind: 'source' },
      { id: 'search', label: 'Judicium search', owner: 'judicium-ui', kind: 'process' },
      { id: 'case', label: 'Case', table: 'cases', owner: 'judicium', kind: 'store' },
      { id: 'evidence', label: 'Evidence', table: 'evidence', owner: 'judicium', kind: 'store' },
      { id: 'report', label: 'Report / export', owner: 'judicium-ui', kind: 'consumer' },
    ],
  },
];

/** Primary journey per table (first match wins). */
const TABLE_PRIMARY_JOURNEY: Record<string, string> = {
  community_items: 'community-operating-picture',
  feed_items: 'community-operating-picture',
  feed_health: 'community-operating-picture',
  stix_attribute_history: 'stix-evolution',
  stix_objects: 'stix-evolution',
  observed_entities: 'stix-evolution',
  osint_harvest_findings: 'collection-intelligence',
  source_artifacts: 'collection-intelligence',
  extraction_runs: 'collection-intelligence',
  collections: 'collection-intelligence',
  collection_targets: 'collection-intelligence',
  osint_harvest_runs: 'collection-intelligence',
  provenance: 'collection-intelligence',
  workflow_runs: 'cascades-execution',
  task_runs: 'cascades-execution',
  execution_logs: 'cascades-execution',
  run_events: 'cascades-execution',
  workflows: 'cascades-execution',
  cases: 'investigation-workbench',
  evidence: 'investigation-workbench',
  knowledge_objects: 'investigation-workbench',
  claims: 'investigation-workbench',
};

export function getNarrativeForTable(table: string): TableNarrative | null {
  return TABLE_NARRATIVES[table] ?? null;
}

export function getLineageForTable(table: string): DataLineageView | null {
  const journeyId = TABLE_PRIMARY_JOURNEY[table];
  if (!journeyId) {
    const fallback = DATA_LINEAGE_JOURNEYS.find((j) => j.steps.some((s) => s.table === table));
    if (!fallback) return null;
    const highlightIndex = fallback.steps.findIndex((s) => s.table === table);
    return {
      journey: fallback,
      highlightStepId: fallback.steps[highlightIndex]?.id ?? fallback.steps[0].id,
      highlightIndex: Math.max(0, highlightIndex),
    };
  }
  const journey = DATA_LINEAGE_JOURNEYS.find((j) => j.id === journeyId);
  if (!journey) return null;
  let highlightIndex = journey.steps.findIndex((s) => s.table === table);
  if (highlightIndex < 0) {
    highlightIndex = journey.steps.findIndex((s) => s.id === table);
  }
  if (highlightIndex < 0) highlightIndex = 0;
  return {
    journey,
    highlightStepId: journey.steps[highlightIndex].id,
    highlightIndex,
  };
}

export function defaultNarrative(table: string, purpose: string, owner: string): TableNarrative {
  return {
    purpose,
    purposeDetail: purpose,
    whyItExists: `This table is part of the ${owner} data model. Add a human narrative in src/data-catalog/narratives.ts.`,
  };
}

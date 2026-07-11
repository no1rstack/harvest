/** Intelligence Core persistence — collections (root aggregate) + domain events. */

export const INTELLIGENCE_CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'scheduled_crawl',
  status TEXT NOT NULL DEFAULT 'pending',
  product TEXT NOT NULL DEFAULT 'shared',
  case_id INTEGER,
  target_id UUID,
  initiated_by TEXT NOT NULL DEFAULT 'collection-platform',
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  parent_id TEXT REFERENCES collections(id),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  cascades_run_id TEXT,
  legacy_run_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_status ON collections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_target ON collections(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_product ON collections(product);
CREATE INDEX IF NOT EXISTS idx_collections_cascades ON collections(cascades_run_id);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  collection_id TEXT REFERENCES collections(id),
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events(aggregate_type, aggregate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_collection ON domain_events(collection_id, created_at DESC);

-- Link legacy harvest rows to collections (Phase 0)
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS collection_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS ontology_version TEXT DEFAULT '1.0.0';
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS observable_type TEXT;

ALTER TABLE osint_harvest_runs ADD COLUMN IF NOT EXISTS collection_id TEXT;

ALTER TABLE collection_relationships ADD COLUMN IF NOT EXISTS collection_id TEXT;
ALTER TABLE collection_relationships ADD COLUMN IF NOT EXISTS ontology_version TEXT DEFAULT '1.0.0';
ALTER TABLE collection_relationships ADD COLUMN IF NOT EXISTS relationship_origin TEXT DEFAULT 'observed';

ALTER TABLE collection_events ADD COLUMN IF NOT EXISTS collection_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ohf_collection ON osint_harvest_findings(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_rel_collection ON collection_relationships(collection_id);
`;

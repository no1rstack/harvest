/** Phase 1 Intelligence Core tables — artifacts, extractions, provenance, observed entities. */

export const INTELLIGENCE_CORE_PHASE1_SQL = `
CREATE TABLE IF NOT EXISTS provenance (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  provenance_class TEXT NOT NULL,
  reproducible BOOLEAN NOT NULL DEFAULT TRUE,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  parent_id TEXT REFERENCES provenance(id),
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  collector_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provenance_collection ON provenance(collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_subject ON provenance(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_provenance_parent ON provenance(parent_id);

CREATE TABLE IF NOT EXISTS source_artifacts (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  connector_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  observable_type TEXT,
  uri TEXT,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetch_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(collection_id, connector_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_collection ON source_artifacts(collection_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_connector ON source_artifacts(connector_id, created_at DESC);

CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  source_artifact_id TEXT REFERENCES source_artifacts(id),
  method TEXT NOT NULL DEFAULT 'stix-normalize',
  connector_id TEXT,
  extractor_version TEXT NOT NULL DEFAULT '1.0.0',
  workflow_run_id TEXT,
  node_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed',
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_extraction_collection ON extraction_runs(collection_id);
CREATE INDEX IF NOT EXISTS idx_extraction_artifact ON extraction_runs(source_artifact_id);

CREATE TABLE IF NOT EXISTS observed_entities (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  observation_id TEXT NOT NULL UNIQUE,
  extraction_run_id TEXT REFERENCES extraction_runs(id),
  entity_type TEXT NOT NULL,
  canonical_value TEXT NOT NULL,
  stix_type TEXT,
  stix_id TEXT,
  confidence REAL,
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_observed_entities_collection ON observed_entities(collection_id);
CREATE INDEX IF NOT EXISTS idx_observed_entities_type ON observed_entities(entity_type, canonical_value);
CREATE INDEX IF NOT EXISTS idx_observed_entities_stix ON observed_entities(stix_id);

ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS source_artifact_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS extraction_run_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS provenance_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ohf_artifact ON osint_harvest_findings(source_artifact_id);
CREATE INDEX IF NOT EXISTS idx_ohf_extraction ON osint_harvest_findings(extraction_run_id);
CREATE INDEX IF NOT EXISTS idx_ohf_provenance ON osint_harvest_findings(provenance_id);
`;

/** SQL for Collection Platform tables in the shared harvest database. */

export const COLLECTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS osint_harvest_runs (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  case_id INTEGER,
  product TEXT NOT NULL DEFAULT 'shared',
  user_id TEXT NOT NULL DEFAULT 'harvest',
  harvesters TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  total_findings INTEGER DEFAULT 0,
  inserted INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS osint_harvest_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES osint_harvest_runs(id) ON DELETE CASCADE,
  case_id INTEGER,
  product TEXT NOT NULL DEFAULT 'shared',
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  severity TEXT DEFAULT 'info',
  confidence REAL DEFAULT 0.7,
  tags TEXT[] DEFAULT '{}',
  content_hash TEXT NOT NULL,
  raw JSONB DEFAULT '{}'::jsonb,
  related JSONB DEFAULT '[]'::jsonb,
  observed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ohf_run ON osint_harvest_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_ohf_product ON osint_harvest_findings(product);
CREATE INDEX IF NOT EXISTS idx_ohf_source ON osint_harvest_findings(source);
CREATE INDEX IF NOT EXISTS idx_ohf_entity ON osint_harvest_findings(entity_type);
CREATE INDEX IF NOT EXISTS idx_ohf_value ON osint_harvest_findings(value);
CREATE INDEX IF NOT EXISTS idx_ohf_observed ON osint_harvest_findings(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ohf_severity ON osint_harvest_findings(severity);
CREATE INDEX IF NOT EXISTS idx_ohf_created ON osint_harvest_findings(created_at DESC);

CREATE TABLE IF NOT EXISTS collection_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT 'shared',
  case_id INTEGER,
  workflow_template TEXT NOT NULL DEFAULT 'passive-domain-collection',
  priority INTEGER NOT NULL DEFAULT 50,
  frequency TEXT NOT NULL DEFAULT 'daily',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  origin TEXT NOT NULL DEFAULT 'manual',
  origin_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_collected_at TIMESTAMPTZ,
  next_collect_at TIMESTAMPTZ,
  last_cascades_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_targets_unique
  ON collection_targets (target_type, normalized_value, product, COALESCE(case_id, -1));

CREATE INDEX IF NOT EXISTS idx_collection_targets_due
  ON collection_targets (enabled, next_collect_at, priority DESC)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_collection_targets_product
  ON collection_targets (product);

CREATE TABLE IF NOT EXISTS collection_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  target_id UUID REFERENCES collection_targets(id) ON DELETE SET NULL,
  run_id TEXT,
  cascades_run_id TEXT,
  request_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_events_target
  ON collection_events (target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_events_type
  ON collection_events (event_type, created_at DESC);

ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS target_id UUID;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS stix_type TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS stix_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS provenance JSONB DEFAULT '{}'::jsonb;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS workflow_template TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS workflow_version TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS node_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS connector_id TEXT;
ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS collection_event_id TEXT;

ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS last_cascades_run_id TEXT;
ALTER TABLE collection_events ADD COLUMN IF NOT EXISTS cascades_run_id TEXT;
ALTER TABLE collection_events ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_collection_events_cascades_run
  ON collection_events (cascades_run_id, created_at DESC);

-- Target Registry v2 — asset metadata, profiles, policies
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS collection_profile TEXT DEFAULT 'standard';
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS collection_policy TEXT;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS classification TEXT;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS sensitivity TEXT;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS confidence REAL;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS intel_source TEXT;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS last_changed_at TIMESTAMPTZ;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_collection_targets_type
  ON collection_targets (target_type);

CREATE INDEX IF NOT EXISTS idx_collection_targets_policy
  ON collection_targets (collection_policy)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_collection_targets_profile
  ON collection_targets (collection_profile);

CREATE TABLE IF NOT EXISTS collection_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workflow_template TEXT NOT NULL,
  schedule_mode TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  default_profile TEXT NOT NULL DEFAULT 'standard',
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ohf_target_id ON osint_harvest_findings(target_id);
CREATE INDEX IF NOT EXISTS idx_ohf_stix_type ON osint_harvest_findings(stix_type);
CREATE INDEX IF NOT EXISTS idx_ohf_workflow_run ON osint_harvest_findings(workflow_run_id);
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS collection_strategy TEXT;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS parent_target_id UUID;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS discovery_depth INTEGER DEFAULT 0;
`;

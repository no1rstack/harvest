/** Phase 3 — reasoning assessments, evidence bundles, read models. */

export const INTELLIGENCE_CORE_PHASE3_SQL = `
CREATE TABLE IF NOT EXISTS reasoning_assessments (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  assessment_type TEXT NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  supporting_count INTEGER NOT NULL DEFAULT 0,
  contradicting_count INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reasoning_claim ON reasoning_assessments(claim_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id TEXT PRIMARY KEY,
  case_id INTEGER,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL DEFAULT 'analyst',
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_bundles(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_bundle_items (
  bundle_id TEXT NOT NULL REFERENCES evidence_bundles(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cites',
  PRIMARY KEY (bundle_id, item_type, item_id)
);

-- Read models (CQRS projections for dashboards)
CREATE TABLE IF NOT EXISTS rm_collection_stats (
  collection_id TEXT PRIMARY KEY,
  target_value TEXT,
  observations INTEGER NOT NULL DEFAULT 0,
  artifacts INTEGER NOT NULL DEFAULT 0,
  relationships INTEGER NOT NULL DEFAULT 0,
  resolved_entities INTEGER NOT NULL DEFAULT 0,
  knowledge_objects INTEGER NOT NULL DEFAULT 0,
  top_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_entity_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rm_target_dashboard (
  target_value TEXT PRIMARY KEY,
  collections INTEGER NOT NULL DEFAULT 0,
  observations INTEGER NOT NULL DEFAULT 0,
  resolved_entities INTEGER NOT NULL DEFAULT 0,
  graph_edges INTEGER NOT NULL DEFAULT 0,
  last_collected_at TIMESTAMPTZ,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rm_entity_index (
  entity_key TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  canonical_value TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  collection_count INTEGER NOT NULL DEFAULT 0,
  avg_confidence REAL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rm_entity_type ON rm_entity_index(entity_type, canonical_value);
`;

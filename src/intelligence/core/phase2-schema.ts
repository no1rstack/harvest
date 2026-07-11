/** Phase 2 — identity resolution, knowledge objects, automation, claims. */

export const INTELLIGENCE_CORE_PHASE2_SQL = `
CREATE TABLE IF NOT EXISTS resolved_entities (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  entity_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  resolver_version TEXT NOT NULL DEFAULT 'identity-v1',
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  anchor_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resolved_entities_key ON resolved_entities(entity_type, normalized_key);
CREATE INDEX IF NOT EXISTS idx_resolved_entities_collection ON resolved_entities(collection_id);

CREATE TABLE IF NOT EXISTS resolved_entity_members (
  resolved_entity_id TEXT NOT NULL REFERENCES resolved_entities(id) ON DELETE CASCADE,
  observed_entity_id TEXT NOT NULL REFERENCES observed_entities(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL,
  matched_by TEXT NOT NULL DEFAULT 'canonical',
  confidence REAL,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (resolved_entity_id, observed_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_resolved_members_obs ON resolved_entity_members(observation_id);

CREATE TABLE IF NOT EXISTS knowledge_objects (
  id TEXT PRIMARY KEY,
  collection_id TEXT REFERENCES collections(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  anchor_type TEXT,
  anchor_id TEXT,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  provenance_id TEXT REFERENCES provenance(id),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_kind ON knowledge_objects(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_collection ON knowledge_objects(collection_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_anchor ON knowledge_objects(anchor_type, anchor_id);

CREATE TABLE IF NOT EXISTS knowledge_object_refs (
  knowledge_object_id TEXT NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cites',
  PRIMARY KEY (knowledge_object_id, ref_type, ref_id)
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  event_type TEXT NOT NULL,
  event_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  event_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON automation_runs(rule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  case_id INTEGER,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL DEFAULT 'analyst',
  ontology_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_case ON claims(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS claim_observations (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supports',
  analyst_note TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (claim_id, observation_id)
);

CREATE TABLE IF NOT EXISTS claim_provenance (
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  provenance_id TEXT NOT NULL REFERENCES provenance(id),
  role TEXT NOT NULL DEFAULT 'primary',
  PRIMARY KEY (claim_id, provenance_id)
);
`;

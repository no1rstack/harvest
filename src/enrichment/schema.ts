export const ENRICHMENT_SCHEMA_SQL = `
-- Candidates waiting for Wikidata resolution
CREATE TABLE IF NOT EXISTS enrichment_candidates (
  candidate_id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  entity_type TEXT,
  source_ids TEXT[] DEFAULT '{}',
  source_record_ids TEXT[] DEFAULT '{}',
  contexts TEXT[] DEFAULT '{}',
  priority_score REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  first_observed_at TIMESTAMPTZ DEFAULT NOW(),
  last_observed_at TIMESTAMPTZ DEFAULT NOW(),
  occurrence_count INTEGER DEFAULT 1,
  authority_weighted_count REAL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ec_status ON enrichment_candidates(status);
CREATE INDEX IF NOT EXISTS idx_ec_term ON enrichment_candidates(term);
CREATE INDEX IF NOT EXISTS idx_ec_priority ON enrichment_candidates(priority_score DESC);

-- Resolved entities with wikidata links
CREATE TABLE IF NOT EXISTS canonical_entities (
  entity_id TEXT PRIMARY KEY,
  canonical_label TEXT NOT NULL,
  entity_type TEXT,
  wikidata_id TEXT UNIQUE,
  wikipedia_page_id INTEGER,
  wikipedia_title TEXT,
  wikipedia_url TEXT,
  aliases TEXT[] DEFAULT '{}',
  resolution_confidence REAL DEFAULT 0,
  resolution_status TEXT NOT NULL DEFAULT 'pending',
  resolution_evidence TEXT[] DEFAULT '{}',
  last_enriched_at TIMESTAMPTZ DEFAULT NOW(),
  enrichment_cooldown TIMESTAMPTZ DEFAULT NOW(),
  priority_score REAL DEFAULT 0,
  watch BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ce_wikidata ON canonical_entities(wikidata_id);
CREATE INDEX IF NOT EXISTS idx_ce_type ON canonical_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_ce_label ON canonical_entities(canonical_label);
CREATE INDEX IF NOT EXISTS idx_ce_status ON canonical_entities(resolution_status);

-- Versioned encyclopedia snapshots (revision tracking)
CREATE TABLE IF NOT EXISTS encyclopedia_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES canonical_entities(entity_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  revision_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ DEFAULT NOW(),
  previous_snapshot_id TEXT REFERENCES encyclopedia_snapshots(snapshot_id),
  changed_fields TEXT[] DEFAULT '{}',
  raw_payload JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_es_entity ON encyclopedia_snapshots(entity_id, source);
CREATE INDEX IF NOT EXISTS idx_es_hash ON encyclopedia_snapshots(entity_id, source, content_hash);

-- Normalized facts extracted from wikipedia/wikidata
CREATE TABLE IF NOT EXISTS encyclopedia_facts (
  fact_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES canonical_entities(entity_id) ON DELETE CASCADE,
  property TEXT NOT NULL,
  value TEXT NOT NULL,
  value_entity_id TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  source_snapshot_id TEXT REFERENCES encyclopedia_snapshots(snapshot_id),
  confidence REAL DEFAULT 0.7,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ef_entity ON encyclopedia_facts(entity_id);
CREATE INDEX IF NOT EXISTS idx_ef_property ON encyclopedia_facts(property);
CREATE INDEX IF NOT EXISTS idx_ef_value ON encyclopedia_facts(value_entity_id);

-- Detected changes between snapshots
CREATE TABLE IF NOT EXISTS encyclopedia_changes (
  change_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES canonical_entities(entity_id) ON DELETE CASCADE,
  change_type TEXT NOT NULL,
  property TEXT,
  previous_value TEXT,
  current_value TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  source_snapshot_id TEXT REFERENCES encyclopedia_snapshots(snapshot_id),
  significance TEXT DEFAULT 'low',
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_ecc_entity ON encyclopedia_changes(entity_id, detected_at DESC);

-- Enrichment run history
CREATE TABLE IF NOT EXISTS enrichment_runs (
  run_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  candidates INTEGER DEFAULT 0,
  resolved INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  facts_added INTEGER DEFAULT 0,
  changes_detected INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_er_date ON enrichment_runs(started_at DESC);
`;

export function enrichmentCandidateId(term: string, sourceIds: string[]): string {
  // Deterministic ID from term + first source
  const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const source = (sourceIds[0] || 'unknown').slice(0, 20);
  return `ec_${slug}_${source}`;
}

export function canonicalEntityId(wikidataId: string): string {
  return `ce_${wikidataId}`;
}

export function snapshotId(entityId: string, source: string, revisionId: string): string {
  return `es_${entityId}_${source}_${revisionId}`.slice(0, 80);
}

export function factId(entityId: string, property: string, valueHash: string): string {
  return `ef_${entityId}_${property}_${valueHash}`.slice(0, 80);
}

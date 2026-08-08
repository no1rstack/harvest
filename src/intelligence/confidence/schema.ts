/**
 * Evidence scoring events — immutable audit log of every confidence assessment.
 */

export const EVIDENCE_SCORING_DDL = `
  CREATE TABLE IF NOT EXISTS evidence_scoring_events (
    id TEXT PRIMARY KEY,
    observation_id TEXT NOT NULL,
    observation_value TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_class TEXT NOT NULL,
    extraction_method TEXT NOT NULL,
    source_reliability REAL NOT NULL,
    extraction_quality REAL NOT NULL,
    corroboration_factor REAL NOT NULL,
    freshness_factor REAL NOT NULL,
    composite_confidence REAL NOT NULL,
    evidence_families TEXT[] DEFAULT '{}',
    corroborating_count INT DEFAULT 0,
    promotion_state TEXT NOT NULL,
    seeds_target BOOLEAN DEFAULT false,
    recommended_frequency TEXT,
    llm_reviewed BOOLEAN DEFAULT false,
    llm_confidence REAL,
    llm_rationale TEXT,
    llm_model TEXT,
    rationale TEXT,
    pipeline_version TEXT DEFAULT '1.0.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_evidence_scoring_observation ON evidence_scoring_events(observation_id);
  CREATE INDEX IF NOT EXISTS idx_evidence_scoring_confidence ON evidence_scoring_events(composite_confidence);
  CREATE INDEX IF NOT EXISTS idx_evidence_scoring_created ON evidence_scoring_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_evidence_scoring_promotion ON evidence_scoring_events(promotion_state);
`;

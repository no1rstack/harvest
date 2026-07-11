/** DDL for ontology registry tables in the Intelligence Core (harvest DB). */

export const ONTOLOGY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ontology_versions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ontology_entity_types (
  version_id TEXT NOT NULL REFERENCES ontology_versions(id),
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  stix_type TEXT,
  stix_identity_class TEXT,
  identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (version_id, id)
);

CREATE TABLE IF NOT EXISTS ontology_entity_aliases (
  version_id TEXT NOT NULL REFERENCES ontology_versions(id),
  alias TEXT NOT NULL,
  entity_type_id TEXT NOT NULL,
  PRIMARY KEY (version_id, alias)
);

CREATE TABLE IF NOT EXISTS ontology_observable_types (
  version_id TEXT NOT NULL REFERENCES ontology_versions(id),
  id TEXT NOT NULL,
  entity_type_id TEXT NOT NULL,
  connector_ids TEXT[] NOT NULL DEFAULT '{}',
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (version_id, id)
);

CREATE TABLE IF NOT EXISTS ontology_relationship_types (
  version_id TEXT NOT NULL REFERENCES ontology_versions(id),
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  source_entity_types TEXT[] NOT NULL,
  target_entity_types TEXT[] NOT NULL,
  stix_mapping TEXT NOT NULL DEFAULT 'related-to',
  origins_allowed TEXT[] NOT NULL DEFAULT '{observed}',
  PRIMARY KEY (version_id, id)
);

CREATE TABLE IF NOT EXISTS ontology_knowledge_types (
  version_id TEXT NOT NULL REFERENCES ontology_versions(id),
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (version_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ontology_aliases_entity
  ON ontology_entity_aliases(version_id, entity_type_id);
`;

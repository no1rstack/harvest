/**
 * Intelligence Core — Ontology types (platform language contract).
 * Every persisted object references ontology_version.
 */

export const ACTIVE_ONTOLOGY_VERSION = '1.0.0';

export interface OntologyEntityType {
  id: string;
  label: string;
  stix_type: string | null;
  stix_identity_class: string | null;
  identifiers: string[];
}

export interface OntologyObservableType {
  id: string;
  entity_type_id: string;
  connector_ids: string[];
}

export interface OntologyRelationshipType {
  id: string;
  label: string;
  source_entity_types: string[];
  target_entity_types: string[];
  stix_mapping: string;
  origins_allowed: string[];
}

export interface OntologyKnowledgeType {
  id: string;
  label: string;
}

export interface OntologySnapshot {
  version: string;
  entity_types: Map<string, OntologyEntityType>;
  entity_aliases: Map<string, string>;
  observable_types: Map<string, OntologyObservableType>;
  relationship_types: Map<string, OntologyRelationshipType>;
  knowledge_types: Map<string, OntologyKnowledgeType>;
}

export interface StixTypeResolution {
  entity_type_id: string;
  stix_type: string;
  stix_identity_class?: string;
  observable_type_id?: string;
}

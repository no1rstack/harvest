import type {
  OntologyEntityType,
  OntologyKnowledgeType,
  OntologyObservableType,
  OntologyRelationshipType,
  OntologySnapshot,
} from './types.js';

export interface NormalizedOntologyEntityType extends OntologyEntityType {}

export interface NormalizedOntologyObservableType extends OntologyObservableType {}

export interface NormalizedOntologyRelationshipType extends OntologyRelationshipType {}

export interface NormalizedOntologyKnowledgeType extends OntologyKnowledgeType {}

export interface NormalizedOntologyDocument {
  source: 'harvest';
  version: string;
  exportedAt: string;
  entityTypes: NormalizedOntologyEntityType[];
  entityAliases: Array<{ alias: string; entityTypeId: string }>;
  observableTypes: NormalizedOntologyObservableType[];
  relationshipTypes: NormalizedOntologyRelationshipType[];
  knowledgeTypes: NormalizedOntologyKnowledgeType[];
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

export function normalizeOntologySnapshot(snapshot: OntologySnapshot): NormalizedOntologyDocument {
  return {
    source: 'harvest',
    version: snapshot.version,
    exportedAt: new Date().toISOString(),
    entityTypes: [...snapshot.entity_types.values()].sort(byId),
    entityAliases: [...snapshot.entity_aliases.entries()]
      .map(([alias, entityTypeId]) => ({ alias, entityTypeId }))
      .sort((a, b) => a.alias.localeCompare(b.alias)),
    observableTypes: [...snapshot.observable_types.values()].sort(byId),
    relationshipTypes: [...snapshot.relationship_types.values()].sort(byId),
    knowledgeTypes: [...snapshot.knowledge_types.values()].sort(byId),
  };
}

export function ontologyComparisonKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

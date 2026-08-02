/**
 * Daily Encyclopedia Enrichment types.
 */

export interface EnrichmentCandidate {
  term: string;
  entityType?: string;
  sourceIds: string[];
  sourceRecordIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
  // Authority-weighted count (higher for government/sanctions/legal sources)
  authorityWeightedCount: number;
  contexts: string[];
  aliases: string[];
  // Computed
  priority?: number;
}

export interface WikidataEntity {
  id: string; // Q-ID e.g. "Q308"
  label: string;
  description: string;
  aliases: string[];
  entityType: string; // instance_of labels
  wikipediaPageId?: number;
  wikipediaUrl?: string;
  wikipediaTitle?: string;
  sitelinks: Record<string, string>;
  claims: Array<{
    property: string;
    propertyLabel: string;
    value: string;
    valueId?: string;
    qualifiers?: Record<string, string>;
  }>;
  coordinates?: { lat: number; lon: number };
  inceptionDate?: string;
  countryId?: string;
  countryLabel?: string;
  lastModified: string;
}

export interface WikidataResolution {
  inputTerm: string;
  canonicalLabel: string;
  wikidataId: string;
  entityType: string;
  resolutionConfidence: number;
  resolutionEvidence: string[];
  resolvedAt: string;
}

export interface WikipediaArticle {
  pageId: number;
  title: string;
  url: string;
  language: string;
  extract: string; // lead summary
  extractHtml?: string;
  sections: Array<{ title: string; level: number }>;
  infobox?: Record<string, string>;
  revisionId: number;
  lastRevisionTime: string;
  redirectTarget?: string;
  isDisambiguation: boolean;
  categories: string[];
  thumbnail?: string;
  pageImage?: string;
}

export interface CanonicalEntity {
  entityId: string; // internal UUID
  canonicalLabel: string;
  entityType: string;
  wikidataId: string;
  wikipediaPageId?: number;
  wikipediaTitle?: string;
  wikipediaUrl?: string;
  aliases: string[];
  resolutionConfidence: number;
  resolutionStatus: 'resolved' | 'ambiguous' | 'failed' | 'review';
  resolutionEvidence: string[];
  lastEnrichedAt: string;
  enrichmentCooldown: string;
  priority: number;
  watch: boolean;
}

export interface EncyclopediaSnapshot {
  snapshotId: string;
  entityId: string;
  source: 'wikidata' | 'wikipedia' | 'dbpedia' | 'wikimedia';
  language: string;
  revisionId: string;
  contentHash: string;
  retrievedAt: string;
  previousSnapshotId?: string;
  changedFields?: string[];
}

export interface EncyclopediaFact {
  entityId: string;
  property: string;
  value: string;
  valueEntityId?: string;
  validFrom?: string;
  validTo?: string;
  sourceSnapshotId: string;
  confidence: number;
}

export interface EncyclopediaChange {
  changeId: string;
  entityId: string;
  changeType: 'added' | 'modified' | 'removed';
  previousValue?: string;
  currentValue?: string;
  detectedAt: string;
  sourceSnapshotId: string;
  significance: 'high' | 'medium' | 'low';
  description: string;
}

export interface EnrichmentResult {
  candidateTerm: string;
  resolved: boolean;
  wikidataId?: string;
  canonicalLabel?: string;
  entityType?: string;
  factsAdded: number;
  factsSkipped: number;
  changesDetected: number;
  wasUpdated: boolean;
  error?: string;
}

export interface EnrichmentRun {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  candidates: number;
  resolved: number;
  failed: number;
  facts: number;
  changes: number;
  status: 'running' | 'completed' | 'failed';
}

/**
 * Evidence Scoring — type definitions for the composed confidence pipeline.
 *
 * Architecture:
 *   Observation → Source Reliability × Extraction Quality × Corroboration × Freshness → Evidence Confidence
 *
 * Independence: correlated sources (same wire service, shared registrar) count as one
 * evidence family, not multiple independent facts.
 */

// ── Sources ───────────────────────────────────────────────────────────────

export type SourceClass = 'government' | 'financial' | 'research' | 'news' | 'social' | 'sensor' | 'domain' | 'certificate' | 'unknown';

export interface SourceDescriptor {
  id: string;
  name: string;
  class: SourceClass;
  domain?: string;
  /** Baseline reliability prior (0-1) */
  baseline: number;
  /** Evidence family — sources in the same family are NOT independent */
  evidenceFamily: string;
}

// ── Extraction ────────────────────────────────────────────────────────────

export type ExtractionMethod = 'harvester' | 'rule-based' | 'llm-structured' | 'llm-reasoning' | 'wikidata-resolve' | 'whois-parse' | 'dns-lookup' | 'cert-parse' | 'manual';

export interface ExtractionDescriptor {
  method: ExtractionMethod;
  /** Quality prior per method (0-1) */
  baseline: number;
  /** Optional LLM model name if method uses LLM */
  llmModel?: string;
  /** Whether this extraction can hallucinate */
  canHallucinate: boolean;
}

// ── Evidence ──────────────────────────────────────────────────────────────

export interface ObservationEvidence {
  observationId: string;
  /** What was observed (domain, IP, entity name, fact, etc.) */
  value: string;
  /** Entity type from ontology */
  entityType: string;
  /** Source that produced this observation */
  source: SourceDescriptor;
  /** How the observation was extracted */
  extraction: ExtractionDescriptor;
  /** When the observation was made */
  observedAt: string;
  /** Observation count (how many times this specific fact has been seen) */
  observationCount: number;
  /** The target that generated this observation, if any */
  targetId?: string;
  /** The workflow run that produced this */
  workflowRunId?: string;
}

// ── Scored Evidence ───────────────────────────────────────────────────────

export interface ScoredEvidence {
  evidence: ObservationEvidence;
  /** Individual factor scores */
  sourceReliability: number;       // 0-1
  extractionQuality: number;        // 0-1
  corroborationFactor: number;      // 1.0 = alone, >1 = reinforced
  freshnessFactor: number;          // 0-1 (decays with age)
  /** Composed confidence: product of factors */
  compositeConfidence: number;      // 0-1
  /** Independence groups this evidence belongs to */
  evidenceFamilies: Set<string>;
  /** Corroborating observation IDs */
  corroboratingEvidence: string[];
  /** Whether LLM reviewed this score */
  llmReviewed: boolean;
  llmConfidence?: number;
  llmRationale?: string;
}

// ── Corroboration ─────────────────────────────────────────────────────────

export interface CorroborationGroup {
  groupId: string;
  evidenceFamily: string;
  members: string[];
  independentSources: Set<string>;
  /** How many truly independent sources corroborate */
  independentCount: number;
  /** Corroboration multiplier: 1.0 + min(0.5, (independentCount - 1) * 0.15) */
  factor: number;
}

// ── Promotion State Machine ───────────────────────────────────────────────

export type PromotionState = 'discovered' | 'candidate' | 'corroborated' | 'promoted' | 'active' | 'analyst-promoted';

export interface PromotionThresholds {
  storeOnly: number;          // confidence < this → store, don't seed
  candidate: number;          // confidence >= storeOnly → candidate target
  lowFrequency: number;       // confidence >= this → periodic low-freq collection
  active: number;             // confidence >= this → active collection
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = {
  storeOnly: 0.40,
  candidate: 0.40,
  lowFrequency: 0.65,
  active: 0.80,
};

export function promotionState(confidence: number, thresholds: PromotionThresholds = DEFAULT_PROMOTION_THRESHOLDS): PromotionState {
  if (confidence < thresholds.storeOnly) return 'discovered';
  if (confidence < thresholds.lowFrequency) return 'candidate';
  if (confidence < thresholds.active) return 'corroborated';
  return 'promoted';
}

// ── Source reliability priors ─────────────────────────────────────────────

export const SOURCE_CLASS_PRIORS: Record<SourceClass, number> = {
  government:   0.90,
  financial:    0.85,
  research:     0.82,
  news:         0.60,
  social:       0.30,
  sensor:       0.88,
  domain:       0.70,
  certificate:  0.75,
  unknown:      0.50,
};

export const EXTRACTION_METHOD_PRIORS: Record<ExtractionMethod, { baseline: number; canHallucinate: boolean }> = {
  'harvester':         { baseline: 0.90, canHallucinate: false },
  'rule-based':        { baseline: 0.82, canHallucinate: false },
  'llm-structured':    { baseline: 0.70, canHallucinate: true },
  'llm-reasoning':     { baseline: 0.65, canHallucinate: true },
  'wikidata-resolve':  { baseline: 0.85, canHallucinate: false },
  'whois-parse':       { baseline: 0.88, canHallucinate: false },
  'dns-lookup':        { baseline: 0.92, canHallucinate: false },
  'cert-parse':        { baseline: 0.90, canHallucinate: false },
  'manual':            { baseline: 0.95, canHallucinate: false },
};

// ── Evidence families for independence grouping ───────────────────────────

export function inferEvidenceFamily(evidence: ObservationEvidence): string {
  const source = evidence.source;
  const entityType = evidence.entityType;
  const method = evidence.extraction.method;

  // DNS + crt.sh + RDAP about the same domain → same family
  if (['domain', 'ip_address', 'nameserver'].includes(entityType)) {
    return `infrastructure:${entityType}`;
  }

  // RSS articles from same wire service → same family
  if (source.class === 'news' && method === 'rule-based') {
    return `news:${source.domain || source.name}`;
  }

  // WHOIS registrant data → same family
  if (method === 'whois-parse') {
    return `whois:${source.domain || evidence.value}`;
  }

  // Sensor data (USGS, OpenSky, etc.) → each sensor is its own family
  if (source.class === 'sensor') {
    return `sensor:${source.name}`;
  }

  // Government sources → family by agency
  if (source.class === 'government') {
    return `government:${source.domain || source.name}`;
  }

  // Default: family by source name + entity type
  return `${source.name}:${entityType}`;
}

/**
 * Extraction quality — how reliable is the method that produced this observation.
 *
 * Different extraction methods have different inherent quality:
 * - DNS lookups: machine-verifiable, near-perfect
 * - WHOIS parsing: structured but can be stale
 * - Rule-based NER: heuristic, noisy
 * - LLM structured extraction: can hallucinate
 * - Wikidata resolution: community-curated but may be wrong
 */

import type { ObservationEvidence } from './types.js';
import { EXTRACTION_METHOD_PRIORS, type ExtractionMethod } from './types.js';

export interface ExtractionQualityResult {
  score: number;
  method: ExtractionMethod;
  baseline: number;
  canHallucinate: boolean;
  llmModel?: string;
  rationale: string;
}

/**
 * Compute extraction quality for an observation.
 */
export function computeExtractionQuality(evidence: ObservationEvidence): ExtractionQualityResult {
  const { extraction } = evidence;
  const priors = EXTRACTION_METHOD_PRIORS[extraction.method] ?? { baseline: 0.50, canHallucinate: true };
  let score = priors.baseline;

  // Adjustments
  let adjustment = '';

  if (extraction.canHallucinate) {
    // LLM extractions: reduce confidence slightly unless actively reviewed
    if (extraction.method === 'llm-structured') {
      score *= 0.92;
      adjustment = ' (hallucination risk -8%)';
    }
    if (extraction.method === 'llm-reasoning') {
      score *= 0.85;
      adjustment = ' (hallucination risk -15%)';
    }
  }

  // Harvester methods: slightly reduce if it's a generic harvester
  if (extraction.method === 'harvester' && evidence.extraction.baseline < 0.85) {
    score *= 0.95;
    adjustment += ' (generic harvester -5%)';
  }

  // Wikidata resolution: use the resolution confidence if available
  if (extraction.method === 'wikidata-resolve' && extraction.baseline < 0.9) {
    score *= (0.85 + extraction.baseline * 0.15); // Blend with reported confidence
    adjustment += ` (wikidata blend ${extraction.baseline.toFixed(2)})`;
  }

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    method: extraction.method,
    baseline: priors.baseline,
    canHallucinate: priors.canHallucinate,
    llmModel: extraction.llmModel,
    rationale: `${extraction.method} baseline=${priors.baseline.toFixed(2)}${adjustment} → ${score.toFixed(2)}`,
  };
}

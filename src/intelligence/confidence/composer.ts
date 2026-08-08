/**
 * Confidence Composer — assembles the four scoring factors into a composite
 * evidence confidence score.
 *
 * Formula:
 *   confidence = source_reliability × extraction_quality × corroboration_factor × freshness_factor
 *
 * The corroboration factor is a multiplier (≥1), not a 0-1 score, so the product
 * may exceed 1.0. We clamp to [0, 1].
 *
 * LLM review is triggered for borderline cases and can adjust the final score.
 */

import type {
  ObservationEvidence,
  ScoredEvidence,
  PromotionState,
  PromotionThresholds,
} from './types.js';
import { DEFAULT_PROMOTION_THRESHOLDS, promotionState } from './types.js';
import { computeSourceReliability } from './sourceReliability.js';
import { computeExtractionQuality } from './extractionQuality.js';
import { computeCorroboration, corroborationBoost } from './corroboration.js';
import { computeFreshness } from './freshness.js';
import {
  llmReviewConfidence,
  shouldLlmReview,
  type LlmConfidenceAssessment,
} from './llm.js';

export interface ScoredResult {
  scored: ScoredEvidence;
  /** Promotion state based on confidence thresholds */
  state: PromotionState;
  /** Whether this evidence is strong enough to seed a collection target */
  seedsTarget: boolean;
  /** Recommended collection frequency */
  recommendedFrequency: 'none' | 'low' | 'normal' | 'active';
}

/**
 * Score a single observation in the context of a batch of related evidence.
 */
export async function scoreEvidence(
  evidence: ObservationEvidence,
  allRelatedEvidence: ObservationEvidence[],
  options?: {
    thresholds?: PromotionThresholds;
    skipLlm?: boolean;
  },
): Promise<ScoredResult> {
  const thresholds = options?.thresholds ?? DEFAULT_PROMOTION_THRESHOLDS;

  const sourceR = computeSourceReliability(evidence);
  const extraction = computeExtractionQuality(evidence);
  const corroboration = computeCorroboration(evidence, allRelatedEvidence);
  const freshness = computeFreshness(evidence);

  // Composite: product of all factors (corroboration is a multiplier, clamped)
  let composite = sourceR.score * extraction.score * corroboration.factor * freshness.factor;
  composite = Math.max(0, Math.min(1, composite));

  const scored: ScoredEvidence = {
    evidence,
    sourceReliability: sourceR.score,
    extractionQuality: extraction.score,
    corroborationFactor: corroboration.factor,
    freshnessFactor: freshness.factor,
    compositeConfidence: composite,
    evidenceFamilies: new Set(corroboration.groups.map((g) => g.evidenceFamily)),
    corroboratingEvidence: allRelatedEvidence
      .filter((e) => e.observationId !== evidence.observationId)
      .map((e) => e.observationId),
    llmReviewed: false,
  };

  // LLM review for borderline cases
  if (!options?.skipLlm && shouldLlmReview(scored)) {
    const llmAssessment = await llmReviewConfidence(scored);
    if (llmAssessment?.ok) {
      scored.llmReviewed = true;
      scored.llmConfidence = llmAssessment.confidence;
      scored.llmRationale = llmAssessment.rationale;

      // Blend: 70% numeric, 30% LLM for borderline cases
      // For hallucination-prone extractions, weight LLM more heavily at 40%
      if (evidence.extraction.canHallucinate) {
        composite = composite * 0.6 + llmAssessment.confidence * 0.4;
      } else {
        composite = composite * 0.7 + llmAssessment.confidence * 0.3;
      }
      composite = Math.max(0, Math.min(1, composite));
      scored.compositeConfidence = composite;
    }
  }

  const state = promotionState(composite, thresholds);

  let seedsTarget = false;
  let recommendedFrequency: ScoredResult['recommendedFrequency'] = 'none';

  if (composite >= thresholds.storeOnly) {
    seedsTarget = true;
    if (composite >= thresholds.active) {
      recommendedFrequency = 'active';
    } else if (composite >= thresholds.lowFrequency) {
      recommendedFrequency = 'normal';
    } else {
      recommendedFrequency = 'low';
    }
  }

  return { scored, state, seedsTarget, recommendedFrequency };
}

/**
 * Lightweight synchronous version for bulk scoring (no LLM review).
 */
export function scoreEvidenceSync(
  evidence: ObservationEvidence,
  allRelatedEvidence: ObservationEvidence[],
  thresholds: PromotionThresholds = DEFAULT_PROMOTION_THRESHOLDS,
): ScoredResult {
  const sourceR = computeSourceReliability(evidence);
  const extraction = computeExtractionQuality(evidence);
  const corroboration = computeCorroboration(evidence, allRelatedEvidence);
  const freshness = computeFreshness(evidence);

  let composite = sourceR.score * extraction.score * corroboration.factor * freshness.factor;
  composite = Math.max(0, Math.min(1, composite));

  const scored: ScoredEvidence = {
    evidence,
    sourceReliability: sourceR.score,
    extractionQuality: extraction.score,
    corroborationFactor: corroboration.factor,
    freshnessFactor: freshness.factor,
    compositeConfidence: composite,
    evidenceFamilies: new Set(corroboration.groups.map((g) => g.evidenceFamily)),
    corroboratingEvidence: allRelatedEvidence
      .filter((e) => e.observationId !== evidence.observationId)
      .map((e) => e.observationId),
    llmReviewed: false,
  };

  const state = promotionState(composite, thresholds);

  let seedsTarget = false;
  let recommendedFrequency: ScoredResult['recommendedFrequency'] = 'none';

  if (composite >= thresholds.storeOnly) {
    seedsTarget = true;
    if (composite >= thresholds.active) {
      recommendedFrequency = 'active';
    } else if (composite >= thresholds.lowFrequency) {
      recommendedFrequency = 'normal';
    } else {
      recommendedFrequency = 'low';
    }
  }

  return { scored, state, seedsTarget, recommendedFrequency };
}

/**
 * Batch score with optional LLM review on borderline items.
 */
export async function scoreEvidenceBatch(
  items: Array<{ evidence: ObservationEvidence; related: ObservationEvidence[] }>,
  options?: { thresholds?: PromotionThresholds; skipLlm?: boolean; maxLlmReviews?: number },
): Promise<ScoredResult[]> {
  const thresholds = options?.thresholds ?? DEFAULT_PROMOTION_THRESHOLDS;
  const maxLlm = options?.maxLlmReviews ?? 10;
  let llmCount = 0;

  const results: ScoredResult[] = [];

  for (const item of items) {
    const preliminary = scoreEvidenceSync(item.evidence, item.related, thresholds);

    // LLM review only for the first N borderline items
    if (!options?.skipLlm && shouldLlmReview(preliminary.scored) && llmCount < maxLlm) {
      const llmAssessment = await llmReviewConfidence(preliminary.scored);
      if (llmAssessment?.ok) {
        preliminary.scored.llmReviewed = true;
        preliminary.scored.llmConfidence = llmAssessment.confidence;
        preliminary.scored.llmRationale = llmAssessment.rationale;

        // Blend
        let composite = preliminary.scored.compositeConfidence;
        if (item.evidence.extraction.canHallucinate) {
          composite = composite * 0.6 + llmAssessment.confidence * 0.4;
        } else {
          composite = composite * 0.7 + llmAssessment.confidence * 0.3;
        }
        composite = Math.max(0, Math.min(1, composite));
        preliminary.scored.compositeConfidence = composite;

        const state = promotionState(composite, thresholds);
        preliminary.state = state;
        if (composite >= thresholds.storeOnly) {
          preliminary.seedsTarget = true;
          if (composite >= thresholds.active) preliminary.recommendedFrequency = 'active';
          else if (composite >= thresholds.lowFrequency) preliminary.recommendedFrequency = 'normal';
          else preliminary.recommendedFrequency = 'low';
        }
        llmCount++;
      }
    }

    results.push(preliminary);
  }

  return results;
}

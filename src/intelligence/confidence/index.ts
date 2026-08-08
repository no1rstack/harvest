/**
 * Evidence Scoring Pipeline — barrel module.
 *
 * Entry point for the composed confidence scoring system:
 *
 *   Observation → Source Reliability × Extraction Quality ×
 *                 Corroboration Factor × Freshness Factor
 *              → Evidence Confidence
 *              → Promotion State
 *              → Collection Target Seeding
 *
 * Usage:
 *   import { scoreEvidence, scoreEvidenceBatch, scoreEvidenceSync } from '../intelligence/confidence';
 */

// ── Types ─────────────────────────────────────────────────────────────────
export {
  type ObservationEvidence,
  type ScoredEvidence,
  type SourceDescriptor,
  type ExtractionDescriptor,
  type SourceClass,
  type ExtractionMethod,
  type CorroborationGroup,
  type PromotionState,
  type PromotionThresholds,
  DEFAULT_PROMOTION_THRESHOLDS,
  promotionState,
  SOURCE_CLASS_PRIORS,
  EXTRACTION_METHOD_PRIORS,
  inferEvidenceFamily,
} from './types.js';

// ── Scoring functions ─────────────────────────────────────────────────────
export { computeSourceReliability } from './sourceReliability.js';
export { computeExtractionQuality } from './extractionQuality.js';
export { computeCorroboration, corroborationBoost } from './corroboration.js';
export { computeFreshness } from './freshness.js';

// ── Composer (synchronous + async with LLM) ───────────────────────────────
export {
  scoreEvidence,
  scoreEvidenceSync,
  scoreEvidenceBatch,
  type ScoredResult,
} from './composer.js';

// ── LLM integration ──────────────────────────────────────────────────────
export {
  llmReviewConfidence,
  shouldLlmReview,
  type LlmConfidenceAssessment,
} from './llm.js';

// ── Schema ────────────────────────────────────────────────────────────────
export { EVIDENCE_SCORING_DDL } from './schema.js';

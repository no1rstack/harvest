/**
 * LLM-based confidence reasoning — provides a human-readable confidence assessment
 * that can override or augment the numeric scoring pipeline.
 *
 * The LLM is prompted to assess:
 * 1. Source credibility in context (not just class, but actual content)
 * 2. Extraction plausibility (does the extracted entity make sense?)
 * 3. Corroboration quality (are the corroborating sources truly independent?)
 * 4. Overall confidence score + short rationale
 *
 * The LLM score is NOT used as the primary score — it serves as an
 * augmentation and override for borderline cases.
 */

import { getHarvestLlmConfig, isHarvestLlmEnrichEnabled } from '../../lib/llmClient.js';
import type { ScoredEvidence, ObservationEvidence } from './types.js';

export interface LlmConfidenceAssessment {
  confidence: number;
  rationale: string;
  sourceAssessment: string;
  corroborationAssessment: string;
  model: string;
  ok: boolean;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
}

/**
 * Ask the LLM to review a scored evidence assessment and provide its own judgment.
 * Used when confidence is borderline (40-70%) or when hallucination risk is high.
 */
export async function llmReviewConfidence(
  scored: ScoredEvidence,
): Promise<LlmConfidenceAssessment | null> {
  if (!isHarvestLlmEnrichEnabled()) return null;

  const cfg = getHarvestLlmConfig();
  const ev = scored.evidence;

  const system = `You are an evidence-quality reviewer for an OSINT collection platform. 
Your job is to assess whether a scored observation is genuinely trustworthy.

You will receive:
- The observation (what was observed, by whom, how)
- Pre-computed scores (source reliability, extraction quality, corroboration, freshness)
- The composite confidence score

Evaluate:
1. **Source credibility in context**: Does this source actually know about this specific fact? (e.g., "CISA" about a vulnerability = highly credible; "CISA" about a celebrity = dubious)
2. **Extraction plausibility**: Does the extracted entity/fact make sense given the source content?
3. **Corroboration quality**: Are the corroborating sources truly independent, or are they all syndicating the same wire report?
4. **Overall confidence**: Your numeric score (0-1) and why.

Reply with ONLY compact JSON:
{"confidence":0.0,"rationale":"","sourceAssessment":"","corroborationAssessment":""}`;

  const user = JSON.stringify({
    observation: {
      value: ev.value,
      entityType: ev.entityType,
      source: { name: ev.source.name, class: ev.source.class, domain: ev.source.domain },
      extraction: { method: ev.extraction.method, canHallucinate: ev.extraction.canHallucinate },
      observedAt: ev.observedAt,
      observationCount: ev.observationCount,
    },
    scoring: {
      sourceReliability: scored.sourceReliability.toFixed(2),
      extractionQuality: scored.extractionQuality.toFixed(2),
      corroborationFactor: scored.corroborationFactor.toFixed(2),
      freshnessFactor: scored.freshnessFactor.toFixed(2),
      compositeConfidence: scored.compositeConfidence.toFixed(2),
    },
    corroborationDetail: scored.corroboratingEvidence.length > 0
      ? `${scored.corroboratingEvidence.length} corroborating observations, ${scored.evidenceFamilies.size} evidence families`
      : 'no corroboration',
  });

  try {
    const res = await fetch(cfg.chatCompletionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 300,
        temperature: 0.1,
        format: 'json',
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = String(data.choices?.[0]?.message?.content || '').trim();
    const parsed = extractJsonObject(text);
    if (!parsed) return null;

    return {
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      rationale: String(parsed.rationale || '').slice(0, 300),
      sourceAssessment: String(parsed.sourceAssessment || '').slice(0, 200),
      corroborationAssessment: String(parsed.corroborationAssessment || '').slice(0, 200),
      model: cfg.model,
      ok: true,
    };
  } catch {
    return null;
  }
}

/**
 * Determine if an observation should get LLM review.
 * Reviews borderline cases (40-70% confidence) and LLM-extracted observations.
 */
export function shouldLlmReview(scored: ScoredEvidence): boolean {
  // Always review LLM-extracted evidence
  if (scored.evidence.extraction.canHallucinate) return true;

  // Review borderline confidence scores
  if (scored.compositeConfidence >= 0.40 && scored.compositeConfidence <= 0.70) return true;

  // Review when we have corroboration but it's from the same family
  if (scored.corroborationFactor > 1.0 && scored.evidenceFamilies.size === 1) return true;

  return false;
}

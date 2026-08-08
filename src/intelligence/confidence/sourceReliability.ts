/**
 * Source reliability — prior baselines adjusted by domain history, authority, and method provenance.
 */

import type { ObservationEvidence, SourceDescriptor } from './types.js';
import { SOURCE_CLASS_PRIORS } from './types.js';

export interface SourceReliabilityResult {
  score: number;
  baseline: number;
  authorityAdjustment: number;
  historyAdjustment: number;
  rationale: string;
}

/**
 * Compute source reliability for an observation.
 * 
 * Formula: baseline × (1 + authority_adjustment) × (1 + history_adjustment), clamped [0, 1].
 */
export function computeSourceReliability(evidence: ObservationEvidence): SourceReliabilityResult {
  const { source } = evidence;
  const baseline = SOURCE_CLASS_PRIORS[source.class] ?? 0.50;

  let authorityAdjustment = 0;
  let historyAdjustment = 0;

  // Authority adjustments
  const authorityDomains = new Set([
    'whitehouse.gov', 'state.gov', 'defense.gov', 'dhs.gov', 'fbi.gov',
    'nist.gov', 'cisa.gov', 'nsa.gov', 'cia.gov', 'treasury.gov',
    'ofac.treasury.gov', 'bis.doc.gov', 'sec.gov', 'fincen.gov',
    'un.org', 'nato.int', 'interpol.int', 'europol.europa.eu',
    'wikidata.org', 'who.int', 'imf.org', 'worldbank.org',
  ]);

  if (source.domain && authorityDomains.has(source.domain.replace(/^www\./, ''))) {
    authorityAdjustment = 0.05; // +5% for known authority domains
  }

  // Sanctions/cyber/intelligence source classes get weighted higher
  if (['government', 'research'].includes(source.class)) {
    authorityAdjustment += 0.03;
  }

  // Social media gets a penalty unless it's an official account
  if (source.class === 'social') {
    authorityAdjustment -= 0.05;
  }

  // News wire services get a slight penalty vs original reporting
  if (source.name.includes('Reuters') || source.name.includes('AP ') || source.name.includes('Associated Press')) {
    authorityAdjustment += 0.02; // Wire services are reliable but syndicated
  }

  let score = baseline * (1 + authorityAdjustment) * (1 + historyAdjustment);
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    baseline,
    authorityAdjustment,
    historyAdjustment,
    rationale: `${source.class} baseline=${baseline.toFixed(2)}` +
      (authorityAdjustment !== 0 ? ` authority${authorityAdjustment >= 0 ? '+' : ''}${authorityAdjustment.toFixed(2)}` : '') +
      (historyAdjustment !== 0 ? ` history${historyAdjustment >= 0 ? '+' : ''}${historyAdjustment.toFixed(2)}` : '') +
      ` → ${score.toFixed(2)}`,
  };
}

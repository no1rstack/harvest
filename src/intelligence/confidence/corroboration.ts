/**
 * Independence-aware corroboration factor.
 *
 * Key insight: DNS + crt.sh + RDAP agreeing about a domain is NOT three independent
 * facts. Similarly, five RSS feeds syndicating the same Reuters story count as ONE.
 *
 * Evidence families group related sources so correlated observations don't
 * artificially inflate confidence.
 */

import type { ObservationEvidence } from './types.js';
import { inferEvidenceFamily } from './types.js';
import type { CorroborationGroup } from './types.js';

export interface CorroborationResult {
  factor: number;
  independentGroups: number;
  totalObservations: number;
  groups: CorroborationGroup[];
  rationale: string;
}

/**
 * Compute corroboration factor for a batch of evidence about the same subject.
 *
 * Groups evidence by independence family, counts distinct independent sources
 * per group, then computes a weighted factor.
 */
export function computeCorroboration(
  primaryEvidence: ObservationEvidence,
  allEvidence: ObservationEvidence[],
): CorroborationResult {
  if (allEvidence.length <= 1) {
    return {
      factor: 1.0,
      independentGroups: 1,
      totalObservations: 1,
      groups: [],
      rationale: 'single observation — no corroboration',
    };
  }

  const groups = new Map<string, CorroborationGroup>();

  for (const ev of allEvidence) {
    const family = inferEvidenceFamily(ev);
    const sourceKey = `${ev.source.name}:${ev.source.evidenceFamily}`;

    let group = groups.get(family);
    if (!group) {
      group = {
        groupId: family,
        evidenceFamily: family,
        members: [],
        independentSources: new Set(),
        independentCount: 0,
        factor: 1.0,
      };
      groups.set(family, group);
    }

    group.members.push(ev.observationId);
    group.independentSources.add(sourceKey);
  }

  // Compute group factors
  let totalIndependent = 0;
  for (const group of groups.values()) {
    group.independentCount = group.independentSources.size;
    // Each additional independent source adds diminishing returns
    group.factor = 1.0 + Math.min(0.5, (group.independentCount - 1) * 0.15);
    totalIndependent += group.independentCount;
  }

  const groupsArray = Array.from(groups.values());
  const totalSources = groupsArray.reduce((sum, g) => sum + g.independentCount, 0);
  const totalObs = allEvidence.length;

  // Weighted factor: average of group factors weighted by independent count
  const weightedFactor = totalSources > 0
    ? groupsArray.reduce((sum, g) => sum + g.factor * g.independentCount, 0) / totalSources
    : 1.0;

  // Cap at 2.0 — no amount of corroboration should double confidence
  const factor = Math.min(2.0, weightedFactor);

  let rationale: string;
  if (groupsArray.length === 1) {
    const g = groupsArray[0];
    rationale = `${g.independentCount} independent source(s) in "${g.evidenceFamily}" family × ${g.factor.toFixed(2)}`;
  } else {
    rationale = `${groupsArray.length} evidence families, ${totalSources} independent sources, avg factor ${factor.toFixed(2)}`;
  }

  return {
    factor,
    independentGroups: groupsArray.length,
    totalObservations: totalObs,
    groups: groupsArray,
    rationale,
  };
}

/**
 * Lightweight version: score a single observation against existing known data.
 * Returns a multiplier — meant to be called when adding one new observation.
 */
export function corroborationBoost(independentSourceCount: number): number {
  if (independentSourceCount <= 1) return 1.0;
  return 1.0 + Math.min(0.5, (independentSourceCount - 1) * 0.12);
}

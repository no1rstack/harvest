/**
 * Temporal freshness — confidence decays as observations age.
 *
 * Formula: freshness = max(0.3, e^(-age / halfLife))
 *
 * Half-lives vary by domain:
 * - Infrastructure (DNS, WHOIS, certs): 30 days
 * - News/social: 7 days
 * - Government/research: 90 days
 * - Sensor data: 1 day
 */

import type { ObservationEvidence } from './types.js';

const MILLISECONDS_IN_DAY = 86_400_000;

const HALF_LIVES_DAYS: Record<string, number> = {
  domain: 30,
  ip_address: 30,
  certificate: 30,
  nameserver: 30,
  organization: 60,
  person: 60,
  news: 7,
  social: 3,
  sensor: 1,
  government: 90,
  research: 60,
  financial: 14,
  default: 15,
};

export interface FreshnessResult {
  factor: number;
  ageDays: number;
  halfLife: number;
  rationale: string;
}

/**
 * Compute freshness decay for an observation.
 */
export function computeFreshness(evidence: ObservationEvidence): FreshnessResult {
  const now = Date.now();
  const observedAt = new Date(evidence.observedAt).getTime();
  const ageMs = now - observedAt;
  const ageDays = Math.max(0, ageMs / MILLISECONDS_IN_DAY);
  const halfLife = HALF_LIVES_DAYS[evidence.entityType] ?? HALF_LIVES_DAYS.default;

  // Exponential decay: factor = e^(-ln(2) * age / halfLife)
  // Simplified: factor = 2^(-age / halfLife)
  const factor = Math.pow(2, -ageDays / halfLife);

  // Never let it go below 0.3 — old data still has some value
  const clamped = Math.max(0.3, factor);

  return {
    factor: clamped,
    ageDays: Math.round(ageDays * 10) / 10,
    halfLife,
    rationale: `${ageDays.toFixed(1)}d old, half-life ${halfLife}d → ${clamped.toFixed(2)}`,
  };
}

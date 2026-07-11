/**
 * Reasoning Engine — evaluate claims, detect contradictions, reach verdicts.
 * Separates "what we know" (knowledge) from "what this implies" (reasoning).
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { getClaim } from '../core/claims.js';
import { getProvenanceChain } from '../core/provenance.js';
import { publishDomainEvent } from '../core/domain-events.js';

export type ReasoningVerdict =
  | 'supported'
  | 'contradicted'
  | 'inconclusive'
  | 'needs_review';

export interface ReasoningAssessment {
  id: string;
  claim_id: string;
  assessment_type: string;
  verdict: ReasoningVerdict | string;
  confidence: number;
  supporting_count: number;
  contradicting_count: number;
  details: Record<string, unknown>;
  created_at: string;
}

function assessmentId(claimId: string): string {
  return `reas_${crypto.createHash('sha256').update(`${claimId}:${Date.now()}`).digest('hex').slice(0, 20)}`;
}

export async function evaluateClaim(
  pool: Pool,
  claimId: string,
): Promise<ReasoningAssessment> {
  const detail = await getClaim(pool, claimId);
  if (!detail) throw new Error('Claim not found');

  const claim = detail.claim as Record<string, unknown>;
  const observations = (detail.observations as Array<Record<string, unknown>>) || [];
  const provenanceLinks = (detail.provenance as Array<Record<string, unknown>>) || [];

  let supporting = 0;
  let contradicting = 0;
  const supportingObs: string[] = [];
  const contradictingObs: string[] = [];
  const provenanceChains: Array<{ provenance_id: string; chain_length: number }> = [];

  for (const obs of observations) {
    if (obs.role === 'contradicts') {
      contradicting++;
      contradictingObs.push(String(obs.observation_id));
    } else {
      supporting++;
      supportingObs.push(String(obs.observation_id));
    }
  }

  for (const pl of provenanceLinks) {
    const chain = await getProvenanceChain(pool, String(pl.provenance_id));
    provenanceChains.push({ provenance_id: String(pl.provenance_id), chain_length: chain.length });
  }

  // Cross-check: look for observations that contradict by entity conflict
  const contradictions = await detectClaimContradictions(pool, claimId);

  let verdict: ReasoningVerdict = 'inconclusive';
  let confidence = 0.5;

  if (supporting > 0 && contradicting === 0 && contradictions.length === 0) {
    verdict = 'supported';
    confidence = Math.min(0.95, 0.5 + supporting * 0.1 + provenanceChains.length * 0.05);
  } else if (contradicting > 0 || contradictions.length > 0) {
    verdict = contradicting >= supporting ? 'contradicted' : 'needs_review';
    confidence = Math.min(0.9, 0.4 + Math.max(contradicting, contradictions.length) * 0.15);
  } else if (supporting === 0) {
    verdict = 'inconclusive';
    confidence = 0.3;
  }

  const id = assessmentId(claimId);
  const details = {
    claim_statement: claim.statement,
    supporting_observations: supportingObs,
    contradicting_observations: contradictingObs,
    detected_contradictions: contradictions,
    provenance_chains: provenanceChains,
    evaluated_at: new Date().toISOString(),
  };

  await pool.query(
    `INSERT INTO reasoning_assessments
      (id, claim_id, assessment_type, verdict, confidence, supporting_count, contradicting_count, details, ontology_version)
     VALUES ($1,$2,'claim_evaluation',$3,$4,$5,$6,$7::jsonb,$8)`,
    [id, claimId, verdict, confidence, supporting, contradicting + contradictions.length, JSON.stringify(details), ACTIVE_ONTOLOGY_VERSION],
  );

  // Update claim status from verdict
  const claimStatus =
    verdict === 'supported' ? 'supported' :
    verdict === 'contradicted' ? 'refuted' :
    verdict === 'needs_review' ? 'open' : 'inconclusive';

  await pool.query(`UPDATE claims SET status = $2, updated_at = NOW() WHERE id = $1`, [claimId, claimStatus]);

  await publishDomainEvent(pool, {
    event_type: 'claim.evaluated',
    aggregate_type: 'claim',
    aggregate_id: claimId,
    payload: { verdict, confidence, assessment_id: id },
  }).catch(() => {});

  const r = await pool.query(`SELECT * FROM reasoning_assessments WHERE id = $1`, [id]);
  return r.rows[0] as ReasoningAssessment;
}

/** Detect contradictions: same entity_type+value with conflicting confidence or roles. */
export async function detectClaimContradictions(
  pool: Pool,
  claimId: string,
): Promise<Array<{ observation_id: string; reason: string; related_value: string }>> {
  const obs = await pool.query(
    `SELECT co.observation_id, co.role, f.entity_type, f.value, f.confidence, f.source
     FROM claim_observations co
     JOIN osint_harvest_findings f ON f.id = co.observation_id
     WHERE co.claim_id = $1`,
    [claimId],
  );

  const contradictions: Array<{ observation_id: string; reason: string; related_value: string }> = [];
  const byKey = new Map<string, Array<Record<string, unknown>>>();

  for (const row of obs.rows) {
    const key = `${row.entity_type}:${String(row.value).toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  for (const [key, rows] of byKey) {
    const roles = new Set(rows.map((r) => r.role));
    if (roles.has('supports') && roles.has('contradicts')) {
      for (const r of rows) {
        contradictions.push({
          observation_id: String(r.observation_id),
          reason: 'same_entity_conflicting_roles',
          related_value: key,
        });
      }
    }
  }

  // Graph-based: check if claim observations connect to contradictory indicators
  for (const row of obs.rows) {
    if (row.role !== 'supports') continue;
    const conflicts = await pool.query(
      `SELECT cr.id, cr.relationship_type, cr.target_value, cr.source_value
       FROM collection_relationships cr
       WHERE cr.source_value = $1 AND cr.relationship_type IN ('indicates','related-to')
         AND cr.target_value IN (
           SELECT f2.value FROM claim_observations co2
           JOIN osint_harvest_findings f2 ON f2.id = co2.observation_id
           WHERE co2.claim_id = $2 AND co2.role = 'contradicts'
         )
       LIMIT 5`,
      [row.value, claimId],
    );
    for (const c of conflicts.rows) {
      contradictions.push({
        observation_id: String(row.observation_id),
        reason: `graph_conflict:${c.relationship_type}`,
        related_value: String(c.target_value),
      });
    }
  }

  return contradictions;
}

export async function getLatestAssessment(
  pool: Pool,
  claimId: string,
): Promise<ReasoningAssessment | null> {
  const r = await pool.query(
    `SELECT * FROM reasoning_assessments WHERE claim_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [claimId],
  );
  return r.rowCount ? (r.rows[0] as ReasoningAssessment) : null;
}

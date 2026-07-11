/**
 * Evidence bundles — formalized citation packages from claims + observations.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { getClaim } from './claims.js';
import { getLatestAssessment, evaluateClaim } from '../capabilities/reasoning-engine.js';
import { getProvenanceChain } from './provenance.js';

export interface EvidenceBundle {
  id: string;
  case_id: number | null;
  title: string;
  summary: string;
  claim_id: string | null;
  status: string;
  created_by: string;
  content: Record<string, unknown>;
  created_at: string;
}

export async function createEvidenceBundle(
  pool: Pool,
  opts: {
    title: string;
    claim_id: string;
    case_id?: number | null;
    created_by?: string;
    evaluate_first?: boolean;
  },
): Promise<EvidenceBundle> {
  const claimDetail = await getClaim(pool, opts.claim_id);
  if (!claimDetail) throw new Error('Claim not found');

  const assessment = opts.evaluate_first !== false
    ? await evaluateClaim(pool, opts.claim_id)
    : await getLatestAssessment(pool, opts.claim_id);

  const claim = claimDetail.claim as Record<string, unknown>;
  const observations = claimDetail.observations as Array<Record<string, unknown>>;
  const provenanceLinks = claimDetail.provenance as Array<Record<string, unknown>>;

  const provenanceChains: Record<string, unknown>[] = [];
  for (const pl of provenanceLinks) {
    const chain = await getProvenanceChain(pool, String(pl.provenance_id));
    provenanceChains.push({
      provenance_id: pl.provenance_id,
      role: pl.role,
      chain,
    });
  }

  // Also pull provenance from linked observations
  for (const obs of observations) {
    if (!obs.provenance_id) continue;
    const chain = await getProvenanceChain(pool, String(obs.provenance_id));
    provenanceChains.push({
      provenance_id: obs.provenance_id,
      role: `via_observation:${obs.role}`,
      observation_id: obs.observation_id,
      chain,
    });
  }

  const id = `evb_${crypto.randomBytes(10).toString('hex')}`;
  const summary = String(claim.statement || opts.title);
  const content = {
    claim,
    assessment: assessment || null,
    observations,
    provenance_chains: provenanceChains,
    bundled_at: new Date().toISOString(),
  };

  await pool.query(
    `INSERT INTO evidence_bundles
      (id, case_id, title, summary, claim_id, status, created_by, content, ontology_version)
     VALUES ($1,$2,$3,$4,$5,'published',$6,$7::jsonb,$8)`,
    [
      id,
      opts.case_id ?? (claim.case_id as number | null) ?? null,
      opts.title,
      summary,
      opts.claim_id,
      opts.created_by || 'analyst',
      JSON.stringify(content),
      ACTIVE_ONTOLOGY_VERSION,
    ],
  );

  // Link items
  await pool.query(
    `INSERT INTO evidence_bundle_items (bundle_id, item_type, item_id, role)
     VALUES ($1,'claim',$2,'primary') ON CONFLICT DO NOTHING`,
    [id, opts.claim_id],
  );

  for (const obs of observations) {
    await pool.query(
      `INSERT INTO evidence_bundle_items (bundle_id, item_type, item_id, role)
       VALUES ($1,'observation',$2,$3) ON CONFLICT DO NOTHING`,
      [id, obs.observation_id, obs.role || 'supports'],
    );
  }

  if (assessment) {
    await pool.query(
      `INSERT INTO evidence_bundle_items (bundle_id, item_type, item_id, role)
       VALUES ($1,'reasoning_assessment',$2,'evaluation') ON CONFLICT DO NOTHING`,
      [id, assessment.id],
    );
  }

  const r = await pool.query(`SELECT * FROM evidence_bundles WHERE id = $1`, [id]);
  return r.rows[0] as EvidenceBundle;
}

export async function getEvidenceBundle(pool: Pool, id: string): Promise<Record<string, unknown> | null> {
  const bundle = await pool.query(`SELECT * FROM evidence_bundles WHERE id = $1`, [id]);
  if (!bundle.rowCount) return null;
  const items = await pool.query(`SELECT * FROM evidence_bundle_items WHERE bundle_id = $1`, [id]);
  return { bundle: bundle.rows[0], items: items.rows };
}

export async function listEvidenceBundles(
  pool: Pool,
  opts: { case_id?: number; claim_id?: string; limit?: number } = {},
): Promise<EvidenceBundle[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.case_id != null) {
    params.push(opts.case_id);
    where.push(`case_id = $${params.length}`);
  }
  if (opts.claim_id) {
    params.push(opts.claim_id);
    where.push(`claim_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 50, 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM evidence_bundles ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows as EvidenceBundle[];
}

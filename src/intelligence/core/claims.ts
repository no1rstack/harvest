/**
 * Claims — investigative reasoning layer (links to observations + provenance).
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { publishDomainEvent } from '../core/domain-events.js';

export interface Claim {
  id: string;
  case_id: number | null;
  statement: string;
  status: string;
  created_by: string;
  ontology_version: string;
  created_at: string;
  updated_at: string;
}

export async function createClaim(
  pool: Pool,
  opts: {
    statement: string;
    case_id?: number | null;
    created_by?: string;
    observation_ids?: Array<{ id: string; role?: string; note?: string }>;
    provenance_ids?: Array<{ id: string; role?: string }>;
  },
): Promise<Claim> {
  const id = `claim_${crypto.randomBytes(10).toString('hex')}`;

  await pool.query(
    `INSERT INTO claims (id, case_id, statement, status, created_by, ontology_version)
     VALUES ($1,$2,$3,'open',$4,$5)`,
    [id, opts.case_id ?? null, opts.statement, opts.created_by || 'analyst', ACTIVE_ONTOLOGY_VERSION],
  );

  for (const obs of opts.observation_ids || []) {
    await pool.query(
      `INSERT INTO claim_observations (claim_id, observation_id, role, analyst_note)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [id, obs.id, obs.role || 'supports', obs.note || null],
    );
  }

  for (const prov of opts.provenance_ids || []) {
    await pool.query(
      `INSERT INTO claim_provenance (claim_id, provenance_id, role)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [id, prov.id, prov.role || 'primary'],
    );
  }

  await publishDomainEvent(pool, {
    event_type: 'claim.updated',
    aggregate_type: 'claim',
    aggregate_id: id,
    payload: { statement: opts.statement, status: 'open', case_id: opts.case_id },
  }).catch(() => {});

  const r = await pool.query(`SELECT * FROM claims WHERE id = $1`, [id]);
  return r.rows[0] as Claim;
}

export async function getClaim(pool: Pool, id: string): Promise<Record<string, unknown> | null> {
  const claim = await pool.query(`SELECT * FROM claims WHERE id = $1`, [id]);
  if (!claim.rowCount) return null;

  const observations = await pool.query(
    `SELECT co.*, f.value, f.entity_type, f.stix_id, f.provenance_id
     FROM claim_observations co
     LEFT JOIN osint_harvest_findings f ON f.id = co.observation_id
     WHERE co.claim_id = $1`,
    [id],
  );

  const provenance = await pool.query(
    `SELECT cp.*, p.provenance_class, p.subject_type, p.subject_id, p.collection_id
     FROM claim_provenance cp
     JOIN provenance p ON p.id = cp.provenance_id
     WHERE cp.claim_id = $1`,
    [id],
  );

  return {
    claim: claim.rows[0],
    observations: observations.rows,
    provenance: provenance.rows,
  };
}

export async function listClaims(
  pool: Pool,
  opts: { case_id?: number; status?: string; limit?: number } = {},
): Promise<Claim[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.case_id != null) {
    params.push(opts.case_id);
    where.push(`case_id = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 50, 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM claims ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows as Claim[];
}

export async function updateClaimStatus(
  pool: Pool,
  id: string,
  status: string,
): Promise<Claim | null> {
  await pool.query(`UPDATE claims SET status = $2, updated_at = NOW() WHERE id = $1`, [id, status]);
  await publishDomainEvent(pool, {
    event_type: 'claim.updated',
    aggregate_type: 'claim',
    aggregate_id: id,
    payload: { status },
  }).catch(() => {});
  const r = await pool.query(`SELECT * FROM claims WHERE id = $1`, [id]);
  return r.rowCount ? (r.rows[0] as Claim) : null;
}

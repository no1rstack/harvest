/**
 * Provenance — elevated lineage records (Atlas-style).
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';

export type ProvenanceClass = 'acquisition' | 'extraction' | 'assertion' | 'inference' | 'analyst';

export interface ProvenanceRecord {
  id: string;
  collection_id: string;
  provenance_class: ProvenanceClass | string;
  reproducible: boolean;
  subject_type: string;
  subject_id: string;
  parent_id: string | null;
  ontology_version: string;
  collector_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

function provenanceId(seed: string): string {
  return `prv_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

export async function insertProvenance(
  pool: Pool,
  opts: {
    collection_id: string;
    provenance_class: ProvenanceClass | string;
    subject_type: string;
    subject_id: string;
    parent_id?: string | null;
    reproducible?: boolean;
    collector_id?: string | null;
    ontology_version?: string;
    payload?: Record<string, unknown>;
    id_seed?: string;
  },
): Promise<ProvenanceRecord> {
  const id = provenanceId(opts.id_seed || `${opts.collection_id}:${opts.provenance_class}:${opts.subject_type}:${opts.subject_id}`);
  const ontology_version = opts.ontology_version || ACTIVE_ONTOLOGY_VERSION;

  await pool.query(
    `INSERT INTO provenance
      (id, collection_id, provenance_class, reproducible, subject_type, subject_id,
       parent_id, ontology_version, collector_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      opts.collection_id,
      opts.provenance_class,
      opts.reproducible ?? true,
      opts.subject_type,
      opts.subject_id,
      opts.parent_id ?? null,
      ontology_version,
      opts.collector_id ?? null,
      JSON.stringify(opts.payload || {}),
    ],
  );

  const r = await pool.query(`SELECT * FROM provenance WHERE id = $1`, [id]);
  return r.rows[0] as ProvenanceRecord;
}

export async function getProvenanceChain(pool: Pool, provenanceId: string): Promise<ProvenanceRecord[]> {
  const chain: ProvenanceRecord[] = [];
  let current: string | null = provenanceId;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);
    const r = await pool.query(`SELECT * FROM provenance WHERE id = $1`, [current]);
    if (!r.rowCount) break;
    const row = r.rows[0] as ProvenanceRecord;
    chain.push(row);
    current = row.parent_id;
  }

  return chain.reverse();
}

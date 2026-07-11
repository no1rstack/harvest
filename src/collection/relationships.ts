/**
 * Relationship generation — harvest observations → collection_relationships graph.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { CollectionObservation } from './types.js';
import { resolveRelationshipType } from '../intelligence/ontology/registry.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../intelligence/ontology/types.js';

export const COLLECTION_RELATIONSHIPS_SQL = `
CREATE TABLE IF NOT EXISTS collection_relationships (
  id TEXT PRIMARY KEY,
  source_observation_id TEXT NOT NULL,
  source_stix_id TEXT,
  source_value TEXT NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'related-to',
  target_type TEXT NOT NULL,
  target_value TEXT NOT NULL,
  target_stix_id TEXT,
  confidence REAL,
  connector_id TEXT,
  workflow_run_id TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_rel_unique
  ON collection_relationships (source_stix_id, relationship_type, target_type, target_value)
  WHERE source_stix_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_rel_source ON collection_relationships(source_value);
CREATE INDEX IF NOT EXISTS idx_collection_rel_target ON collection_relationships(target_value);
CREATE INDEX IF NOT EXISTS idx_collection_rel_run ON collection_relationships(workflow_run_id);
`;

function mapRelationToStix(relation: string): string {
  return resolveRelationshipType(relation);
}

function stixIdForEntity(entityType: string, value: string): string {
  const seed = crypto.createHash('sha256').update(`${entityType}:${value.trim().toLowerCase()}`).digest('hex');
  const uuid = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
  const typeMap: Record<string, string> = {
    domain: 'domain-name',
    subdomain: 'domain-name',
    ip: 'ipv4-addr',
    email: 'email-addr',
    organization: 'identity',
    person: 'identity',
    certificate: 'x509-certificate',
  };
  const stixType = typeMap[entityType.toLowerCase()] || 'x-collection-observable';
  return `${stixType}--${uuid}`;
}

export async function ensureRelationshipSchema(pool: Pool): Promise<void> {
  await pool.query(COLLECTION_RELATIONSHIPS_SQL);
}

export async function upsertObservationRelationships(
  pool: Pool,
  obs: CollectionObservation,
  opts: {
    observationId: string;
    workflowRunId?: string;
    connectorId?: string;
    collectionId?: string;
  },
): Promise<number> {
  if (!obs.related?.length) return 0;
  await ensureRelationshipSchema(pool);

  let linked = 0;
  for (const edge of obs.related) {
    if (!edge.value?.trim()) continue;
    const relType = mapRelationToStix(edge.relation || 'related-to');
    const targetStixId = stixIdForEntity(edge.type, edge.value);
    const id = `crel_${crypto.createHash('sha256').update(`${obs.stix_id}:${relType}:${edge.type}:${edge.value}`).digest('hex').slice(0, 24)}`;

    const result = await pool.query(
      `INSERT INTO collection_relationships
        (id, source_observation_id, source_stix_id, source_value, relationship_type,
         target_type, target_value, target_stix_id, confidence, connector_id, workflow_run_id,
         provenance, collection_id, ontology_version, relationship_origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)
       ON CONFLICT (source_stix_id, relationship_type, target_type, target_value)
       WHERE source_stix_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        id,
        opts.observationId,
        obs.stix_id,
        obs.value,
        relType,
        edge.type,
        edge.value.trim(),
        targetStixId,
        obs.confidence ?? null,
        opts.connectorId || obs.source,
        opts.workflowRunId || null,
        JSON.stringify({
          relation_label: edge.relation,
          source: obs.source,
          stix_provenance: obs.provenance,
          ontology_version: obs.ontology_version || ACTIVE_ONTOLOGY_VERSION,
        }),
        opts.collectionId || null,
        obs.ontology_version || ACTIVE_ONTOLOGY_VERSION,
        'observed',
      ],
    );
    if (result.rowCount) linked += 1;
  }
  return linked;
}

export async function listRelationships(
  pool: Pool,
  opts: {
    source_value?: string;
    target_value?: string;
    workflow_run_id?: string;
    limit?: number;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  await ensureRelationshipSchema(pool);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.source_value) {
    params.push(opts.source_value.trim().toLowerCase());
    where.push(`LOWER(source_value) = $${params.length}`);
  }
  if (opts.target_value) {
    params.push(opts.target_value.trim().toLowerCase());
    where.push(`LOWER(target_value) = $${params.length}`);
  }
  if (opts.workflow_run_id) {
    params.push(opts.workflow_run_id);
    where.push(`workflow_run_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 100, 500));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM collection_relationships ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

/**
 * Knowledge Engine — synthesize typed knowledge assets from graph + collections.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { insertProvenance } from '../core/provenance.js';
import { graphNeighbors } from './graph-engine.js';
import { publishDomainEvent } from '../core/domain-events.js';

export interface KnowledgeObject {
  id: string;
  collection_id: string | null;
  kind: string;
  title: string;
  status: string;
  anchor_type: string | null;
  anchor_id: string | null;
  schema_version: string;
  content: Record<string, unknown>;
  ontology_version: string;
  provenance_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function knowledgeId(kind: string, anchor: string): string {
  return `know_${crypto.createHash('sha256').update(`${kind}:${anchor}:${Date.now()}`).digest('hex').slice(0, 20)}`;
}

async function persistKnowledge(
  pool: Pool,
  opts: {
    kind: string;
    title: string;
    collection_id?: string | null;
    anchor_type?: string;
    anchor_id?: string;
    content: Record<string, unknown>;
    refs?: Array<{ ref_type: string; ref_id: string; role?: string }>;
    created_by?: string;
  },
): Promise<KnowledgeObject> {
  const id = knowledgeId(opts.kind, opts.anchor_id || opts.collection_id || 'global');
  let collection_id = opts.collection_id ?? null;

  if (!collection_id) {
    collection_id = `know_${id}`;
    await pool.query(
      `INSERT INTO collections (id, kind, status, initiated_by, ontology_version, config)
       VALUES ($1,'knowledge_synthesis','completed','knowledge-engine',$2,$3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [collection_id, ACTIVE_ONTOLOGY_VERSION, JSON.stringify({ knowledge_id: id, kind: opts.kind })],
    );
  }

  const prov = await insertProvenance(pool, {
    collection_id,
    provenance_class: 'inference',
    reproducible: true,
    subject_type: 'knowledge_object',
    subject_id: id,
    collector_id: 'knowledge-engine',
    ontology_version: ACTIVE_ONTOLOGY_VERSION,
    payload: { kind: opts.kind, anchor_id: opts.anchor_id },
  });

  await pool.query(
    `INSERT INTO knowledge_objects
      (id, collection_id, kind, title, status, anchor_type, anchor_id, content,
       ontology_version, provenance_id, created_by)
     VALUES ($1,$2,$3,$4,'published',$5,$6,$7::jsonb,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       content = EXCLUDED.content,
       updated_at = NOW(),
       status = 'published'`,
    [
      id,
      collection_id,
      opts.kind,
      opts.title,
      opts.anchor_type || null,
      opts.anchor_id || null,
      JSON.stringify(opts.content),
      ACTIVE_ONTOLOGY_VERSION,
      prov.id,
      opts.created_by || 'knowledge-engine',
    ],
  );

  for (const ref of opts.refs || []) {
    await pool.query(
      `INSERT INTO knowledge_object_refs (knowledge_object_id, ref_type, ref_id, role)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [id, ref.ref_type, ref.ref_id, ref.role || 'cites'],
    );
  }

  await publishDomainEvent(pool, {
    event_type: 'knowledge.published',
    aggregate_type: 'knowledge_object',
    aggregate_id: id,
    collection_id,
    payload: { kind: opts.kind, title: opts.title },
  }).catch(() => {});

  const r = await pool.query(`SELECT * FROM knowledge_objects WHERE id = $1`, [id]);
  return r.rows[0] as KnowledgeObject;
}

export async function synthesizeCollectionSummary(
  pool: Pool,
  collectionId: string,
): Promise<KnowledgeObject> {
  const coll = await pool.query(`SELECT * FROM collections WHERE id = $1`, [collectionId]);
  const stats = await pool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM source_artifacts WHERE collection_id = $1) AS artifacts,
      (SELECT COUNT(*)::int FROM extraction_runs WHERE collection_id = $1) AS extractions,
      (SELECT COUNT(*)::int FROM osint_harvest_findings WHERE collection_id = $1) AS observations,
      (SELECT COUNT(*)::int FROM observed_entities WHERE collection_id = $1) AS observed_entities,
      (SELECT COUNT(*)::int FROM collection_relationships WHERE collection_id = $1) AS relationships`,
    [collectionId],
  );

  const bySource = await pool.query(
    `SELECT source, COUNT(*)::int AS cnt FROM osint_harvest_findings
     WHERE collection_id = $1 GROUP BY source ORDER BY cnt DESC`,
    [collectionId],
  );

  const byType = await pool.query(
    `SELECT entity_type, COUNT(*)::int AS cnt FROM osint_harvest_findings
     WHERE collection_id = $1 GROUP BY entity_type ORDER BY cnt DESC LIMIT 15`,
    [collectionId],
  );

  const highlights = await pool.query(
    `SELECT id, entity_type, value, source, confidence FROM osint_harvest_findings
     WHERE collection_id = $1 ORDER BY confidence DESC NULLS LAST, created_at DESC LIMIT 10`,
    [collectionId],
  );

  const targetValue = (coll.rows[0]?.config as Record<string, unknown>)?.target_value || collectionId;

  return persistKnowledge(pool, {
    kind: 'collection_summary',
    title: `Collection Summary: ${targetValue}`,
    collection_id: collectionId,
    anchor_type: 'collection',
    anchor_id: collectionId,
    content: {
      collection: coll.rows[0] || { id: collectionId },
      stats: stats.rows[0],
      by_source: bySource.rows,
      by_entity_type: byType.rows,
      highlights: highlights.rows,
      synthesized_at: new Date().toISOString(),
    },
    refs: highlights.rows.map((h) => ({ ref_type: 'observation', ref_id: h.id, role: 'cites' })),
  });
}

export async function synthesizeNetwork(
  pool: Pool,
  opts: { anchor_value: string; collection_id?: string; depth?: number },
): Promise<KnowledgeObject> {
  const slice = await graphNeighbors(pool, {
    value: opts.anchor_value,
    depth: opts.depth ?? 2,
    relationship_origin: opts.collection_id ? undefined : 'observed',
    limit: 150,
  });

  return persistKnowledge(pool, {
    kind: 'network',
    title: `Network: ${opts.anchor_value}`,
    collection_id: opts.collection_id || null,
    anchor_type: 'value',
    anchor_id: opts.anchor_value,
    content: {
      anchor: slice.anchor,
      nodes: slice.nodes,
      edges: slice.edges,
      depth: slice.depth,
      node_count: slice.nodes.length,
      edge_count: slice.edges.length,
      synthesized_at: new Date().toISOString(),
    },
    refs: slice.edges.slice(0, 20).map((e) => ({ ref_type: 'relationship', ref_id: e.id })),
  });
}

export async function synthesizeProfile(
  pool: Pool,
  opts: { anchor_value: string; collection_id?: string },
): Promise<KnowledgeObject | null> {
  const resolved = await pool.query(
    `SELECT * FROM resolved_entities
     WHERE anchor_value ILIKE $1 OR canonical_name ILIKE $1 OR normalized_key ILIKE $2
     ORDER BY confidence DESC LIMIT 1`,
    [`%${opts.anchor_value}%`, `%${opts.anchor_value.toLowerCase()}%`],
  );
  if (!resolved.rowCount) return null;

  const re = resolved.rows[0];
  const members = await pool.query(
    `SELECT rem.*, oe.entity_type, oe.canonical_value, oe.stix_id, oe.observation_id
     FROM resolved_entity_members rem
     JOIN observed_entities oe ON oe.id = rem.observed_entity_id
     WHERE rem.resolved_entity_id = $1`,
    [re.id],
  );

  const observations = await pool.query(
    `SELECT f.id, f.entity_type, f.value, f.source, f.confidence, f.provenance_id
     FROM osint_harvest_findings f
     WHERE f.id = ANY($1::text[])`,
    [members.rows.map((m) => m.observation_id)],
  );

  return persistKnowledge(pool, {
    kind: 'profile',
    title: `Profile: ${re.canonical_name}`,
    collection_id: opts.collection_id || re.collection_id,
    anchor_type: 'resolved_entity',
    anchor_id: re.id,
    content: {
      resolved_entity: re,
      members: members.rows,
      observations: observations.rows,
      synthesized_at: new Date().toISOString(),
    },
    refs: [
      { ref_type: 'resolved_entity', ref_id: re.id, role: 'primary' },
      ...members.rows.map((m) => ({ ref_type: 'observed_entity', ref_id: m.observed_entity_id })),
    ],
  });
}

export async function getKnowledgeObject(pool: Pool, id: string): Promise<KnowledgeObject | null> {
  const r = await pool.query(`SELECT * FROM knowledge_objects WHERE id = $1`, [id]);
  return r.rowCount ? (r.rows[0] as KnowledgeObject) : null;
}

export async function listKnowledgeObjects(
  pool: Pool,
  opts: { kind?: string; collection_id?: string; limit?: number } = {},
): Promise<KnowledgeObject[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`kind = $${params.length}`);
  }
  if (opts.collection_id) {
    params.push(opts.collection_id);
    where.push(`collection_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 50, 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM knowledge_objects ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows as KnowledgeObject[];
}

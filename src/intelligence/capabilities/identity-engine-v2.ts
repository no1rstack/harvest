/**
 * Identity Engine v2 — graph-linked resolution (org ↔ domain ↔ cert).
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { ensureCollectionForRun } from '../core/collections.js';
import { insertProvenance } from '../core/provenance.js';
import { publishDomainEvent } from '../core/domain-events.js';
import type { IdentityResolutionResult } from './identity-engine.js';

export const IDENTITY_RESOLVER_V2 = 'identity-v2';

interface GraphCluster {
  anchor_value: string;
  entity_type: string;
  members: Array<{
    observed_entity_id: string;
    observation_id: string;
    entity_type: string;
    canonical_value: string;
    matched_by: string;
    confidence: number;
  }>;
}

/** Resolve organization infrastructure clusters via graph edges. */
export async function resolveIdentityGraphV2(
  pool: Pool,
  opts: {
    source_collection_id: string;
    anchor_value: string;
    initiated_by?: string;
  },
): Promise<IdentityResolutionResult> {
  const resolutionCollectionId = `rescol_v2_${crypto.randomBytes(8).toString('hex')}`;
  await ensureCollectionForRun(pool, {
    id: resolutionCollectionId,
    kind: 'resolution',
    parent_id: opts.source_collection_id,
    initiated_by: opts.initiated_by || 'identity-engine-v2',
    config: {
      source_collection_id: opts.source_collection_id,
      anchor_value: opts.anchor_value,
      resolver_version: IDENTITY_RESOLVER_V2,
    },
  });

  const anchor = opts.anchor_value.toLowerCase();
  const clusters: GraphCluster[] = [];

  // Cluster 1: all observed entities graph-connected to anchor within 2 hops
  const connected = await pool.query(
    `WITH RECURSIVE graph AS (
       SELECT oe.id AS observed_entity_id, oe.observation_id, oe.entity_type, oe.canonical_value,
              oe.confidence, oe.canonical_value AS seed, 0 AS depth
       FROM observed_entities oe
       WHERE oe.canonical_value LIKE $2 OR oe.canonical_value = $3
       UNION
       SELECT oe2.id, oe2.observation_id, oe2.entity_type, oe2.canonical_value,
              oe2.confidence, g.seed, g.depth + 1
       FROM graph g
       JOIN collection_relationships cr ON cr.source_value = g.canonical_value OR cr.target_value = g.canonical_value
       JOIN observed_entities oe2 ON oe2.canonical_value = CASE
         WHEN cr.source_value = g.canonical_value THEN cr.target_value
         ELSE cr.source_value END
       WHERE g.depth < 2
     )
     SELECT DISTINCT observed_entity_id, observation_id, entity_type, canonical_value, confidence
     FROM graph`,
    [opts.source_collection_id, `%${anchor}%`, anchor],
  );

  if (connected.rowCount) {
    const byType = new Map<string, GraphCluster['members']>();
    for (const row of connected.rows) {
      const et = row.entity_type as string;
      if (!byType.has(et)) byType.set(et, []);
      byType.get(et)!.push({
        observed_entity_id: row.observed_entity_id,
        observation_id: row.observation_id,
        entity_type: et,
        canonical_value: row.canonical_value,
        matched_by: 'graph_reachable',
        confidence: row.confidence ?? 0.75,
      });
    }

    for (const [entityType, members] of byType) {
      clusters.push({ anchor_value: anchor, entity_type: entityType, members });
    }
  }

  // Cluster 2: org via owned-by / registered-by edges
  const orgEdges = await pool.query(
    `SELECT cr.target_value AS org_value, cr.source_value, cr.relationship_type,
            oe.id AS observed_entity_id, oe.observation_id, oe.entity_type, oe.canonical_value, oe.confidence
     FROM collection_relationships cr
     JOIN observed_entities oe ON oe.canonical_value = cr.target_value AND oe.entity_type = 'Organization'
     WHERE cr.source_value LIKE $1
       AND cr.relationship_type IN ('owned-by','registered-by','belongs-to')
     LIMIT 50`,
    [`%${anchor}%`],
  );

  if (orgEdges.rowCount) {
    const orgMembers: GraphCluster['members'] = [];
    const seen = new Set<string>();
    for (const row of orgEdges.rows) {
      if (seen.has(row.observed_entity_id)) continue;
      seen.add(row.observed_entity_id);
      orgMembers.push({
        observed_entity_id: row.observed_entity_id,
        observation_id: row.observation_id,
        entity_type: 'Organization',
        canonical_value: row.canonical_value,
        matched_by: `graph_${row.relationship_type}`,
        confidence: (row.confidence ?? 0.8) as number,
      });
    }
    if (orgMembers.length) {
      clusters.push({ anchor_value: anchor, entity_type: 'Organization', members: orgMembers });
    }
  }

  const resolved_ids: string[] = [];
  let members_linked = 0;

  for (const cluster of clusters) {
    const normalizedKey = `${cluster.entity_type}:graph:${anchor}`;
    const id = `res_${crypto.createHash('sha256').update(normalizedKey).digest('hex').slice(0, 24)}`;
    const avgConf = cluster.members.reduce((s, m) => s + m.confidence, 0) / cluster.members.length;

    const prov = await insertProvenance(pool, {
      collection_id: resolutionCollectionId,
      provenance_class: 'inference',
      reproducible: true,
      subject_type: 'resolved_entity',
      subject_id: id,
      collector_id: 'identity-engine-v2',
      ontology_version: ACTIVE_ONTOLOGY_VERSION,
      payload: {
        resolver_version: IDENTITY_RESOLVER_V2,
        matched_by: 'graph_cluster',
        anchor_value: anchor,
        member_count: cluster.members.length,
      },
    });

    await pool.query(
      `INSERT INTO resolved_entities
        (id, collection_id, entity_type, canonical_name, normalized_key, confidence,
         resolver_version, ontology_version, provenance_id, anchor_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         confidence = GREATEST(resolved_entities.confidence, EXCLUDED.confidence),
         updated_at = NOW()`,
      [
        id,
        resolutionCollectionId,
        cluster.entity_type,
        cluster.entity_type === 'Organization'
          ? cluster.members[0]?.canonical_value || anchor
          : `${cluster.entity_type}:${anchor}`,
        normalizedKey,
        avgConf,
        IDENTITY_RESOLVER_V2,
        ACTIVE_ONTOLOGY_VERSION,
        prov.id,
        anchor,
      ],
    );

    for (let i = 0; i < cluster.members.length; i++) {
      const m = cluster.members[i];
      await pool.query(
        `INSERT INTO resolved_entity_members
          (resolved_entity_id, observed_entity_id, observation_id, matched_by, confidence, role)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (resolved_entity_id, observed_entity_id) DO NOTHING`,
        [id, m.observed_entity_id, m.observation_id, m.matched_by, m.confidence, i === 0 ? 'primary' : 'member'],
      );
      members_linked++;
    }

    resolved_ids.push(id);
    await publishDomainEvent(pool, {
      event_type: 'entity.resolved',
      aggregate_type: 'resolved_entity',
      aggregate_id: id,
      collection_id: resolutionCollectionId,
      payload: { resolver_version: IDENTITY_RESOLVER_V2, entity_type: cluster.entity_type, members: cluster.members.length },
    }).catch(() => {});
  }

  await pool.query(
    `UPDATE collections SET status = 'completed', finished_at = NOW(),
     stats = stats || $2::jsonb WHERE id = $1`,
    [resolutionCollectionId, JSON.stringify({ resolved_entities: resolved_ids.length, members_linked, resolver: IDENTITY_RESOLVER_V2 })],
  );

  return {
    collection_id: resolutionCollectionId,
    resolved_entities: resolved_ids.length,
    members_linked,
    resolved_ids,
  };
}

/** Run v1 canonical + v2 graph resolution. */
export async function resolveIdentityFull(
  pool: Pool,
  opts: { source_collection_id: string; anchor_value?: string },
): Promise<{ v1: IdentityResolutionResult; v2?: IdentityResolutionResult }> {
  const { resolveIdentityForCollection } = await import('./identity-engine.js');
  const v1 = await resolveIdentityForCollection(pool, opts);
  let v2: IdentityResolutionResult | undefined;
  if (opts.anchor_value) {
    v2 = await resolveIdentityGraphV2(pool, {
      source_collection_id: opts.source_collection_id,
      anchor_value: opts.anchor_value,
    });
  }
  return { v1, v2 };
}

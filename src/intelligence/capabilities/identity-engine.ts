/**
 * Identity Engine — resolve observed entities into canonical resolved entities.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { ensureCollectionForRun } from '../core/collections.js';
import { insertProvenance } from '../core/provenance.js';
import { publishDomainEvent } from '../core/domain-events.js';

export const IDENTITY_RESOLVER_VERSION = 'identity-v1';

export interface IdentityResolutionResult {
  collection_id: string;
  resolved_entities: number;
  members_linked: number;
  resolved_ids: string[];
}

function resolvedEntityId(entityType: string, normalizedKey: string): string {
  const seed = `${entityType}:${normalizedKey}`;
  return `res_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

/** Deterministic v1: cluster observed entities by entity_type + canonical_value. */
export async function resolveIdentityForCollection(
  pool: Pool,
  opts: {
    source_collection_id: string;
    anchor_value?: string;
    initiated_by?: string;
  },
): Promise<IdentityResolutionResult> {
  const resolutionCollectionId = `rescol_${crypto.randomBytes(8).toString('hex')}`;
  await ensureCollectionForRun(pool, {
    id: resolutionCollectionId,
    kind: 'resolution',
    parent_id: opts.source_collection_id,
    initiated_by: opts.initiated_by || 'identity-engine',
    config: {
      source_collection_id: opts.source_collection_id,
      anchor_value: opts.anchor_value,
      resolver_version: IDENTITY_RESOLVER_VERSION,
    },
  });

  const where: string[] = ['oe.collection_id = $1'];
  const params: unknown[] = [opts.source_collection_id];

  if (opts.anchor_value) {
    params.push(`%${opts.anchor_value.toLowerCase()}%`);
    where.push(`(oe.canonical_value LIKE $${params.length} OR oe.canonical_value = $${params.length + 1})`);
    params.push(opts.anchor_value.toLowerCase());
  }

  const clusters = await pool.query(
    `SELECT oe.entity_type, oe.canonical_value,
            array_agg(oe.id ORDER BY oe.created_at) AS observed_ids,
            array_agg(oe.observation_id ORDER BY oe.created_at) AS observation_ids,
            AVG(oe.confidence) AS avg_confidence,
            COUNT(*)::int AS cnt
     FROM observed_entities oe
     WHERE ${where.join(' AND ')}
     GROUP BY oe.entity_type, oe.canonical_value
     HAVING COUNT(*) >= 1
     ORDER BY cnt DESC
     LIMIT 200`,
    params,
  );

  const resolved_ids: string[] = [];
  let members_linked = 0;

  for (const row of clusters.rows) {
    const entityType = row.entity_type as string;
    const canonicalValue = row.canonical_value as string;
    const normalizedKey = `${entityType}:${canonicalValue}`;
    const id = resolvedEntityId(entityType, canonicalValue);
    const observedIds = row.observed_ids as string[];
    const observationIds = row.observation_ids as string[];

    const prov = await insertProvenance(pool, {
      collection_id: resolutionCollectionId,
      provenance_class: 'inference',
      reproducible: true,
      subject_type: 'resolved_entity',
      subject_id: id,
      collector_id: 'identity-engine',
      ontology_version: ACTIVE_ONTOLOGY_VERSION,
      id_seed: `${resolutionCollectionId}:resolved:${id}`,
      payload: {
        resolver_version: IDENTITY_RESOLVER_VERSION,
        matched_by: 'canonical',
        source_collection_id: opts.source_collection_id,
        member_count: observedIds.length,
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
        entityType,
        canonicalValue,
        normalizedKey,
        row.avg_confidence ?? 0.7,
        IDENTITY_RESOLVER_VERSION,
        ACTIVE_ONTOLOGY_VERSION,
        prov.id,
        opts.anchor_value || canonicalValue,
      ],
    );

    for (let i = 0; i < observedIds.length; i++) {
      await pool.query(
        `INSERT INTO resolved_entity_members
          (resolved_entity_id, observed_entity_id, observation_id, matched_by, confidence, role)
         VALUES ($1,$2,$3,'canonical',$4,$5)
         ON CONFLICT (resolved_entity_id, observed_entity_id) DO NOTHING`,
        [
          id,
          observedIds[i],
          observationIds[i],
          row.avg_confidence ?? 0.7,
          i === 0 ? 'primary' : 'member',
        ],
      );
      members_linked++;
    }

    resolved_ids.push(id);

    await publishDomainEvent(pool, {
      event_type: 'entity.resolved',
      aggregate_type: 'resolved_entity',
      aggregate_id: id,
      collection_id: resolutionCollectionId,
      ontology_version: ACTIVE_ONTOLOGY_VERSION,
      payload: {
        entity_type: entityType,
        canonical_name: canonicalValue,
        members: observedIds.length,
        source_collection_id: opts.source_collection_id,
      },
    }).catch(() => {});
  }

  await pool.query(
    `UPDATE collections SET status = 'completed', finished_at = NOW(),
     stats = stats || $2::jsonb WHERE id = $1`,
    [
      resolutionCollectionId,
      JSON.stringify({
        resolved_entities: resolved_ids.length,
        members_linked,
        source_collection_id: opts.source_collection_id,
      }),
    ],
  );

  return {
    collection_id: resolutionCollectionId,
    resolved_entities: resolved_ids.length,
    members_linked,
    resolved_ids,
  };
}

/** Resolve by target anchor across all collections for a value. */
export async function resolveIdentityForAnchor(
  pool: Pool,
  anchorValue: string,
  opts: { collection_id?: string } = {},
): Promise<IdentityResolutionResult[]> {
  if (opts.collection_id) {
    return [await resolveIdentityForCollection(pool, {
      source_collection_id: opts.collection_id,
      anchor_value: anchorValue,
    })];
  }

  const collections = await pool.query(
    `SELECT DISTINCT collection_id FROM osint_harvest_findings
     WHERE LOWER(value) LIKE $1 OR LOWER(value) = $2
     ORDER BY collection_id DESC LIMIT 5`,
    [`%${anchorValue.toLowerCase()}%`, anchorValue.toLowerCase()],
  );

  const results: IdentityResolutionResult[] = [];
  for (const row of collections.rows) {
    results.push(await resolveIdentityForCollection(pool, {
      source_collection_id: row.collection_id,
      anchor_value: anchorValue,
    }));
  }
  return results;
}

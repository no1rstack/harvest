/**
 * STIX export — interoperability projection from Intelligence Core collection.
 */

import type { Pool } from 'pg';

export interface StixBundle {
  type: 'bundle';
  id: string;
  spec_version: '2.1';
  objects: Record<string, unknown>[];
}

export async function exportCollectionAsStix(
  pool: Pool,
  collectionId: string,
): Promise<StixBundle> {
  const observations = await pool.query(
    `SELECT id, stix_id, stix_type, entity_type, value, confidence, provenance, raw, observed_at
     FROM osint_harvest_findings WHERE collection_id = $1`,
    [collectionId],
  );

  const relationships = await pool.query(
    `SELECT id, relationship_type, source_stix_id, source_value, target_type, target_value,
            target_stix_id, confidence, relationship_origin
     FROM collection_relationships WHERE collection_id = $1`,
    [collectionId],
  );

  const objects: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const row of observations.rows) {
    const raw = typeof row.raw === 'string' ? JSON.parse(row.raw) : row.raw || {};
    const stixObject = raw.stix_object || {
      type: row.stix_type,
      spec_version: '2.1',
      id: row.stix_id,
      value: row.value,
      created: row.observed_at,
      modified: row.observed_at,
    };
    if (!seen.has(row.stix_id)) {
      seen.add(row.stix_id);
      objects.push(stixObject);
    }
  }

  for (const row of relationships.rows) {
    if (!row.source_stix_id || !row.target_stix_id) continue;
    const relId = `relationship--${row.id.replace(/^crel_/, '')}`;
    if (seen.has(relId)) continue;
    seen.add(relId);
    objects.push({
      type: 'relationship',
      spec_version: '2.1',
      id: relId,
      relationship_type: row.relationship_type,
      source_ref: row.source_stix_id,
      target_ref: row.target_stix_id,
      confidence: row.confidence != null ? Math.round(row.confidence * 100) : undefined,
      description: `${row.source_value} → ${row.target_value}`,
    });
  }

  const resolved = await pool.query(
    `SELECT * FROM resolved_entities WHERE collection_id IN (
       SELECT id FROM collections WHERE parent_id = $1 OR id = $1
     )`,
    [collectionId],
  );

  for (const row of resolved.rows) {
    const id = `identity--${row.id.replace(/^res_/, '')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    objects.push({
      type: 'identity',
      spec_version: '2.1',
      id,
      name: row.canonical_name,
      identity_class: row.entity_type === 'Organization' ? 'organization' : 'individual',
      confidence: row.confidence != null ? Math.round(row.confidence * 100) : undefined,
      labels: ['resolved-entity', row.entity_type],
    });
  }

  return {
    type: 'bundle',
    id: `bundle--${collectionId}`,
    spec_version: '2.1',
    objects,
  };
}

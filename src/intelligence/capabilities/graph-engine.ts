/**
 * Graph Engine — traversal capability over observed entities, resolved entities, relationships.
 * Not a persistence layer.
 */

import type { Pool } from 'pg';

export interface GraphNode {
  ref_type: 'observed_entity' | 'resolved_entity' | 'observation' | 'value';
  ref_id: string;
  entity_type?: string;
  value?: string;
  stix_id?: string | null;
}

export interface GraphEdge {
  id: string;
  relationship_type: string;
  relationship_origin: string;
  source_value: string;
  target_type: string;
  target_value: string;
  confidence: number | null;
  collection_id: string | null;
}

export interface GraphSlice {
  anchor: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  depth: number;
}

export async function graphNeighbors(
  pool: Pool,
  opts: {
    value?: string;
    stix_id?: string;
    observation_id?: string;
    depth?: number;
    relationship_origin?: string;
    limit?: number;
  },
): Promise<GraphSlice> {
  const depth = Math.min(opts.depth ?? 1, 3);
  const limit = Math.min(opts.limit ?? 100, 500);

  let anchorValue = opts.value?.trim();
  let anchorStix = opts.stix_id?.trim();

  if (!anchorValue && opts.observation_id) {
    const obs = await pool.query(
      `SELECT value, stix_id, entity_type FROM osint_harvest_findings WHERE id = $1`,
      [opts.observation_id],
    );
    if (obs.rowCount) {
      anchorValue = obs.rows[0].value;
      anchorStix = obs.rows[0].stix_id;
    }
  }

  if (!anchorValue && !anchorStix) {
    return { anchor: { ref_type: 'value', ref_id: '' }, nodes: [], edges: [], depth };
  }

  const anchor: GraphNode = {
    ref_type: 'value',
    ref_id: anchorValue || anchorStix || '',
    value: anchorValue,
    stix_id: anchorStix,
  };

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const visited = new Set<string>();
  let frontier = [anchorValue || ''].filter(Boolean);

  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const val of frontier) {
      if (!val || visited.has(val)) continue;
      visited.add(val);

      const where: string[] = ['(source_value = $1 OR target_value = $1)'];
      const params: unknown[] = [val];
      if (opts.relationship_origin) {
        params.push(opts.relationship_origin);
        where.push(`relationship_origin = $${params.length}`);
      }
      params.push(limit);

      const r = await pool.query(
        `SELECT * FROM collection_relationships
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params,
      );

      for (const row of r.rows) {
        edges.push({
          id: row.id,
          relationship_type: row.relationship_type,
          relationship_origin: row.relationship_origin || 'observed',
          source_value: row.source_value,
          target_type: row.target_type,
          target_value: row.target_value,
          confidence: row.confidence,
          collection_id: row.collection_id,
        });

        const other = row.source_value === val ? row.target_value : row.source_value;
        if (!visited.has(other)) {
          next.push(other);
          nodes.set(other, {
            ref_type: 'value',
            ref_id: other,
            value: other,
            entity_type: row.target_type,
          });
        }
      }
    }
    frontier = next;
  }

  if (anchorValue) {
    const oe = await pool.query(
      `SELECT * FROM observed_entities WHERE canonical_value = $1 OR observation_id IN (
         SELECT id FROM osint_harvest_findings WHERE value = $1 LIMIT 5
       ) LIMIT 10`,
      [anchorValue.toLowerCase(), anchorValue],
    );
    for (const row of oe.rows) {
      nodes.set(row.canonical_value, {
        ref_type: 'observed_entity',
        ref_id: row.id,
        entity_type: row.entity_type,
        value: row.canonical_value,
        stix_id: row.stix_id,
      });
    }
  }

  return {
    anchor,
    nodes: [...nodes.values()],
    edges,
    depth,
  };
}

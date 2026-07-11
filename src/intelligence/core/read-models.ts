/**
 * Read models — CQRS projections for dashboards (NoirStack, ops console).
 */

import type { Pool } from 'pg';

export interface ReadModelRefreshResult {
  collection_stats: number;
  target_dashboard: number;
  entity_index: number;
}

export async function refreshReadModels(pool: Pool): Promise<ReadModelRefreshResult> {
  // Collection stats
  const collections = await pool.query(
    `SELECT c.id, c.config, c.finished_at
     FROM collections c
     WHERE c.kind IN ('scheduled_crawl','watchlist_run')
     ORDER BY c.finished_at DESC NULLS LAST LIMIT 100`,
  );

  let collection_stats = 0;
  for (const col of collections.rows) {
    const config = typeof col.config === 'string' ? JSON.parse(col.config) : col.config || {};
    const targetValue = config.target_value || null;

    const stats = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM osint_harvest_findings WHERE collection_id = $1) AS observations,
        (SELECT COUNT(*)::int FROM source_artifacts WHERE collection_id = $1) AS artifacts,
        (SELECT COUNT(*)::int FROM collection_relationships WHERE collection_id = $1) AS relationships,
        (SELECT COUNT(*)::int FROM resolved_entities WHERE collection_id = $1) AS resolved_entities,
        (SELECT COUNT(*)::int FROM knowledge_objects WHERE collection_id = $1) AS knowledge_objects`,
      [col.id],
    );

    const bySource = await pool.query(
      `SELECT source, COUNT(*)::int AS cnt FROM osint_harvest_findings
       WHERE collection_id = $1 GROUP BY source ORDER BY cnt DESC LIMIT 10`,
      [col.id],
    );

    const byType = await pool.query(
      `SELECT entity_type, COUNT(*)::int AS cnt FROM osint_harvest_findings
       WHERE collection_id = $1 GROUP BY entity_type ORDER BY cnt DESC LIMIT 10`,
      [col.id],
    );

    const s = stats.rows[0];
    await pool.query(
      `INSERT INTO rm_collection_stats
        (collection_id, target_value, observations, artifacts, relationships, resolved_entities,
         knowledge_objects, top_sources, top_entity_types, refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,NOW())
       ON CONFLICT (collection_id) DO UPDATE SET
         target_value = EXCLUDED.target_value,
         observations = EXCLUDED.observations,
         artifacts = EXCLUDED.artifacts,
         relationships = EXCLUDED.relationships,
         resolved_entities = EXCLUDED.resolved_entities,
         knowledge_objects = EXCLUDED.knowledge_objects,
         top_sources = EXCLUDED.top_sources,
         top_entity_types = EXCLUDED.top_entity_types,
         refreshed_at = NOW()`,
      [
        col.id,
        targetValue,
        s.observations,
        s.artifacts,
        s.relationships,
        s.resolved_entities,
        s.knowledge_objects,
        JSON.stringify(bySource.rows),
        JSON.stringify(byType.rows),
      ],
    );
    collection_stats++;
  }

  // Target dashboard
  const targets = await pool.query(
    `SELECT DISTINCT target_value FROM (
       SELECT config->>'target_value' AS target_value
       FROM collections WHERE kind = 'scheduled_crawl' AND config->>'target_value' IS NOT NULL
       UNION
       SELECT normalized_value AS target_value FROM collection_targets WHERE enabled = TRUE
     ) t WHERE target_value IS NOT NULL AND target_value <> ''`,
  );

  let target_dashboard = 0;
  for (const t of targets.rows) {
    const tv = t.target_value as string;
    const agg = await pool.query(
      `SELECT
        (SELECT COUNT(DISTINCT collection_id)::int FROM osint_harvest_findings WHERE value ILIKE $1) AS collections,
        (SELECT COUNT(*)::int FROM osint_harvest_findings WHERE value ILIKE $1) AS observations,
        (SELECT COUNT(*)::int FROM resolved_entities WHERE anchor_value ILIKE $1) AS resolved_entities,
        (SELECT COUNT(*)::int FROM collection_relationships WHERE source_value ILIKE $1 OR target_value ILIKE $1) AS graph_edges,
        (SELECT MAX(created_at) FROM osint_harvest_findings WHERE value ILIKE $1) AS last_collected_at`,
      [`%${tv}%`],
    );
    const a = agg.rows[0];
    await pool.query(
      `INSERT INTO rm_target_dashboard
        (target_value, collections, observations, resolved_entities, graph_edges, last_collected_at, refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (target_value) DO UPDATE SET
         collections = EXCLUDED.collections,
         observations = EXCLUDED.observations,
         resolved_entities = EXCLUDED.resolved_entities,
         graph_edges = EXCLUDED.graph_edges,
         last_collected_at = EXCLUDED.last_collected_at,
         refreshed_at = NOW()`,
      [tv, a.collections, a.observations, a.resolved_entities, a.graph_edges, a.last_collected_at],
    );
    target_dashboard++;
  }

  // Entity index
  const entities = await pool.query(
    `SELECT entity_type, canonical_value,
            COUNT(*)::int AS observation_count,
            COUNT(DISTINCT collection_id)::int AS collection_count,
            AVG(confidence) AS avg_confidence
     FROM observed_entities
     GROUP BY entity_type, canonical_value
     ORDER BY observation_count DESC
     LIMIT 500`,
  );

  let entity_index = 0;
  for (const row of entities.rows) {
    const key = `${row.entity_type}:${row.canonical_value}`;
    const sources = await pool.query(
      `SELECT f.source, COUNT(*)::int AS cnt
       FROM osint_harvest_findings f
       JOIN observed_entities oe ON oe.observation_id = f.id
       WHERE oe.entity_type = $1 AND oe.canonical_value = $2
       GROUP BY f.source ORDER BY cnt DESC LIMIT 5`,
      [row.entity_type, row.canonical_value],
    );

    await pool.query(
      `INSERT INTO rm_entity_index
        (entity_key, entity_type, canonical_value, observation_count, collection_count, avg_confidence, sources, refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
       ON CONFLICT (entity_key) DO UPDATE SET
         observation_count = EXCLUDED.observation_count,
         collection_count = EXCLUDED.collection_count,
         avg_confidence = EXCLUDED.avg_confidence,
         sources = EXCLUDED.sources,
         refreshed_at = NOW()`,
      [
        key,
        row.entity_type,
        row.canonical_value,
        row.observation_count,
        row.collection_count,
        row.avg_confidence,
        JSON.stringify(sources.rows),
      ],
    );
    entity_index++;
  }

  return { collection_stats, target_dashboard, entity_index };
}

export async function getTargetDashboard(pool: Pool, targetValue: string) {
  const r = await pool.query(`SELECT * FROM rm_target_dashboard WHERE target_value ILIKE $1`, [`%${targetValue}%`]);
  return r.rows[0] || null;
}

export async function listEntityIndex(
  pool: Pool,
  opts: { entity_type?: string; limit?: number } = {},
) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.entity_type) {
    params.push(opts.entity_type);
    where.push(`entity_type = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 100, 500));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM rm_entity_index ${whereSql} ORDER BY observation_count DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

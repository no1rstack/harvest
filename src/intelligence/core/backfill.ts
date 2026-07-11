/**
 * Backfill Phase 1 lineage for legacy observations missing artifact links.
 */

import type { Pool } from 'pg';
import type { CollectionObservation } from '../../collection/types.js';
import type { ExtractionRun } from './extractions.js';
import { persistObservationLineage } from './ingest.js';
import { ensureIntelligenceCoreSchema } from './collections.js';

export async function backfillObservationLineage(
  pool: Pool,
  opts: { limit?: number } = {},
): Promise<{ processed: number; linked: number; skipped: number }> {
  await ensureIntelligenceCoreSchema(pool);
  const limit = Math.min(opts.limit ?? 500, 5000);

  const rows = await pool.query(
    `SELECT f.*, c.id AS coll_id
     FROM osint_harvest_findings f
     LEFT JOIN collections c ON c.id = COALESCE(f.collection_id, f.run_id)
     WHERE f.source_artifact_id IS NULL
       AND COALESCE(f.collection_id, f.run_id) IS NOT NULL
     ORDER BY f.created_at DESC
     LIMIT $1`,
    [limit],
  );

  let linked = 0;
  let skipped = 0;
  const extractionCache = new Map<string, ExtractionRun>();

  for (const row of rows.rows) {
    const collection_id = row.collection_id || row.run_id;
    if (!collection_id) {
      skipped++;
      continue;
    }

    // Ensure collection exists for legacy runs
    await pool.query(
      `INSERT INTO collections (id, kind, status, product, initiated_by, legacy_run_id, started_at)
       VALUES ($1,'scheduled_crawl','completed',$2,'backfill',$1,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [collection_id, row.product || 'shared'],
    );

    const raw = typeof row.raw === 'string' ? JSON.parse(row.raw) : row.raw || {};
    const stix_object = raw.stix_object || {};
    const obs: CollectionObservation = {
      stix_type: row.stix_type || 'x-collection-observable',
      stix_id: row.stix_id || row.id,
      entity_type: row.entity_type,
      observable_type: row.observable_type,
      ontology_version: row.ontology_version,
      value: row.value,
      label: row.label,
      title: row.title,
      description: row.description,
      severity: row.severity,
      confidence: row.confidence,
      tags: row.tags,
      source: row.source,
      source_id: row.source_id,
      observed_at: row.observed_at,
      content_hash: row.content_hash,
      stix_object,
      provenance: typeof row.provenance === 'string' ? JSON.parse(row.provenance) : row.provenance || {},
      raw,
      related: typeof row.related === 'string' ? JSON.parse(row.related) : row.related || [],
    };

    try {
      const lineage = await persistObservationLineage(pool, {
        collection_id,
        observation_id: row.id,
        observation: obs,
        extractionCache,
      });
      await pool.query(
        `UPDATE osint_harvest_findings
         SET collection_id = COALESCE(collection_id, $2),
             source_artifact_id = $3, extraction_run_id = $4, provenance_id = $5
         WHERE id = $1`,
        [row.id, collection_id, lineage.source_artifact_id, lineage.extraction_run_id, lineage.provenance_id],
      );
      linked++;
    } catch {
      skipped++;
    }
  }

  return { processed: rows.rowCount || 0, linked, skipped };
}

/**
 * Collections — root aggregate for Intelligence Core ingest sessions.
 */

import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { INTELLIGENCE_CORE_SCHEMA_SQL } from './schema.js';
import { INTELLIGENCE_CORE_PHASE1_SQL } from './phase1-schema.js';
import { INTELLIGENCE_CORE_PHASE2_SQL } from './phase2-schema.js';
import { INTELLIGENCE_CORE_PHASE3_SQL } from './phase3-schema.js';

export type CollectionKind =
  | 'scheduled_crawl'
  | 'watchlist_run'
  | 'rss_sync'
  | 'investigation_import'
  | 'analyst_upload'
  | 'bulk_import'
  | 'discovery_fanout'
  | 'resolution'
  | 'knowledge_synthesis';

export type CollectionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled'
  | 'archived';

export interface CollectionRecord {
  id: string;
  kind: CollectionKind | string;
  status: CollectionStatus | string;
  product: string;
  case_id: number | null;
  target_id: string | null;
  initiated_by: string;
  ontology_version: string;
  parent_id: string | null;
  config: Record<string, unknown>;
  stats: Record<string, unknown>;
  cascades_run_id: string | null;
  legacy_run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export async function ensureIntelligenceCoreSchema(pool: Pool): Promise<void> {
  await pool.query(INTELLIGENCE_CORE_SCHEMA_SQL);
  await pool.query(INTELLIGENCE_CORE_PHASE1_SQL);
  await pool.query(INTELLIGENCE_CORE_PHASE2_SQL);
  await pool.query(INTELLIGENCE_CORE_PHASE3_SQL);
}

export async function ensureCollectionForRun(
  pool: Pool,
  opts: {
    id: string;
    kind?: CollectionKind | string;
    product?: string;
    case_id?: number | null;
    target_id?: string | null;
    initiated_by?: string;
    ontology_version?: string;
    cascades_run_id?: string | null;
    legacy_run_id?: string | null;
    parent_id?: string | null;
    config?: Record<string, unknown>;
  },
): Promise<CollectionRecord> {
  await ensureIntelligenceCoreSchema(pool);
  const ontology_version = opts.ontology_version || ACTIVE_ONTOLOGY_VERSION;
  const kind = opts.kind || 'scheduled_crawl';

  await pool.query(
    `INSERT INTO collections
      (id, kind, status, product, case_id, target_id, initiated_by, ontology_version,
       cascades_run_id, legacy_run_id, parent_id, config, started_at)
     VALUES ($1,$2,'running',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = CASE WHEN collections.status IN ('completed','failed','cancelled','archived')
                     THEN collections.status ELSE 'running' END,
       cascades_run_id = COALESCE(EXCLUDED.cascades_run_id, collections.cascades_run_id),
       target_id = COALESCE(EXCLUDED.target_id, collections.target_id),
       parent_id = COALESCE(EXCLUDED.parent_id, collections.parent_id)
     `,
    [
      opts.id,
      kind,
      opts.product || 'shared',
      opts.case_id ?? null,
      opts.target_id ?? null,
      opts.initiated_by || 'collection-platform',
      ontology_version,
      opts.cascades_run_id ?? opts.id,
      opts.legacy_run_id ?? opts.id,
      opts.parent_id ?? null,
      JSON.stringify(opts.config || {}),
    ],
  );

  // collections table has no updated_at in schema - fix the ON CONFLICT - I used updated_at but didn't define it. Let me fix schema or remove updated_at from query.

  const r = await pool.query(`SELECT * FROM collections WHERE id = $1`, [opts.id]);
  return r.rows[0] as CollectionRecord;
}

export async function finishCollection(
  pool: Pool,
  opts: {
    id: string;
    status: CollectionStatus | string;
    stats?: Record<string, unknown>;
  },
): Promise<void> {
  await pool.query(
    `UPDATE collections
     SET status = $2,
         finished_at = NOW(),
         stats = COALESCE(stats, '{}'::jsonb) || $3::jsonb
     WHERE id = $1`,
    [opts.id, opts.status, JSON.stringify(opts.stats || {})],
  );
}

/** Backfill collections from legacy osint_harvest_runs */
export async function backfillCollectionsFromRuns(pool: Pool): Promise<number> {
  await ensureIntelligenceCoreSchema(pool);
  const runs = await pool.query(`SELECT * FROM osint_harvest_runs ORDER BY started_at`);
  let n = 0;
  for (const run of runs.rows) {
    const id = run.id as string;
    await pool.query(
      `INSERT INTO collections
        (id, kind, status, product, case_id, initiated_by, ontology_version,
         legacy_run_id, cascades_run_id, started_at, finished_at, stats)
       VALUES ($1,'scheduled_crawl',$2,$3,$4,$5,$6,$7,$7,$8,$9,$10::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : 'completed',
        run.product || 'shared',
        run.case_id ?? null,
        run.user_id || 'harvest',
        ACTIVE_ONTOLOGY_VERSION,
        id,
        run.started_at,
        run.finished_at,
        JSON.stringify({
          total_findings: run.total_findings,
          inserted: run.inserted,
          skipped: run.skipped,
        }),
      ],
    );
    await pool.query(
      `UPDATE osint_harvest_runs SET collection_id = $2 WHERE id = $1 AND collection_id IS NULL`,
      [id, id],
    );
    await pool.query(
      `UPDATE osint_harvest_findings SET collection_id = $2, ontology_version = $3
       WHERE run_id = $1 AND collection_id IS NULL`,
      [id, id, ACTIVE_ONTOLOGY_VERSION],
    );
    n++;
  }
  return n;
}

/**
 * Phase 0 bootstrap — ontology registry + collections root + domain events.
 */

import type { Pool } from 'pg';
import { seedOntologyV1, hydrateOntologyFromPool } from '../ontology/registry.js';
import { backfillCollectionsFromRuns, ensureIntelligenceCoreSchema } from './collections.js';
import { applyOntologyPlugins } from '../plugins/types.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { backfillObservationLineage } from './backfill.js';
import { ensureAutomationRules } from '../capabilities/automation-engine.js';
import { runAutomationForCollection } from '../capabilities/automation-engine.js';
import { refreshReadModels } from './read-models.js';

export interface IntelligenceBootstrapResult {
  ontology_version: string;
  ontology_seeded: boolean;
  collections_backfilled: number;
  plugins_applied: number;
  lineage_backfill?: { processed: number; linked: number; skipped: number };
  automation_rules_seeded?: number;
  post_collection_runs?: number;
  read_models?: { collection_stats: number; target_dashboard: number; entity_index: number };
}

export async function bootstrapIntelligenceCore(pool: Pool): Promise<IntelligenceBootstrapResult> {
  await ensureIntelligenceCoreSchema(pool);
  const { version, seeded } = await seedOntologyV1(pool);
  const plugins_applied = await applyOntologyPlugins(pool, version);
  await hydrateOntologyFromPool(pool, version);
  const collections_backfilled = await backfillCollectionsFromRuns(pool);
  const lineage_backfill = await backfillObservationLineage(pool, { limit: 500 });
  const automation_rules_seeded = await ensureAutomationRules(pool);

  // Run post-collection on recent completed collections without knowledge summaries
  let post_collection_runs = 0;
  const recent = await pool.query(
    `SELECT c.id, c.config FROM collections c
     WHERE c.kind = 'scheduled_crawl' AND c.status IN ('completed','completed_with_warnings')
       AND NOT EXISTS (
         SELECT 1 FROM knowledge_objects ko
         WHERE ko.collection_id = c.id AND ko.kind = 'collection_summary'
       )
     ORDER BY c.finished_at DESC NULLS LAST LIMIT 10`,
  );
  for (const row of recent.rows) {
    const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {};
    try {
      await runAutomationForCollection(pool, row.id, {
        target_value: config.target_value,
        terminal_status: 'completed',
      });
      post_collection_runs++;
    } catch {
      /* best-effort */
    }
  }

  const read_models = await refreshReadModels(pool);

  return {
    ontology_version: ACTIVE_ONTOLOGY_VERSION,
    ontology_seeded: seeded,
    collections_backfilled,
    plugins_applied,
    lineage_backfill,
    automation_rules_seeded,
    post_collection_runs,
    read_models,
  };
}

/** @deprecated use bootstrapIntelligenceCore */
export async function bootstrapIntelligenceCorePhase0(pool: Pool): Promise<IntelligenceBootstrapResult> {
  return bootstrapIntelligenceCore(pool);
}

/**
 * Post-collection capabilities — identity v2, knowledge, automation, read models.
 */

import type { Pool } from 'pg';
import { runAutomationForCollection } from '../capabilities/automation-engine.js';
import { refreshReadModels } from './read-models.js';

export interface PostCollectionResult {
  automation: Array<{ rule_id: string; status: string; result: Record<string, unknown> }>;
  read_models?: { collection_stats: number; target_dashboard: number; entity_index: number };
}

export async function runPostCollectionCapabilities(
  pool: Pool,
  opts: {
    collection_id: string;
    target_value?: string;
    terminal_status?: string;
  },
): Promise<PostCollectionResult> {
  if (opts.terminal_status === 'failed') {
    return { automation: [] };
  }

  const automation = await runAutomationForCollection(pool, opts.collection_id, {
    target_value: opts.target_value,
    terminal_status: opts.terminal_status,
  });

  let read_models;
  try {
    read_models = await refreshReadModels(pool);
  } catch {
    /* best-effort */
  }

  return { automation, read_models };
}

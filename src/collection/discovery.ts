/**
 * Discovery Engine — collect → discover → new targets → registry.
 */

import type { Pool } from 'pg';
import { inferAssetType } from './asset-types.js';
import {
  entityTypeToAssetType,
  ruleForRelation,
  rulesForSourceType,
  TARGET_DEPENDENCIES_SQL,
} from './dependencies.js';
import { resolveTargetStrategy } from './strategies.js';
import type { CollectionObservation, CollectionTarget } from './types.js';
import { upsertTarget, normalizeTargetValue } from './targetRegistry.js';
import { publishCollectionEvent } from './events.js';

export { TARGET_DEPENDENCIES_SQL };

export interface DiscoveryCandidate {
  value: string;
  target_type: string;
  relation: string;
  confidence?: number;
}

export async function ensureDependencySchema(pool: Pool): Promise<void> {
  await pool.query(TARGET_DEPENDENCIES_SQL);
}

function relationFromEdge(relation: string): 'discovers' | 'resolves_to' | 'belongs_to' | 'owned_by' | 'from_source' {
  const r = relation.toLowerCase();
  if (r.includes('resolve') || r.includes('points')) return 'resolves_to';
  if (r.includes('belong') || r.includes('member')) return 'belongs_to';
  if (r.includes('own') || r.includes('registrant')) return 'owned_by';
  if (r === 'from_source' || r.startsWith('from_source')) return 'from_source';
  return 'discovers';
}

export function extractDiscoveryCandidates(
  observations: Array<Pick<CollectionObservation, 'related' | 'entity_type' | 'value'>>,
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const obs of observations) {
    if (!obs.related?.length) continue;
    for (const edge of obs.related) {
      if (!edge.value?.trim()) continue;
      const assetType = entityTypeToAssetType(edge.type) || inferAssetType(edge.value);
      const key = `${assetType}:${normalizeTargetValue(edge.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        value: edge.value.trim(),
        target_type: assetType,
        relation: edge.relation || 'discovers',
        confidence: 0.7,
      });
    }
  }
  return candidates;
}

export async function runDiscoveryForTarget(
  pool: Pool,
  parent: CollectionTarget,
  candidates: DiscoveryCandidate[],
  opts: { workflowRunId?: string; maxDepth?: number; dryRun?: boolean } = {},
): Promise<{ discovered: number; skipped: number; targets: string[] }> {
  await ensureDependencySchema(pool);

  const strategy = resolveTargetStrategy(parent);
  if (!strategy.auto_discover && !parent.metadata?.force_discover) {
    return { discovered: 0, skipped: candidates.length, targets: [] };
  }

  const maxDepth = opts.maxDepth ?? strategy.stopping_conditions?.max_depth ?? 3;
  const parentDepth = parent.discovery_depth ?? (parent.metadata?.discovery_depth as number) ?? 0;
  if (parentDepth >= maxDepth) {
    return { discovered: 0, skipped: candidates.length, targets: [] };
  }

  const rules = rulesForSourceType(parent.target_type);
  let discovered = 0;
  let skipped = 0;
  const targetIds: string[] = [];

  for (const cand of candidates) {
    const rel = relationFromEdge(cand.relation);
    const rule =
      ruleForRelation(parent.target_type, rel, cand.target_type) ||
      rules.find((r) => r.target_type === cand.target_type);

    if (!rule) {
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      discovered++;
      continue;
    }

    const child = await upsertTarget(pool, {
      target_type: cand.target_type as CollectionTarget['target_type'],
      value: cand.value,
      product: parent.product,
      case_id: parent.case_id,
      workflow_template: rule.workflow_template,
      collection_strategy: rule.strategy,
      origin: 'discovery',
      origin_ref: `discovery:${parent.id}`,
      source: `discovery:${parent.value}`,
      metadata: {
        parent_target_id: parent.id,
        discovery_depth: parentDepth + 1,
        discovery_relation: cand.relation,
        discovered_from_run: opts.workflowRunId,
      },
    });

    await pool.query(
      `INSERT INTO collection_target_dependencies
        (parent_target_id, child_target_id, relation, source_type, target_type, discovered_value, depth, rule_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        parent.id,
        child.id,
        rule.relation,
        parent.target_type,
        rule.target_type,
        cand.value,
        parentDepth + 1,
        rule.id,
      ],
    );

    await pool.query(
      `UPDATE collection_targets SET
         parent_target_id = COALESCE(parent_target_id, $2),
         discovery_depth = GREATEST(COALESCE(discovery_depth, 0), $3),
         collection_strategy = COALESCE(collection_strategy, $4)
       WHERE id = $1`,
      [child.id, parent.id, parentDepth + 1, rule.strategy],
    );

    await publishCollectionEvent(pool, {
      event_type: 'target.discovered',
      target_id: child.id,
      run_id: opts.workflowRunId,
      payload: {
        parent_target_id: parent.id,
        parent_value: parent.value,
        discovered_value: cand.value,
        target_type: cand.target_type,
        relation: cand.relation,
        workflow_template: rule.workflow_template,
        strategy: rule.strategy,
      },
    });

    // Immediately enqueue child Collection runs (word→universe automation).
    // Disable with COLLECTION_DISCOVERY_ENQUEUE=0
    const enqueue =
      process.env.COLLECTION_DISCOVERY_ENQUEUE !== '0' &&
      process.env.COLLECTION_DISCOVERY_ENQUEUE !== 'false';
    if (enqueue) {
      try {
        const { submitTargetToCascades } = await import('./submitDue.js');
        await submitTargetToCascades(pool, child, {
          actor: 'discovery',
          force: true,
        });
      } catch (err) {
        console.warn(
          `[discovery] enqueue failed for ${child.id}: ${(err as Error).message}`,
        );
      }
    }

    discovered++;
    targetIds.push(child.id);
  }

  return { discovered, skipped, targets: targetIds };
}

export async function discoverFromObservations(
  pool: Pool,
  parent: CollectionTarget,
  observations: CollectionObservation[],
  opts: { workflowRunId?: string; dryRun?: boolean } = {},
): Promise<{ discovered: number; skipped: number; sources_exhausted?: number }> {
  const candidates = extractDiscoveryCandidates(observations);
  const result = await runDiscoveryForTarget(pool, parent, candidates, opts);

  const { exhaustSourcesFromObservations } = await import('./source-exhaustion.js');
  const sources = await exhaustSourcesFromObservations(pool, parent, observations, opts);

  return {
    discovered: result.discovered + sources.exhausted,
    skipped: result.skipped + sources.skipped,
    sources_exhausted: sources.exhausted,
  };
}

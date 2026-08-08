/**
 * Community intelligence — keyword extraction, slice/dice queries, and collection expansion.
 */

import type { Pool } from 'pg';
import { ensureCollectionSchema, upsertTarget } from '../collection/targetRegistry.js';
import { submitTargetIdToCascades } from '../collection/submitDue.js';
import type { CollectionTarget } from '../collection/types.js';
import { buildFeedEnrichment, enrichCommunityPayload, enrichCommunityPayloadAsync } from './feedEnrichment.js';
import { expandKeywordsForCollection, goalFromCategory } from './keywordExpansion.js';
import { scoreEvidenceSync, type ObservationEvidence, type SourceDescriptor, type ExtractionDescriptor } from '../intelligence/confidence/index.js';
import {
  getCommunityItemById,
  listCommunityItems,
  searchCommunityItems,
  type CommunityQueryOptions,
  upsertCommunityItems,
} from './communityStorePg.js';
import type { CommunityItem } from './communityTypes.js';

export interface ExpandFromFeedsOptions {
  keywords?: string[];
  itemIds?: string[];
  hours?: number;
  stream?: string;
  category?: string;
  goal?: string;
  expand?: boolean;
  enqueue?: boolean;
  dryRun?: boolean;
  maxTargets?: number;
  product?: string;
  /** Minimum evidence confidence threshold for seeding targets (0-1, default 0.40) */
  minConfidence?: number;
  /** Whether to use LLM scoring review for borderline items */
  llmScore?: boolean;
}

export interface ExpandFromFeedsResult {
  seeds: string[];
  expanded: Array<{ term: string; source: string; confidence: number }>;
  targets: Array<{ id: string; value: string; created: boolean; cascades?: unknown }>;
  enqueued: number;
  failed: number;
  message?: string;
}

function keywordsFromItem(item: CommunityItem): string[] {
  const enrichment = item.payload?.enrichment as { keywords?: string[]; entities?: string[] } | undefined;
  const kw = enrichment?.keywords || [];
  const ent = enrichment?.entities || [];
  return [...new Set([...kw, ...ent])].filter(Boolean);
}

function inferSourceClassFromCategory(category: string): import('../intelligence/confidence/types.js').SourceClass {
  const cat = category.toLowerCase();
  if (['government', 'congress', 'legislation', 'regulation', 'legal', 'executive', 'fiscal'].some((c) => cat.includes(c))) return 'government';
  if (['finance', 'markets', 'stocks', 'crypto', 'commodities', 'financial', 'business', 'economics'].some((c) => cat.includes(c))) return 'financial';
  if (['science', 'research', 'academia', 'physics', 'analyst-report'].some((c) => cat.includes(c))) return 'research';
  if (['news', 'news-media', 'media', 'opinion', 'politics'].some((c) => cat.includes(c))) return 'news';
  if (['social', 'community'].some((c) => cat.includes(c))) return 'social';
  if (['sensor', 'disaster', 'natural-disasters', 'climate', 'environment'].some((c) => cat.includes(c))) return 'sensor';
  if (['domain', 'dns', 'directory'].some((c) => cat.includes(c))) return 'domain';
  return 'unknown';
}

export async function collectSeedsFromCommunity(
  pool: Pool,
  opts: ExpandFromFeedsOptions,
): Promise<{ seeds: string[]; items: CommunityItem[]; goal?: string }> {
  const seeds = new Set<string>();
  const items: CommunityItem[] = [];
  let inferredGoal = opts.goal;

  if (opts.keywords?.length) {
    for (const k of opts.keywords) {
      const t = k.trim().toLowerCase();
      if (t.length >= 3) seeds.add(t);
    }
  }

  if (opts.itemIds?.length) {
    for (const id of opts.itemIds) {
      const item = await getCommunityItemById(pool, id);
      if (!item) continue;
      items.push(item);
      for (const k of keywordsFromItem(item)) seeds.add(k.toLowerCase());
      if (!inferredGoal) inferredGoal = goalFromCategory(item.category);
    }
  }

  if (!seeds.size && (opts.hours || opts.stream || opts.category)) {
    const found = await listCommunityItems(pool, {
      hours: opts.hours ?? 48,
      stream: opts.stream,
      category: opts.category,
      limit: 50,
    });
    for (const item of found) {
      items.push(item);
      for (const k of keywordsFromItem(item)) seeds.add(k.toLowerCase());
      if (!inferredGoal) inferredGoal = goalFromCategory(item.category);
    }
  }

  return { seeds: [...seeds], items, goal: inferredGoal };
}

export async function expandCommunityKeywordsToTargets(
  pool: Pool,
  opts: ExpandFromFeedsOptions,
): Promise<ExpandFromFeedsResult> {
  await ensureCollectionSchema(pool);
  const { seeds, items, goal } = await collectSeedsFromCommunity(pool, opts);
  if (!seeds.length) {
    return { seeds: [], expanded: [], targets: [], enqueued: 0, failed: 0 };
  }

  // Apply evidence confidence scoring gate
  const minConf = opts.minConfidence ?? 0.40;
  const scoredSeeds: Array<{ term: string; confidence: number }> = [];

  for (const seed of seeds) {
    const sourceItems = items.filter((i) => {
      const kw = (i.payload?.enrichment as { keywords?: string[] } | undefined)?.keywords;
      return kw?.some((k) => k.toLowerCase().includes(seed.toLowerCase()));
    });

    const sourceEv: ObservationEvidence = {
      observationId: `seed:${seed}`,
      value: seed,
      entityType: 'keyword',
      source: {
        id: 'community-feed',
        name: sourceItems[0]?.sourceName || 'RSS Feed',
        class: inferSourceClassFromCategory(sourceItems[0]?.category || 'news'),
        baseline: 0.60,
        evidenceFamily: 'community-feed',
      },
      extraction: {
        method: sourceItems[0]?.payload?.enrichment && (sourceItems[0].payload.enrichment as any).llm ? 'llm-structured' : 'rule-based',
        baseline: 0.70,
        canHallucinate: !!(sourceItems[0]?.payload?.enrichment && (sourceItems[0].payload.enrichment as any).llm),
      },
      observedAt: sourceItems[0]?.publishedAt || new Date().toISOString(),
      observationCount: sourceItems.length,
    };

    const { scored, seedsTarget } = scoreEvidenceSync(sourceEv, sourceItems.length > 1
      ? sourceItems.map((si) => ({
          observationId: si.id,
          value: seed,
          entityType: 'keyword',
          source: { id: 'community-feed', name: si.sourceName, class: inferSourceClassFromCategory(si.category || 'news'), baseline: 0.60, evidenceFamily: 'community-feed' },
          extraction: { method: 'rule-based' as const, baseline: 0.70, canHallucinate: false },
          observedAt: si.publishedAt,
          observationCount: 1,
        }))
      : []);

    if (seedsTarget && scored.compositeConfidence >= minConf) {
      scoredSeeds.push({ term: seed, confidence: scored.compositeConfidence });
    }
  }

  if (!scoredSeeds.length) {
    return {
      seeds,
      expanded: [],
      targets: [],
      enqueued: 0,
      failed: 0,
      message: `All ${seeds.length} seeds filtered below confidence threshold ${minConf}`,
    };
  }

  const expansionSeeds = scoredSeeds.map((s) => s.term);
  const expanded = opts.expand !== false
    ? expandKeywordsForCollection(expansionSeeds, { goal, maxPerSeed: 6 })
    : scoredSeeds.map((s) => ({ term: s.term, source: 'seed', confidence: s.confidence }));

  const maxTargets = opts.maxTargets ?? 25;
  const targets: ExpandFromFeedsResult['targets'] = [];
  let enqueued = 0;
  let failed = 0;

  const originRef = opts.itemIds?.length === 1
    ? `community_item:${opts.itemIds[0]}`
    : items[0]?.id
      ? `community_item:${items[0].id}`
      : 'community_feed_expand';

  for (const entry of expanded.slice(0, maxTargets)) {
    const existing = await pool.query(
      `SELECT id FROM collection_targets
       WHERE normalized_value = $1 AND target_type = 'metadata' AND product = $2 AND case_id IS NULL
       LIMIT 1`,
      [entry.term.toLowerCase(), opts.product || 'shared'],
    );
    const created = !existing.rows[0];

    const target: CollectionTarget = await upsertTarget(pool, {
      target_type: 'metadata',
      value: entry.term,
      product: opts.product || 'shared',
      workflow_template: 'threat-feed',
      collection_policy: 'threat-feed-15m',
      collection_strategy: 'threat-feed-standard',
      origin: 'discovery',
      origin_ref: originRef,
      source: 'feed-intelligence',
      enabled: true,
      priority: Math.round(entry.confidence * 80),
      confidence: entry.confidence,
      tags: ['feed-derived', entry.source],
      metadata: {
        seed_keywords: seeds,
        expansion_source: entry.source,
        community_item_ids: opts.itemIds || items.map((i) => i.id).slice(0, 5),
      },
    });

    let cascades: unknown;
    if (opts.enqueue && !opts.dryRun) {
      const result = await submitTargetIdToCascades(pool, target.id, { dryRun: opts.dryRun });
      cascades = result;
      if (result?.error || result?.cascades_status === 'failed') failed++;
      else enqueued++;
    }

    targets.push({ id: target.id, value: target.value, created, cascades });
  }

  return { seeds, expanded, targets, enqueued, failed };
}

export async function enrichCommunityItemById(pool: Pool, id: string): Promise<CommunityItem | null> {
  const item = await getCommunityItemById(pool, id);
  if (!item) return null;
  const payload = await enrichCommunityPayloadAsync(item);
  await upsertCommunityItems(pool, [{ ...item, payload }], item.stream);
  return { ...item, payload };
}

export async function backfillCommunityEnrichment(
  pool: Pool,
  options?: { hours?: number; stream?: string; limit?: number },
): Promise<{ processed: number; enriched: number }> {
  const items = await searchCommunityItems(pool, {
    hours: options?.hours ?? 168,
    stream: options?.stream,
    needsEnrichment: true,
    limit: options?.limit ?? 500,
  });
  let enriched = 0;
  for (const item of items) {
    const payload = await enrichCommunityPayloadAsync(item);
    await upsertCommunityItems(pool, [{ ...item, payload }], item.stream);
    enriched++;
  }
  return { processed: items.length, enriched };
}

export function sliceCommunityItems(
  pool: Pool,
  options: CommunityQueryOptions,
): Promise<CommunityItem[]> {
  return searchCommunityItems(pool, options);
}

export { buildFeedEnrichment, enrichCommunityPayload, enrichCommunityPayloadAsync };

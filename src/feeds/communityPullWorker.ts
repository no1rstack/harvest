/**
 * Community daily pull worker — free sources (Harvest Postgres).
 */

import type { Pool } from 'pg';
import { fetchCommunityLayer, type CommunityLayerId } from './communityLayers.js';
import {
  getCommunityStats,
  listStreamStatus,
  markStreamError,
  upsertCommunityItems,
} from './communityStorePg.js';
import type { CommunityItem } from './communityTypes.js';
import { inferSourceClass } from './communityTypes.js';
import { enrichCommunityPayload, enrichCommunityPayloadAsync } from './feedEnrichment.js';
import { harvestLlmEnrichLimit, mapPool } from '../lib/llmClient.js';
import { aggregateRssDigest, type DigestNewsItem, type FeedDef } from './rssDigest.js';
import { listDueFeedSources, adjustFeedCadence, listFeedSources, touchFeedSourceHealth, recycleDeadDomains, listRepairCandidates, recordRepairAttempt, recordDiscovery, recordUrlChange, type CommunityFeedSource } from './rssFeedRegistry.js';
import { repairFeed } from './feedResolver.js';
import { loadPlatformConfig } from '../platform/config.js';
import { fetchAiidCorpus, fetchAptnotesCorpus } from './sharedCorpusPull.js';
import { collectAllCrucixApis } from './crucixApiCollector.js';
import { pullAllJudicium } from '../collection/judicium-pull.js';

const FREE_LAYER_IDS: CommunityLayerId[] = ['disasters', 'aviation', 'cyber'];

const DAILY_CATEGORIES = [
  'geopolitics', 'disaster', 'cyber', 'defense', 'osint', 'sanctions',
  'maritime', 'aviation', 'finance', 'energy', 'legislation',
];

let poolRef: Pool | null = null;
let started = false;
let timers: ReturnType<typeof setInterval>[] = [];
const running = { layers: false, rss: false, daily: false, corpus: false, crucix: false, judiciumPull: false };

export interface CommunityPullResult {
  stream: string;
  collected: number;
  persisted: number;
  error?: string;
  ms: number;
}

function intervalsFromConfig() {
  const cfg = loadPlatformConfig().communityFeeds;
  return {
    layersMs: cfg.layersIntervalMinutes * 60_000,
    rssMs: cfg.rssIntervalMinutes * 60_000,
    dailyMs: cfg.dailyIntervalHours * 3_600_000,
    /** Shared corpora (AIID / APTnotes) — default same cadence as daily, overridable. */
    corpusMs: Number(process.env.HARVEST_FEEDS_CORPUS_INTERVAL_HOURS || cfg.dailyIntervalHours) * 3_600_000,
    startupDelayMs: cfg.startupDelaySeconds * 1000,
    enabled: cfg.enabled,
    /** Adaptive RSS cadence */
    rssAdaptiveMaxMinutes: cfg.rssAdaptiveMaxMinutes ?? 1440,
    rssAdaptiveNoopThreshold: cfg.rssAdaptiveNoopThreshold ?? 3,
    rssBaseMinutes: cfg.rssIntervalMinutes,
  };
}

function stableRssId(title: string, link: string): string {
  let h = 0;
  const s = `${title}|${link}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `rss:${(h >>> 0).toString(36)}`;
}

async function newsToCommunityItems(items: DigestNewsItem[]): Promise<CommunityItem[]> {
  const llmLimit = harvestLlmEnrichLimit();
  return mapPool(items, 3, async (item, index) => {
    const base: CommunityItem = {
      id: item.id || stableRssId(item.title, item.link),
      title: item.title,
      summary: (item.description || '').slice(0, 800),
      sourceClass: inferSourceClass('rss', item.source, item.category),
      sourceName: item.source,
      sourceUrl: item.link,
      stream: 'rss',
      category: item.category || 'News',
      severity: 'medium' as const,
      publishedAt: item.publishedAt || new Date().toISOString(),
      lat: null,
      lon: null,
      geoQuality: 'none' as const,
      location: undefined,
      originalLink: item.link,
    };
    const payload =
      index < llmLimit ? await enrichCommunityPayloadAsync(base) : enrichCommunityPayload(base);
    return { ...base, payload };
  });
}

function requirePool(): Pool {
  if (!poolRef) throw new Error('Community feeds pool not initialized');
  return poolRef;
}

export async function pullFreeLayers(): Promise<CommunityPullResult[]> {
  const pool = requirePool();
  if (running.layers) {
    return FREE_LAYER_IDS.map((id) => ({
      stream: id, collected: 0, persisted: 0, error: 'already running', ms: 0,
    }));
  }
  running.layers = true;
  const results: CommunityPullResult[] = [];
  try {
    for (const layer of FREE_LAYER_IDS) {
      const t0 = Date.now();
      try {
        const result = await fetchCommunityLayer(layer);
        if (result.error && !result.items.length) {
          await markStreamError(pool, layer, result.error);
          results.push({ stream: layer, collected: 0, persisted: 0, error: result.error, ms: Date.now() - t0 });
          continue;
        }
        const { upserted } = result.items.length
          ? await upsertCommunityItems(pool, result.items, layer)
          : { upserted: 0 };
        results.push({
          stream: layer,
          collected: result.items.length,
          persisted: upserted,
          error: result.error,
          ms: Date.now() - t0,
        });
      } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err);
        await markStreamError(pool, layer, msg);
        results.push({ stream: layer, collected: 0, persisted: 0, error: msg, ms: Date.now() - t0 });
      }
    }
  } finally {
    running.layers = false;
  }
  const total = results.reduce((n, r) => n + r.persisted, 0);
  console.log(`[harvest-feeds] layers persisted=${total}`);
  return results;
}

export async function pullRssDigest(options?: {
  maxResults?: number;
  categories?: string[];
}): Promise<CommunityPullResult> {
  const pool = requirePool();
  if (running.rss) {
    return { stream: 'rss', collected: 0, persisted: 0, error: 'already running', ms: 0 };
  }
  running.rss = true;
  const t0 = Date.now();
  try {
    const categories = options?.categories || DAILY_CATEGORIES;
    const maxResults = options?.maxResults ?? 200;
    const { rssAdaptiveMaxMinutes, rssAdaptiveNoopThreshold, rssBaseMinutes } = intervalsFromConfig();

    // Only pull registry feeds that are due (adaptive cadence).
    // aggregateRssDigest already includes the curated FREE_FEEDS internally.
    const dueFeeds = await listDueFeedSources(pool, {
      baseIntervalMinutes: rssBaseMinutes,
      maxIntervalMinutes: rssAdaptiveMaxMinutes,
    });

    const extraFeeds: FeedDef[] = dueFeeds.map((src) => ({
      name: src.name,
      url: src.feedUrl,
      category: src.category,
    }));

    const result = await aggregateRssDigest(categories, maxResults, extraFeeds);
    const live = result.items;

    // Record per-feed errors
    for (const fe of result.feedErrors) {
      for (const df of dueFeeds) {
        if (df.name === fe.name) {
          await touchFeedSourceHealth(pool, df.id, { ok: false, error: fe.error });
          break;
        }
      }
    }

    // Mark successful registry feeds
    for (const df of dueFeeds) {
      const hasError = result.feedErrors.some((e) => e.name === df.name);
      if (!hasError) {
        await touchFeedSourceHealth(pool, df.id, { ok: live.some((item) => item.source === df.name) });
      }
    }

    const items = await newsToCommunityItems(live);
    const { upserted } = items.length ? await upsertCommunityItems(pool, items, 'rss') : { upserted: 0 };

    // Per-feed cadence adjustment: count items per registry feed
    const feedItemCounts = new Map<string, number>();
    for (const item of live) {
      for (const df of extraFeeds) {
        if (item.source === df.name) {
          feedItemCounts.set(df.name, (feedItemCounts.get(df.name) || 0) + 1);
          break;
        }
      }
    }

    // Update cadence for each due feed
    for (const src of dueFeeds) {
      const count = feedItemCounts.get(src.name) || 0;
      await adjustFeedCadence(pool, src.id, count, {
        baseIntervalMinutes: rssBaseMinutes,
        maxIntervalMinutes: rssAdaptiveMaxMinutes,
        noopThreshold: rssAdaptiveNoopThreshold,
      });
    }

    if (dueFeeds.length > 0) {
      const intervals = dueFeeds.map(f => f.adaptiveIntervalMinutes);
      const avg = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
      const max = Math.max(...intervals);
      console.log(
        `[harvest-feeds] RSS pulled ${dueFeeds.length} due feeds ` +
        `(avg cadence ${avg}m, max ${max}m) — ${live.length} items, ${upserted} new`,
      );
    } else {
      console.log(`[harvest-feeds] RSS no due feeds — 0 items pulled`);
    }

    return { stream: 'rss', collected: items.length, persisted: upserted, ms: Date.now() - t0 };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || String(err);
    await markStreamError(pool, 'rss', msg);
    return { stream: 'rss', collected: 0, persisted: 0, error: msg, ms: Date.now() - t0 };
  } finally {
    running.rss = false;
  }
}

export async function pullFeedSource(source: CommunityFeedSource): Promise<CommunityPullResult> {
  const pool = requirePool();
  const t0 = Date.now();
  try {
    const result = await aggregateRssDigest([source.category], 80, [{
      name: source.name,
      url: source.feedUrl,
      category: source.category,
    }]);
    const live = result.items;

    // If the individual feed errored, record the error
    if (result.feedErrors.some((fe) => fe.name === source.name)) {
      const e = result.feedErrors.find((fe) => fe.name === source.name)!;
      await touchFeedSourceHealth(pool, source.id, { ok: false, error: e.error });
      return {
        stream: `rss:${source.id}`,
        collected: 0,
        persisted: 0,
        error: e.error,
        ms: Date.now() - t0,
      };
    }

    const ok = live.length > 0;
    await touchFeedSourceHealth(pool, source.id, {
      ok,
      error: ok ? undefined : 'no items returned',
    });
    const items = await newsToCommunityItems(live);
    const { upserted } = items.length ? await upsertCommunityItems(pool, items, 'rss') : { upserted: 0 };
    return {
      stream: `rss:${source.id}`,
      collected: items.length,
      persisted: upserted,
      ms: Date.now() - t0,
    };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || String(err);
    await touchFeedSourceHealth(pool, source.id, { ok: false, error: msg });
    return {
      stream: `rss:${source.id}`,
      collected: 0,
      persisted: 0,
      error: msg,
      ms: Date.now() - t0,
    };
  }
}

export async function pullSharedCorpus(options?: {
  aiidLimit?: number;
  aptnotesLimit?: number;
}): Promise<CommunityPullResult[]> {
  const pool = requirePool();
  if (running.corpus) {
    return [
      { stream: 'aiid', collected: 0, persisted: 0, error: 'already running', ms: 0 },
      { stream: 'aptnotes', collected: 0, persisted: 0, error: 'already running', ms: 0 },
    ];
  }
  running.corpus = true;
  const results: CommunityPullResult[] = [];
  try {
    // AIID
    {
      const t0 = Date.now();
      try {
        const items = await fetchAiidCorpus(options?.aiidLimit ?? 2000);
        const { upserted } = items.length
          ? await upsertCommunityItems(pool, items, 'aiid')
          : { upserted: 0 };
        results.push({
          stream: 'aiid',
          collected: items.length,
          persisted: upserted,
          ms: Date.now() - t0,
        });
      } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err);
        await markStreamError(pool, 'aiid', msg);
        results.push({ stream: 'aiid', collected: 0, persisted: 0, error: msg, ms: Date.now() - t0 });
      }
    }
    // APTnotes
    {
      const t0 = Date.now();
      try {
        const items = await fetchAptnotesCorpus(options?.aptnotesLimit ?? 400);
        const { upserted } = items.length
          ? await upsertCommunityItems(pool, items, 'aptnotes')
          : { upserted: 0 };
        results.push({
          stream: 'aptnotes',
          collected: items.length,
          persisted: upserted,
          ms: Date.now() - t0,
        });
      } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err);
        await markStreamError(pool, 'aptnotes', msg);
        results.push({ stream: 'aptnotes', collected: 0, persisted: 0, error: msg, ms: Date.now() - t0 });
      }
    }
  } finally {
    running.corpus = false;
  }
  const total = results.reduce((n, r) => n + r.persisted, 0);
  console.log(`[harvest-feeds] shared corpus persisted=${total}`);
  return results;
}

/** Pull 6 zero-auth Crucix APIs: GDELT, Safecast, ReliefWeb, WHO, OFAC, OpenSanctions. */
export async function pullCrucixApis(): Promise<CommunityPullResult[]> {
  const pool = requirePool();
  if (running.crucix) return [];
  running.crucix = true;
  const results: CommunityPullResult[] = [];
  try {
    const collected = await collectAllCrucixApis();
    for (const { stream, items } of collected) {
      const t0 = Date.now();
      try {
        const { upserted } = items.length
          ? await upsertCommunityItems(pool, items, stream)
          : { upserted: 0 };
        results.push({ stream, collected: items.length, persisted: upserted, ms: Date.now() - t0 });
      } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err);
        await markStreamError(pool, stream, msg);
        results.push({ stream, collected: items.length, persisted: 0, error: msg, ms: Date.now() - t0 });
      }
    }
  } finally {
    running.crucix = false;
  }
  const total = results.reduce((n, r) => n + r.persisted, 0);
  console.log(`[harvest-feeds] crucix APIs persisted=${total} across ${results.length} streams`);
  return results;
}

export async function runCommunityDailyPull(): Promise<{
  layers: CommunityPullResult[];
  rss: CommunityPullResult;
  corpus: CommunityPullResult[];
  crucix: CommunityPullResult[];
  stats: Awaited<ReturnType<typeof getCommunityStats>>;
  streams: Awaited<ReturnType<typeof listStreamStatus>>;
}> {
  if (running.daily) {
    const pool = requirePool();
    return {
      layers: [],
      rss: { stream: 'rss', collected: 0, persisted: 0, error: 'daily already running', ms: 0 },
      corpus: [],
      crucix: [],
      stats: await getCommunityStats(pool, 48),
      streams: await listStreamStatus(pool),
    };
  }
  running.daily = true;
  try {
    const layers = await pullFreeLayers();
    const rss = await pullRssDigest({ maxResults: 250 });
    const corpus = await pullSharedCorpus();
    const crucix = await pullCrucixApis();
    const pool = requirePool();
    return {
      layers,
      rss,
      corpus,
      crucix,
      stats: await getCommunityStats(pool, 48),
      streams: await listStreamStatus(pool),
    };
  } finally {
    running.daily = false;
  }
}

export function getCommunityPullStatus() {
  const { layersMs, rssMs, dailyMs, corpusMs, startupDelayMs, enabled,
    rssAdaptiveMaxMinutes, rssAdaptiveNoopThreshold, rssBaseMinutes } = intervalsFromConfig();
  const pool = poolRef;
  const base = {
    enabled,
    started,
    running: { ...running },
    intervals: {
      layersMinutes: Math.round(layersMs / 60_000),
      rssMinutes: Math.round(rssMs / 60_000),
      rssAdaptiveMaxMinutes,
      rssAdaptiveNoopThreshold,
      dailyHours: Math.round(dailyMs / 3_600_000),
      corpusHours: Math.round(corpusMs / 3_600_000),
      startupDelaySeconds: Math.round(startupDelayMs / 1000),
    },
    freeSources: [
      { id: 'disasters', apis: ['USGS', 'GDACS'], keyRequired: false },
      { id: 'aviation', apis: ['OpenSky'], keyRequired: false },
      { id: 'cyber', apis: ['Feodo', 'URLHaus'], keyRequired: false },
      { id: 'rss', apis: ['GLOBAL_RSS_FEEDS', 'community_feed_sources'], keyRequired: false },
      { id: 'aiid', apis: ['Judicium AIID corpus'], keyRequired: false },
      { id: 'aptnotes', apis: ['APTnotes GitHub JSON'], keyRequired: false },
      { id: 'crucix', apis: ['GDELT', 'Safecast', 'ReliefWeb', 'WHO', 'OFAC SDN', 'OpenSanctions'], keyRequired: false },
      { id: 'judicium-pull', apis: ['intelligence_events', 'feed_items', 'social_posts', 'evidence', 'canonical_entities', 'relationships'], keyRequired: false },
    ],
    store: 'harvest-postgres',
  };
  if (!pool) return { ...base, streams: [], stats: { total: 0, byClass: {}, byStream: {} } };
  return base;
}

export async function getCommunityPullStatusAsync() {
  const status = getCommunityPullStatus();
  const pool = poolRef;
  if (!pool) return status;
  const [streams, stats] = await Promise.all([listStreamStatus(pool), getCommunityStats(pool, 48)]);
  return { ...status, streams, stats };
}

export function stopCommunityFeedsWorker(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
  started = false;
}

export function startCommunityFeedsWorker(pool: Pool): void {
  poolRef = pool;
  stopCommunityFeedsWorker();
  const { layersMs, rssMs, dailyMs, corpusMs, startupDelayMs, enabled } = intervalsFromConfig();
  if (!enabled) {
    console.log('[harvest-feeds] Worker disabled (communityFeeds.enabled=false)');
    return;
  }
  started = true;
  console.log(
    `[harvest-feeds] Worker scheduled — layers ${Math.round(layersMs / 60_000)}m, ` +
      `RSS ${Math.round(rssMs / 60_000)}m, corpus ${Math.round(corpusMs / 3_600_000)}h, ` +
      `crucix 6h, judicium 2h, daily ${Math.round(dailyMs / 3_600_000)}h`,
  );

  setTimeout(() => {
    runCommunityDailyPull().catch((e) =>
      console.warn('[harvest-feeds] startup daily failed:', (e as Error).message),
    );
  }, startupDelayMs);

  timers.push(setInterval(() => {
    pullFreeLayers().catch((e) => console.warn('[harvest-feeds] layers failed:', (e as Error).message));
  }, layersMs));

  timers.push(setInterval(() => {
    pullRssDigest().catch((e) => console.warn('[harvest-feeds] rss failed:', (e as Error).message));
  }, rssMs));

  timers.push(setInterval(() => {
    pullSharedCorpus().catch((e) => console.warn('[harvest-feeds] corpus failed:', (e as Error).message));
  }, corpusMs));

  // Crucix zero-auth APIs — every 6 hours
  timers.push(setInterval(() => {
    pullCrucixApis().catch((e) => console.warn('[harvest-feeds] crucix failed:', (e as Error).message));
  }, 6 * 3_600_000));

  // Judicium bidirectional sync — every 2 hours
  timers.push(setInterval(() => {
    pullJudiciumSync().catch((e) => console.warn('[harvest-feeds] judicium-pull failed:', (e as Error).message));
  }, 2 * 3_600_000));

  // Dead-domain recycling — every 4 hours
  timers.push(setInterval(() => {
    runDeadDomainRecycle().catch((e) => console.warn('[harvest-feeds] recycle failed:', (e as Error).message));
  }, 4 * 3_600_000));

  // Auto-repair broken feeds — every 4 hours
  timers.push(setInterval(() => {
    runAutoRepair().catch((e) => console.warn('[harvest-feeds] auto-repair failed:', (e as Error).message));
  }, 4 * 3_600_000));

  timers.push(setInterval(() => {
    runCommunityDailyPull().catch((e) => console.warn('[harvest-feeds] daily failed:', (e as Error).message));
  }, dailyMs));
}

/** Automatically retire feeds with dead domains (DNS failures, expired certs, connection refused). */
export async function runDeadDomainRecycle(): Promise<number> {
  const pool = requirePool();
  try {
    const retired = await recycleDeadDomains(pool);
    if (retired > 0) {
      console.log(`[harvest-feeds] dead-domain recycle: ${retired} feed(s) retired`);
    }
    return retired;
  } catch (err: unknown) {
    console.warn('[harvest-feeds] dead-domain recycle failed:', (err as Error).message);
    return 0;
  }
}

/** Attempt to auto-repair feeds with 3+ consecutive failures. */
export async function runAutoRepair(): Promise<{ candidates: number; repaired: number; failed: number }> {
  const pool = requirePool();
  let repaired = 0;
  let failed = 0;
  try {
    const candidates = await listRepairCandidates(pool);
    if (candidates.length === 0) return { candidates: 0, repaired: 0, failed: 0 };

    for (const source of candidates) {
      try {
        await recordRepairAttempt(pool, source.id);
        const result = await repairFeed({ feedUrl: source.feedUrl, siteUrl: source.siteUrl });
        await recordDiscovery(pool, source.id, {
          status: result.best ? 'resolved' : 'failed',
          discoveredUrl: result.best?.feedUrl,
          confidence: result.best?.score,
          method: result.best?.discoveredVia,
        });
        if (result.autoRepairEligible && result.best) {
          await recordUrlChange(pool, source.id, source.feedUrl, result.best.feedUrl,
            'auto-repair: high-confidence discovery');
          repaired++;
          console.log(`[harvest-feeds] auto-repaired "${source.name}": ${source.feedUrl} → ${result.best.feedUrl} (score ${result.best.score})`);
        }
      } catch {
        failed++;
      }
    }

    if (candidates.length > 0) {
      console.log(`[harvest-feeds] auto-repair: ${candidates.length} candidates, ${repaired} repaired, ${failed} failed`);
    }
    return { candidates: candidates.length, repaired, failed };
  } catch (err: unknown) {
    console.warn('[harvest-feeds] auto-repair failed:', (err as Error).message);
    return { candidates: 0, repaired, failed };
  }
}

/** Pull data from Judicium into Harvest (bidirectional sync). */
export async function pullJudiciumSync(): Promise<Awaited<ReturnType<typeof pullAllJudicium>>> {
  const pool = requirePool();
  if (running.judiciumPull) {
    return { results: [], total_pulled: 0, total_ingested: 0 };
  }
  running.judiciumPull = true;
  try {
    const result = await pullAllJudicium(pool);
    console.log(`[harvest-feeds] judicium-pull: ${result.total_pulled} pulled, ${result.total_ingested} ingested`);
    return result;
  } finally {
    running.judiciumPull = false;
  }
}

export function restartCommunityFeedsWorker(pool: Pool): void {
  startCommunityFeedsWorker(pool);
}

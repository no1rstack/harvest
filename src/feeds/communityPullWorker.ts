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
import { aggregateRssDigest, type DigestNewsItem } from './rssDigest.js';
import { loadPlatformConfig } from '../platform/config.js';

const FREE_LAYER_IDS: CommunityLayerId[] = ['disasters', 'aviation', 'cyber'];

const DAILY_CATEGORIES = [
  'geopolitics', 'disaster', 'cyber', 'defense', 'osint', 'sanctions',
  'maritime', 'aviation', 'finance', 'energy',
];

let poolRef: Pool | null = null;
let started = false;
let timers: ReturnType<typeof setInterval>[] = [];
const running = { layers: false, rss: false, daily: false };

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
    startupDelayMs: cfg.startupDelaySeconds * 1000,
    enabled: cfg.enabled,
  };
}

function stableRssId(title: string, link: string): string {
  let h = 0;
  const s = `${title}|${link}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `rss:${(h >>> 0).toString(36)}`;
}

function newsToCommunityItems(items: DigestNewsItem[]): CommunityItem[] {
  return items.map((item) => ({
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
  }));
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
    const live = await aggregateRssDigest(categories, maxResults);
    const items = newsToCommunityItems(live);
    const { upserted } = items.length ? await upsertCommunityItems(pool, items, 'rss') : { upserted: 0 };
    return { stream: 'rss', collected: items.length, persisted: upserted, ms: Date.now() - t0 };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || String(err);
    await markStreamError(pool, 'rss', msg);
    return { stream: 'rss', collected: 0, persisted: 0, error: msg, ms: Date.now() - t0 };
  } finally {
    running.rss = false;
  }
}

export async function runCommunityDailyPull(): Promise<{
  layers: CommunityPullResult[];
  rss: CommunityPullResult;
  stats: Awaited<ReturnType<typeof getCommunityStats>>;
  streams: Awaited<ReturnType<typeof listStreamStatus>>;
}> {
  if (running.daily) {
    const pool = requirePool();
    return {
      layers: [],
      rss: { stream: 'rss', collected: 0, persisted: 0, error: 'daily already running', ms: 0 },
      stats: await getCommunityStats(pool, 48),
      streams: await listStreamStatus(pool),
    };
  }
  running.daily = true;
  try {
    const layers = await pullFreeLayers();
    const rss = await pullRssDigest({ maxResults: 250 });
    const pool = requirePool();
    return {
      layers,
      rss,
      stats: await getCommunityStats(pool, 48),
      streams: await listStreamStatus(pool),
    };
  } finally {
    running.daily = false;
  }
}

export function getCommunityPullStatus() {
  const { layersMs, rssMs, dailyMs, startupDelayMs, enabled } = intervalsFromConfig();
  const pool = poolRef;
  const base = {
    enabled,
    started,
    running: { ...running },
    intervals: {
      layersMinutes: Math.round(layersMs / 60_000),
      rssMinutes: Math.round(rssMs / 60_000),
      dailyHours: Math.round(dailyMs / 3_600_000),
      startupDelaySeconds: Math.round(startupDelayMs / 1000),
    },
    freeSources: [
      { id: 'disasters', apis: ['USGS', 'GDACS'], keyRequired: false },
      { id: 'aviation', apis: ['OpenSky'], keyRequired: false },
      { id: 'cyber', apis: ['Feodo', 'URLHaus'], keyRequired: false },
      { id: 'rss', apis: ['GLOBAL_RSS_FEEDS'], keyRequired: false },
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
  const { layersMs, rssMs, dailyMs, startupDelayMs, enabled } = intervalsFromConfig();
  if (!enabled) {
    console.log('[harvest-feeds] Worker disabled (communityFeeds.enabled=false)');
    return;
  }
  started = true;
  console.log(
    `[harvest-feeds] Worker scheduled — layers ${Math.round(layersMs / 60_000)}m, ` +
      `RSS ${Math.round(rssMs / 60_000)}m, daily ${Math.round(dailyMs / 3_600_000)}h`,
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
    runCommunityDailyPull().catch((e) => console.warn('[harvest-feeds] daily failed:', (e as Error).message));
  }, dailyMs));
}

export function restartCommunityFeedsWorker(pool: Pool): void {
  startCommunityFeedsWorker(pool);
}

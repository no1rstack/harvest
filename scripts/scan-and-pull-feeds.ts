/**
 * One-shot: import Crucix + World Monitor feeds, scan URLs, bulk RSS pull.
 * Usage: HARVEST_DATABASE_URL=... npx tsx scripts/scan-and-pull-feeds.ts
 */

import pg from 'pg';
import { XMLParser } from 'fast-xml-parser';
import { CRUCIX_FEED_SEEDS } from '../src/feeds/crucixFeedSeeds.js';
import {
  fetchWorldMonitorFeedCatalog,
  worldMonitorFeedToSeed,
} from '../src/feeds/worldMonitorFeedCatalog.js';
import {
  listFeedSources,
  touchFeedSourceHealth,
  upsertFeedSource,
} from '../src/feeds/rssFeedRegistry.js';
import { aggregateRssDigest, getCuratedFeedDefinitions, type FeedDef } from '../src/feeds/rssDigest.js';
import { upsertCommunityItems } from '../src/feeds/communityStorePg.js';
import { enrichCommunityPayload } from '../src/feeds/feedEnrichment.js';
import type { CommunityItem } from '../src/feeds/communityTypes.js';
import { inferSourceClass } from '../src/feeds/communityTypes.js';

const USER_AGENT = 'Harvest/1.0 Feed-Scan (+https://harvest.noirstack.com)';
const SCAN_CONCURRENCY = 10;

async function scanFeedUrl(url: string): Promise<{ ok: boolean; items: number; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, items: 0, error: `HTTP ${res.status}` };
    const text = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(text);
    const rssItems = parsed?.rss?.channel?.item;
    const atomEntries = parsed?.feed?.entry;
    const count = rssItems
      ? (Array.isArray(rssItems) ? rssItems.length : 1)
      : atomEntries
        ? (Array.isArray(atomEntries) ? atomEntries.length : 1)
        : 0;
    if (!count) return { ok: false, items: 0, error: 'no RSS/Atom items parsed' };
    return { ok: true, items: count };
  } catch (err: unknown) {
    return { ok: false, items: 0, error: (err as Error).message || 'fetch failed' };
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function stableRssId(title: string, link: string): string {
  let h = 0;
  const s = `${title}|${link}`;
  for (let j = 0; j < s.length; j++) h = (Math.imul(31, h) + s.charCodeAt(j)) | 0;
  return `rss:${(h >>> 0).toString(36)}`;
}

function digestToCommunityItems(
  live: Awaited<ReturnType<typeof aggregateRssDigest>>,
): CommunityItem[] {
  return live.map((item) => {
    const base: CommunityItem = {
      id: item.id || stableRssId(item.title, item.link),
      title: item.title,
      summary: (item.description || '').slice(0, 800),
      sourceClass: inferSourceClass('rss', item.source, item.category),
      sourceName: item.source,
      sourceUrl: item.link,
      stream: 'rss',
      category: item.category || 'News',
      severity: 'medium',
      publishedAt: item.publishedAt || new Date().toISOString(),
      lat: null,
      lon: null,
      geoQuality: 'none',
      originalLink: item.link,
    };
    return { ...base, payload: enrichCommunityPayload(base) };
  });
}

async function main() {
  const dbUrl = process.env.HARVEST_DATABASE_URL;
  if (!dbUrl) {
    console.error('HARVEST_DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl });
  console.log('[scan] Importing Crucix seeds...');
  for (const seed of CRUCIX_FEED_SEEDS) {
    await upsertFeedSource(pool, {
      name: seed.name,
      siteUrl: seed.siteUrl,
      feedUrl: seed.feedUrl,
      category: seed.category,
      discoveredVia: 'crucix-seed',
    });
  }

  console.log('[scan] Fetching World Monitor AGPL catalog...');
  const catalog = await fetchWorldMonitorFeedCatalog({ refresh: true });
  console.log(`[scan] Registering ${catalog.total} World Monitor feeds...`);
  for (const feed of catalog.feeds) {
    const s = worldMonitorFeedToSeed(feed);
    await upsertFeedSource(pool, {
      name: s.name,
      siteUrl: s.siteUrl,
      feedUrl: s.feedUrl,
      category: s.category,
      discoveredVia: s.discoveredVia,
    });
  }

  const sources = await listFeedSources(pool);
  console.log(`[scan] Scanning ${sources.length} registered feed URLs (concurrency ${SCAN_CONCURRENCY})...`);

  const scanResults = await mapPool(sources, SCAN_CONCURRENCY, async (src) => {
    const result = await scanFeedUrl(src.feedUrl);
    await touchFeedSourceHealth(pool, src.id, {
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
    return { id: src.id, name: src.name, feedUrl: src.feedUrl, ...result };
  });

  const ok = scanResults.filter((r) => r.ok);
  const fail = scanResults.filter((r) => !r.ok);
  console.log(`[scan] OK: ${ok.length} / ${scanResults.length} — failed: ${fail.length}`);
  if (fail.length) {
    console.log('[scan] Failed feeds (first 20):');
    for (const f of fail.slice(0, 20)) {
      console.log(`  - ${f.name}: ${f.error} (${f.feedUrl})`);
    }
  }

  const enabledFeeds: FeedDef[] = sources
    .filter((s) => s.enabled && s.autoPull)
    .map((s) => ({ name: s.name, url: s.feedUrl, category: s.category }));

  console.log(`[pull] Bulk RSS pull — ${enabledFeeds.length} registry + ${getCuratedFeedDefinitions().length} curated...`);
  const live = await aggregateRssDigest(undefined, 500, enabledFeeds);
  const items = digestToCommunityItems(live);
  const { upserted } = items.length ? await upsertCommunityItems(pool, items, 'rss') : { upserted: 0 };

  console.log(JSON.stringify({
    imported: { crucix: CRUCIX_FEED_SEEDS.length, worldMonitor: catalog.total, totalRegistered: sources.length },
    scan: { ok: ok.length, failed: fail.length, total: scanResults.length },
    pull: { collected: items.length, persisted: upserted },
  }, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error('[scan] fatal:', err);
  process.exit(1);
});

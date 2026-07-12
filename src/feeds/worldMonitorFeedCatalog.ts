/**
 * World Monitor RSS catalog — AGPL open-source feed inventory.
 * Source of truth: server/worldmonitor/news/v1/_feeds.ts
 * Docs: https://www.worldmonitor.app/docs/data-sources
 *
 * Paid API (WORLDMONITOR_API_KEY) is separate; this module imports the free RSS URLs
 * from the public GitHub repo so Harvest can aggregate without a Pro key.
 */

export const WORLDMONITOR_FEEDS_SOURCE_URL =
  'https://raw.githubusercontent.com/koala73/worldmonitor/main/server/worldmonitor/news/v1/_feeds.ts';

export const WORLDMONITOR_DOCS_URL = 'https://www.worldmonitor.app/docs/data-sources';

export interface WorldMonitorCatalogFeed {
  name: string;
  feedUrl: string;
  variant: string;
  wmCategory: string;
  harvestCategory: string;
  lang?: string;
  viaGoogleNews: boolean;
}

const WM_CATEGORY_TO_HARVEST: Record<string, string> = {
  politics: 'geopolitics',
  us: 'geopolitics',
  europe: 'geopolitics',
  middleeast: 'geopolitics',
  asia: 'geopolitics',
  africa: 'geopolitics',
  latam: 'geopolitics',
  gov: 'defense',
  crisis: 'disaster',
  thinktanks: 'geopolitics',
  tech: 'cyber',
  ai: 'cyber',
  security: 'cyber',
  finance: 'finance',
  markets: 'finance',
  energy: 'energy',
  commodities: 'energy',
  intel: 'osint',
  cyber: 'cyber',
  layoffs: 'osint',
};

function harvestCategory(variant: string, wmCategory: string): string {
  return WM_CATEGORY_TO_HARVEST[wmCategory] || 'geopolitics';
}

function siteUrlFromFeedUrl(feedUrl: string): string {
  try {
    const u = new URL(feedUrl);
    if (u.hostname === 'news.google.com') return 'https://news.google.com/';
    return u.origin;
  } catch {
    return feedUrl;
  }
}

/** Parse World Monitor _feeds.ts text into structured feed rows. */
export function parseWorldMonitorFeedsTs(text: string): WorldMonitorCatalogFeed[] {
  const feeds: WorldMonitorCatalogFeed[] = [];
  const seen = new Set<string>();
  let variant = 'full';
  let wmCategory = 'politics';

  for (const line of text.split('\n')) {
    const variantMatch = /^\s{0,2}(\w[\w-]*):\s*\{\s*$/.exec(line);
    if (variantMatch && !line.includes('name:')) {
      variant = variantMatch[1];
      continue;
    }
    const catMatch = /^\s{1,3}([\w-]+):\s*\[\s*$/.exec(line);
    if (catMatch) {
      wmCategory = catMatch[1];
      continue;
    }
    const feedMatch = /\{\s*name:\s*'([^']+)',\s*url:\s*'([^']+)'(?:,\s*lang:\s*'([^']+)')?\s*\}/.exec(line);
    if (!feedMatch) continue;
    const [, name, feedUrl, lang] = feedMatch;
    if (seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    feeds.push({
      name,
      feedUrl,
      variant,
      wmCategory,
      harvestCategory: harvestCategory(variant, wmCategory),
      lang,
      viaGoogleNews: feedUrl.includes('news.google.com/rss'),
    });
  }
  return feeds;
}

let catalogCache: { fetchedAt: number; feeds: WorldMonitorCatalogFeed[] } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function fetchWorldMonitorFeedCatalog(options?: {
  refresh?: boolean;
}): Promise<{
  feeds: WorldMonitorCatalogFeed[];
  sourceUrl: string;
  docsUrl: string;
  total: number;
  variants: string[];
  note: string;
}> {
  if (!options?.refresh && catalogCache && Date.now() - catalogCache.fetchedAt < CACHE_MS) {
    const feeds = catalogCache.feeds;
    return summarizeCatalog(feeds);
  }

  const res = await fetch(WORLDMONITOR_FEEDS_SOURCE_URL, {
    headers: { 'User-Agent': 'Harvest/1.0 WorldMonitor-Catalog (+https://harvest.noirstack.com)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`World Monitor catalog fetch failed (${res.status})`);
  }
  const text = await res.text();
  const feeds = parseWorldMonitorFeedsTs(text);
  catalogCache = { fetchedAt: Date.now(), feeds };
  return summarizeCatalog(feeds);
}

function summarizeCatalog(feeds: WorldMonitorCatalogFeed[]) {
  const variants = [...new Set(feeds.map((f) => f.variant))].sort();
  return {
    feeds,
    sourceUrl: WORLDMONITOR_FEEDS_SOURCE_URL,
    docsUrl: WORLDMONITOR_DOCS_URL,
    total: feeds.length,
    variants,
    note:
      'AGPL catalog from koala73/worldmonitor _feeds.ts. Paid World Monitor API (X-WorldMonitor-Key) is optional; RSS URLs are free to aggregate.',
  };
}

export function worldMonitorFeedToSeed(feed: WorldMonitorCatalogFeed) {
  return {
    name: `WM · ${feed.name}`,
    siteUrl: siteUrlFromFeedUrl(feed.feedUrl),
    feedUrl: feed.feedUrl,
    category: feed.harvestCategory,
    discoveredVia: `worldmonitor:${feed.variant}/${feed.wmCategory}`,
  };
}

export function filterWorldMonitorCatalog(
  feeds: WorldMonitorCatalogFeed[],
  query?: {
    variant?: string;
    wmCategory?: string;
    harvestCategory?: string;
    directOnly?: boolean;
    q?: string;
    limit?: number;
  },
): WorldMonitorCatalogFeed[] {
  let out = feeds;
  if (query?.variant) out = out.filter((f) => f.variant === query.variant);
  if (query?.wmCategory) out = out.filter((f) => f.wmCategory === query.wmCategory);
  if (query?.harvestCategory) out = out.filter((f) => f.harvestCategory === query.harvestCategory);
  if (query?.directOnly) out = out.filter((f) => !f.viaGoogleNews);
  if (query?.q) {
    const needle = query.q.toLowerCase();
    out = out.filter(
      (f) => f.name.toLowerCase().includes(needle) || f.feedUrl.toLowerCase().includes(needle),
    );
  }
  const limit = query?.limit ?? 500;
  return out.slice(0, limit);
}

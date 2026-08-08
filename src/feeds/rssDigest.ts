/**
 * Keyless RSS digest for community feeds — curated public sources only.
 */

import { XMLParser } from 'fast-xml-parser';

export interface DigestNewsItem {
  id: string;
  title: string;
  description: string;
  link: string;
  source: string;
  category: string;
  publishedAt: string;
}

import { LEGAL_PLATFORM_FEEDS } from './legalFeedSeeds.js';

export type FeedDef = { name: string; url: string; category: string };

const FREE_FEEDS: FeedDef[] = [
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'geopolitics' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'geopolitics' },
  { name: 'GDACS 24h', url: 'https://gdacs.org/xml/rss_24h.xml', category: 'disaster' },
  { name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/', category: 'cyber' },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'cyber' },
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', category: 'cyber' },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'cyber' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/', category: 'defense' },
  { name: 'Reuters via Google', url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB', category: 'geopolitics' },
  { name: 'r/worldnews', url: 'https://www.reddit.com/r/worldnews/.rss', category: 'geopolitics' },
  { name: 'r/OSINT', url: 'https://www.reddit.com/r/OSINT/.rss', category: 'osint' },
  { name: 'r/cybersecurity', url: 'https://www.reddit.com/r/cybersecurity/.rss', category: 'cyber' },
  { name: 'NHC Atlantic', url: 'https://www.nhc.noaa.gov/gtwo.xml', category: 'disaster' },
  { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'geopolitics' },
];

const CATEGORY_SET = new Set([
  'geopolitics', 'disaster', 'cyber', 'defense', 'osint', 'sanctions',
  'maritime', 'aviation', 'finance', 'energy', 'legislation',
]);

async function fetchRssFeed(url: string, name: string, category: string): Promise<DigestNewsItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Harvest/1.0 RSS (+https://harvest.noirstack.com)' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(text);

  if (parsed?.rss?.channel?.item) {
    const items = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item];
    return items.slice(0, 12).map((item: any) => ({
      id: `rss:${name}:${item.guid || item.link || Math.random().toString(36)}`,
      title: String(item.title || 'Untitled'),
      description: String(item.description || '').replace(/<[^>]*>/g, '').slice(0, 300),
      link: String(item.link || ''),
      source: name,
      category,
      publishedAt: item.pubDate || new Date().toISOString(),
    }));
  }

  if (parsed?.feed?.entry) {
    const entries = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
    return entries.slice(0, 12).map((entry: any) => ({
      id: `atom:${name}:${entry.id || entry.link?.['@_href'] || Math.random().toString(36)}`,
      title: String(entry.title?.['#text'] || entry.title || 'Untitled'),
      description: String(entry.summary?.['#text'] || entry.summary || '').replace(/<[^>]*>/g, '').slice(0, 300),
      link: String(entry.link?.['@_href'] || ''),
      source: name,
      category,
      publishedAt: entry.published || entry.updated || new Date().toISOString(),
    }));
  }

  return [];
}

export interface RssDigestFeedError {
  name: string;
  url: string;
  category: string;
  error: string;
}

export interface RssDigestResult {
  items: DigestNewsItem[];
  feedErrors: RssDigestFeedError[];
}

export async function aggregateRssDigest(
  categories?: string[],
  maxResults = 200,
  extraFeeds: FeedDef[] = [],
): Promise<RssDigestResult> {
  const cats = categories?.length
    ? categories.filter((c) => CATEGORY_SET.has(c))
    : [...CATEGORY_SET];
  const feeds = [...FREE_FEEDS, ...extraFeeds].filter((f) => cats.includes(f.category));

  const batches = await Promise.allSettled(
    feeds.map((f) => fetchRssFeed(f.url, f.name, f.category)),
  );

  const feedErrors: RssDigestFeedError[] = [];

  const all = batches
    .filter((r): r is PromiseFulfilledResult<DigestNewsItem[]> => {
      if (r.status === 'rejected') return false;
      return r.status === 'fulfilled';
    })
    .flatMap((r) => r.value);

  batches.forEach((r, i) => {
    if (r.status === 'rejected') {
      feedErrors.push({
        name: feeds[i].name,
        url: feeds[i].url,
        category: feeds[i].category,
        error: (r.reason as Error)?.message || String(r.reason),
      });
    }
  });

  const seen = new Set<string>();
  const deduped = all.filter((item) => {
    const key = item.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const items = deduped
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, maxResults);

  return { items, feedErrors };
}

export function getRssCategories(): string[] {
  return [...CATEGORY_SET];
}

export function getCuratedFeedDefinitions(): FeedDef[] {
  const legal = LEGAL_PLATFORM_FEEDS.map((f) => ({
    name: f.name,
    url: f.feedUrl,
    category: f.category,
  }));
  return [...FREE_FEEDS, ...legal];
}

/**
 * Daily Sources digest — Judicium community UI shape, grouped by publisher + syndication tier.
 */

import type { Pool } from 'pg';
import type { CommunityItem } from './communityTypes.js';
import { listCommunityItems } from './communityStorePg.js';
import { listFeedSources } from './rssFeedRegistry.js';
import { aggregateRssDigest, getCuratedFeedDefinitions, getRssCategories } from './rssDigest.js';
import {
  buildRssSyndicationMeta,
  classifyRegistrySource,
  syndicationCatalogId,
  syndicationCatalogLabel,
  type RssSyndicationTier,
} from './rssSyndication.js';

export interface DailySourceItem {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  feedUrl: string;
  originalLink: string;
  publishedAt: string;
  category: string;
  feedCategory: string;
  sourceClass?: string;
  stream?: string;
  syndicationTier?: RssSyndicationTier;
  syndicationCatalog?: string;
}

export interface DailySourceGroup {
  sourceName: string;
  feedUrl: string;
  feedCategory: string;
  sourceClass?: string;
  itemCount: number;
  syndicationTier: RssSyndicationTier;
  syndicationCatalog?: string;
  items: DailySourceItem[];
}

export interface DailySourcesPayload {
  date: string;
  windowHours: number;
  categories: string[];
  registeredFeedCount: number;
  activeSourceCount: number;
  itemCount: number;
  groups: DailySourceGroup[];
  fromPersistence: boolean;
  rss: ReturnType<typeof buildRssSyndicationMeta> & {
    groups: {
      platform: DailySourceGroup[];
      syndicated: DailySourceGroup[];
      discovered: DailySourceGroup[];
    };
  };
}

const DEFAULT_CATEGORIES = getRssCategories();

function tierForItem(
  item: CommunityItem,
  sourceTierByName: Map<string, { tier: RssSyndicationTier; catalog?: string }>,
): { tier: RssSyndicationTier; catalog?: string } {
  const hit = sourceTierByName.get(item.sourceName);
  if (hit) return hit;
  if (item.stream === 'rss') return { tier: 'platform' };
  return { tier: 'syndicated' };
}

function communityToDailyItem(
  item: CommunityItem,
  tier: RssSyndicationTier,
  catalog?: string,
  feedUrl = '',
): DailySourceItem {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl || item.originalLink || '',
    feedUrl,
    originalLink: item.originalLink || item.sourceUrl || '',
    publishedAt: item.publishedAt,
    category: item.category,
    feedCategory: item.category,
    sourceClass: item.sourceClass,
    stream: item.stream,
    syndicationTier: tier,
    syndicationCatalog: catalog,
  };
}

function groupDailyItems(rows: DailySourceItem[]): DailySourceGroup[] {
  const map = new Map<string, DailySourceGroup>();
  for (const item of rows) {
    const key = `${item.syndicationTier || 'platform'}::${item.sourceName}`;
    if (!map.has(key)) {
      map.set(key, {
        sourceName: item.sourceName,
        feedUrl: item.feedUrl || '',
        feedCategory: item.feedCategory || item.category,
        sourceClass: item.sourceClass,
        itemCount: 0,
        syndicationTier: item.syndicationTier || 'platform',
        syndicationCatalog: item.syndicationCatalog,
        items: [],
      });
    }
    const group = map.get(key)!;
    group.items.push(item);
    group.itemCount += 1;
  }
  for (const group of map.values()) {
    group.items.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
  }
  return [...map.values()].sort((a, b) => b.itemCount - a.itemCount);
}

function splitGroupsByTier(groups: DailySourceGroup[]) {
  return {
    platform: groups.filter((g) => g.syndicationTier === 'platform'),
    syndicated: groups.filter((g) => g.syndicationTier === 'syndicated'),
    discovered: groups.filter((g) => g.syndicationTier === 'discovered'),
  };
}

export async function buildDailySourcesDigest(
  pool: Pool | null,
  options?: { hours?: number; categories?: string[]; live?: boolean },
): Promise<DailySourcesPayload> {
  const hours = options?.hours ?? 24;
  const categories = options?.categories?.length ? options.categories : DEFAULT_CATEGORIES;
  const curated = getCuratedFeedDefinitions().filter((f) => categories.includes(f.category));
  const registry = pool ? await listFeedSources(pool, { enabledOnly: false }) : [];
  const sourceTierByName = new Map<string, { tier: RssSyndicationTier; catalog?: string }>();
  const feedUrlByName = new Map<string, string>();

  for (const feed of curated) {
    sourceTierByName.set(feed.name, { tier: 'platform' });
    feedUrlByName.set(feed.name, feed.url);
  }
  for (const source of registry) {
    const tier = classifyRegistrySource(source);
    const catalog = tier === 'syndicated' ? syndicationCatalogLabel(syndicationCatalogId(source.discoveredVia)) : undefined;
    sourceTierByName.set(source.name, { tier, catalog });
    feedUrlByName.set(source.name, source.feedUrl);
  }

  let rows: DailySourceItem[] = [];
  let fromPersistence = false;

  if (pool && !options?.live) {
    const items = await listCommunityItems(pool, {
      hours,
      limit: 500,
      stream: 'rss',
    });
    const filtered = items.filter((item) =>
      categories.some((c) => item.category.toLowerCase().includes(c.toLowerCase())),
    );
    rows = filtered.map((item) => {
      const meta = tierForItem(item, sourceTierByName);
      return communityToDailyItem(
        item,
        meta.tier,
        meta.catalog,
        feedUrlByName.get(item.sourceName) || '',
      );
    });
    fromPersistence = rows.length > 0;
  }

  if (!rows.length) {
    const extraFeeds = registry
      .filter((s) => s.enabled)
      .map((s) => ({ name: s.name, url: s.feedUrl, category: s.category }));
    const live = await aggregateRssDigest(categories, 200, extraFeeds);
    rows = live.map((item) => {
      const meta = sourceTierByName.get(item.source) || { tier: 'platform' as const };
      return {
        id: item.id,
        title: item.title,
        summary: item.description,
        sourceName: item.source,
        sourceUrl: item.link,
        feedUrl: feedUrlByName.get(item.source) || '',
        originalLink: item.link,
        publishedAt: item.publishedAt,
        category: item.category,
        feedCategory: item.category,
        sourceClass: 'narrative',
        stream: 'rss',
        syndicationTier: meta.tier,
        syndicationCatalog: meta.catalog,
      };
    });
    fromPersistence = false;
  }

  const groups = groupDailyItems(rows);
  const rssMeta = buildRssSyndicationMeta({
    platformSourceCount: curated.length,
    registrySources: registry,
  });

  return {
    date: new Date().toISOString().slice(0, 10),
    windowHours: hours,
    categories,
    registeredFeedCount: curated.length + registry.filter((s) => s.enabled).length,
    activeSourceCount: groups.length,
    itemCount: rows.length,
    groups,
    fromPersistence,
    rss: {
      ...rssMeta,
      groups: splitGroupsByTier(groups),
    },
  };
}

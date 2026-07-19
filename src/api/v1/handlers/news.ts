import type { Pool } from 'pg';
import { listCommunityItems } from '../../../feeds/communityStorePg.js';
import { listFeedSources } from '../../../feeds/rssFeedRegistry.js';
import {
  aggregateRssDigest,
  getCuratedFeedDefinitions,
  getRssCategories,
} from '../../../feeds/rssDigest.js';
import { buildRssSyndicationMeta } from '../../../feeds/rssSyndication.js';
import { parseIntQuery, parseStringQuery } from '../context.js';
import {
  buildFeedDigestFromItems,
  communityItemsToNewsItems,
  digestItemToNewsItem,
  feedSourceToRecord,
} from '../mappers/news.js';
import type {
  ListCommunityItemsResponse,
  ListFeedDigestResponse,
  ListFeedSourcesResponse,
} from '../schemas/news.js';
import {
  RSS_TIER_DESCRIPTIONS,
  RSS_TIER_LABELS,
  buildSyndicationCatalogs,
  groupSourcesByTier,
} from '../../../feeds/rssSyndication.js';

async function rssSyndicationBlock(pool: Pool | null) {
  const curated = getCuratedFeedDefinitions();
  const registry = pool ? await listFeedSources(pool) : [];
  return buildRssSyndicationMeta({
    platformSourceCount: curated.length,
    registrySources: registry,
  });
}

export async function listFeedDigest(
  pool: Pool | null,
  query: Record<string, unknown>,
): Promise<ListFeedDigestResponse> {
  const variant = parseStringQuery(query.variant) || 'full';
  const live = parseStringQuery(query.live) === '1' || parseStringQuery(query.mode) === 'live';
  const lang = parseStringQuery(query.lang);
  const hours = parseIntQuery(query.hours, 24, 168);
  const limit = parseIntQuery(query.limit, 200, 500);
  const rss = await rssSyndicationBlock(pool);

  if (live || !pool) {
    const categories = query.categories
      ? String(query.categories).split(',').map((s) => s.trim()).filter(Boolean)
      : getRssCategories();
    const registry = pool ? await listFeedSources(pool, { enabledOnly: true }) : [];
    const extraFeeds = registry.map((s) => ({
      name: s.name,
      url: s.feedUrl,
      category: s.category,
    }));
    const liveItems = await aggregateRssDigest(categories, limit, extraFeeds);
    const newsItems = liveItems.map(digestItemToNewsItem);
    const digest = buildFeedDigestFromItems(newsItems, {
      variant,
      dataSource: 'live',
      feedStatuses: {
        platform: `${curatedCount()} ok`,
        syndicated: `${registry.length} registered`,
      },
    });
    digest.rss = rss;
    if (lang) digest.variant = `${variant}:${lang}`;
    return digest;
  }

  const items = await listCommunityItems(pool, {
    hours,
    limit,
    stream: parseStringQuery(query.stream) || 'rss',
    category: parseStringQuery(query.category),
    sourceClass: parseStringQuery(query.sourceClass) || 'narrative',
  });

  const digest = buildFeedDigestFromItems(communityItemsToNewsItems(items), {
    variant,
    dataSource: 'store',
  });
  digest.rss = rss;
  if (lang) digest.variant = `${variant}:${lang}`;
  return digest;
}

function curatedCount() {
  return getCuratedFeedDefinitions().length;
}

export async function listCommunityItemsRpc(
  pool: Pool,
  query: Record<string, unknown>,
): Promise<ListCommunityItemsResponse> {
  const hours = parseIntQuery(query.hours, 48, 168);
  const limit = parseIntQuery(query.limit, 300, 1000);
  const items = await listCommunityItems(pool, {
    hours,
    limit,
    sourceClass: parseStringQuery(query.class) || parseStringQuery(query.sourceClass),
    stream: parseStringQuery(query.stream) || 'rss',
    category: parseStringQuery(query.category),
    severity: parseStringQuery(query.severity),
    q: parseStringQuery(query.q),
    keyword: parseStringQuery(query.keyword),
    entity: parseStringQuery(query.entity),
  });

  return {
    items: communityItemsToNewsItems(items),
    total: items.length,
    hours,
    limit,
  };
}

export async function listFeedSourcesRpc(pool: Pool): Promise<ListFeedSourcesResponse> {
  const sources = await listFeedSources(pool);
  const records = sources.map(feedSourceToRecord);
  const grouped = groupSourcesByTier(sources);
  const curated = getCuratedFeedDefinitions().map((feed) => ({
    id: `platform:${feed.name}`,
    name: feed.name,
    siteUrl: feed.url,
    feedUrl: feed.url,
    category: feed.category,
    enabled: true,
    autoPull: true,
    discoveredVia: 'platform-curated',
    syndicationTier: 'platform' as const,
  }));

  return {
    sources: records,
    total: records.length,
    rss: {
      platform: {
        label: RSS_TIER_LABELS.platform,
        description: RSS_TIER_DESCRIPTIONS.platform,
        sources: curated,
      },
      syndicated: {
        label: RSS_TIER_LABELS.syndicated,
        description: RSS_TIER_DESCRIPTIONS.syndicated,
        catalogs: buildSyndicationCatalogs(sources),
        sources: grouped.syndicated.map(feedSourceToRecord),
      },
      discovered: {
        label: RSS_TIER_LABELS.discovered,
        description: RSS_TIER_DESCRIPTIONS.discovered,
        sources: grouped.discovered.map(feedSourceToRecord),
      },
    },
  };
}

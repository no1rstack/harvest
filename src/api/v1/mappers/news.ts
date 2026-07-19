import type { CommunityItem, CommunitySeverity } from '../../../feeds/communityTypes.js';
import type { DigestNewsItem } from '../../../feeds/rssDigest.js';
import type { CommunityFeedSource } from '../../../feeds/rssFeedRegistry.js';
import {
  classifyRegistrySource,
  syndicationCatalogId,
  syndicationCatalogLabel,
} from '../../../feeds/rssSyndication.js';
import type {
  CategoryBucket,
  ListFeedDigestResponse,
  NewsItem,
  ThreatLevel,
} from '../schemas/news.js';

const SEVERITY_TO_THREAT: Record<CommunitySeverity, ThreatLevel> = {
  low: 'THREAT_LEVEL_LOW',
  medium: 'THREAT_LEVEL_MEDIUM',
  high: 'THREAT_LEVEL_HIGH',
  critical: 'THREAT_LEVEL_CRITICAL',
};

function toEpochMs(isoOrMs: string | number | undefined): number | undefined {
  if (isoOrMs == null) return undefined;
  if (typeof isoOrMs === 'number') return isoOrMs;
  const parsed = Date.parse(isoOrMs);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function severityToThreatLevel(severity?: string): ThreatLevel {
  const key = (severity || 'low') as CommunitySeverity;
  return SEVERITY_TO_THREAT[key] || 'THREAT_LEVEL_UNSPECIFIED';
}

export function communityItemToNewsItem(item: CommunityItem): NewsItem {
  const enrichment = (item.payload?.enrichment || {}) as Record<string, unknown>;
  const corroborationCount =
    typeof enrichment.corroborationCount === 'number' ? enrichment.corroborationCount : undefined;
  const importanceScore =
    item.severityScore != null
      ? Math.round(item.severityScore * 100)
      : item.severity === 'critical'
        ? 90
        : item.severity === 'high'
          ? 70
          : item.severity === 'medium'
            ? 45
            : 20;

  const news: NewsItem = {
    id: item.id,
    source: item.sourceName,
    title: item.title,
    link: item.originalLink || item.sourceUrl,
    publishedAt: toEpochMs(item.publishedAt),
    isAlert: item.severity === 'critical' || item.severity === 'high',
    threat: {
      level: severityToThreatLevel(item.severity),
      category: item.category,
      source: 'harvest',
    },
    snippet: item.summary?.slice(0, 400) || '',
    category: item.category,
    importanceScore,
    corroborationCount,
  };

  if (item.lat != null && item.lon != null && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
    news.location = { latitude: item.lat, longitude: item.lon };
  }
  if (item.location) news.locationName = item.location;

  const entities = enrichment.entities;
  if (Array.isArray(entities) && entities.length) {
    news.storyMeta = { sourceCount: entities.length };
  }

  return news;
}

export function digestItemToNewsItem(item: DigestNewsItem): NewsItem {
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    link: item.link,
    publishedAt: toEpochMs(item.publishedAt),
    snippet: item.description?.slice(0, 400) || '',
    category: item.category,
    threat: { level: 'THREAT_LEVEL_UNSPECIFIED', category: item.category, source: 'harvest-live' },
  };
}

export function feedSourceToRecord(source: CommunityFeedSource) {
  const tier = classifyRegistrySource(source);
  const catalog =
    tier === 'syndicated' ? syndicationCatalogLabel(syndicationCatalogId(source.discoveredVia)) : undefined;
  return {
    id: source.id,
    name: source.name,
    siteUrl: source.siteUrl,
    feedUrl: source.feedUrl,
    category: source.category,
    enabled: source.enabled,
    autoPull: source.autoPull,
    discoveredVia: source.discoveredVia,
    syndicationTier: tier,
    syndicationCatalog: catalog,
    lastCheckedAt: source.lastCheckedAt,
    lastOkAt: source.lastOkAt,
    lastError: source.lastError,
  };
}

export function buildFeedDigestFromItems(
  items: NewsItem[],
  options?: { variant?: string; dataSource?: 'store' | 'live'; feedStatuses?: Record<string, string> },
): ListFeedDigestResponse {
  const categories: Record<string, CategoryBucket> = {};
  for (const item of items) {
    const cat = item.category || 'News';
    if (!categories[cat]) categories[cat] = { items: [] };
    categories[cat].items.push(item);
  }

  for (const bucket of Object.values(categories)) {
    bucket.items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  }

  return {
    categories,
    feedStatuses: options?.feedStatuses,
    generatedAt: new Date().toISOString(),
    variant: options?.variant || 'full',
    dataSource: options?.dataSource || 'store',
  };
}

export function communityItemsToNewsItems(items: CommunityItem[]): NewsItem[] {
  return items.map(communityItemToNewsItem);
}

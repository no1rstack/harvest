/**
 * News service schemas — aligned with World Monitor ListFeedDigest / NewsItem.
 * @see https://www.worldmonitor.app/docs/api-reference/newsservice/listfeeddigest
 */

export type ThreatLevel =
  | 'THREAT_LEVEL_UNSPECIFIED'
  | 'THREAT_LEVEL_LOW'
  | 'THREAT_LEVEL_MEDIUM'
  | 'THREAT_LEVEL_HIGH'
  | 'THREAT_LEVEL_CRITICAL';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface ThreatClassification {
  level: ThreatLevel;
  category?: string;
  confidence?: number;
  source?: string;
}

export interface StoryMeta {
  firstSeen?: number;
  mentionCount?: number;
  sourceCount?: number;
  phase?: string;
}

export interface NewsItem {
  source: string;
  title: string;
  link?: string;
  publishedAt?: number;
  isAlert?: boolean;
  threat?: ThreatClassification;
  location?: GeoCoordinates;
  locationName?: string;
  importanceScore?: number;
  corroborationCount?: number;
  storyMeta?: StoryMeta;
  snippet?: string;
  tickers?: string[];
  /** Harvest extension — stable store id */
  id?: string;
  category?: string;
}

export interface CategoryBucket {
  items: NewsItem[];
}

import type { buildRssSyndicationMeta } from '../../../feeds/rssSyndication.js';

export interface ListFeedDigestResponse {
  categories: Record<string, CategoryBucket>;
  feedStatuses?: Record<string, string>;
  generatedAt: string;
  variant?: string;
  dataSource?: 'store' | 'live';
  rss?: ReturnType<typeof buildRssSyndicationMeta>;
}

export interface FeedSourceRecord {
  id: string;
  name: string;
  siteUrl: string;
  feedUrl: string;
  category: string;
  enabled: boolean;
  autoPull: boolean;
  discoveredVia: string;
  syndicationTier?: 'platform' | 'syndicated' | 'discovered';
  syndicationCatalog?: string;
  lastCheckedAt?: string;
  lastOkAt?: string;
  lastError?: string;
}

export interface ListFeedSourcesResponse {
  sources: FeedSourceRecord[];
  total: number;
  rss: {
    platform: { label: string; description: string; sources: FeedSourceRecord[] };
    syndicated: {
      label: string;
      description: string;
      catalogs: Array<{ id: string; label: string; sourceCount: number }>;
      sources: FeedSourceRecord[];
    };
    discovered: { label: string; description: string; sources: FeedSourceRecord[] };
  };
}

export interface ListCommunityItemsResponse {
  items: NewsItem[];
  total: number;
  hours: number;
  limit: number;
}

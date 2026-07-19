/**
 * RSS feed syndication tiers — platform curated vs syndicated external publishers.
 */

import type { CommunityFeedSource } from './rssFeedRegistry.js';
import type { FeedDef } from './rssDigest.js';

export type RssSyndicationTier = 'platform' | 'syndicated' | 'discovered';

export const RSS_TIER_LABELS: Record<RssSyndicationTier, string> = {
  platform: 'Platform',
  syndicated: 'Syndicated',
  discovered: 'Discovered',
};

export const RSS_TIER_DESCRIPTIONS: Record<RssSyndicationTier, string> = {
  platform: 'Noir Stack curated RSS sources — always-on baseline coverage.',
  syndicated: 'Third-party publishers and imported catalogs (World Monitor, Crucix, registered outlets).',
  discovered: 'Feeds discovered from URLs and registered by operators.',
};

export interface RssSyndicationCatalog {
  id: string;
  label: string;
  sourceCount: number;
}

export function syndicationCatalogId(discoveredVia: string): string {
  if (discoveredVia.startsWith('worldmonitor:')) return 'worldmonitor';
  if (discoveredVia.startsWith('crucix')) return 'crucix';
  if (discoveredVia.startsWith('legal:')) return 'legal';
  if (discoveredVia.startsWith('cornell-lii')) return 'cornell-lii';
  if (discoveredVia.startsWith('govinfo')) return 'govinfo';
  if (discoveredVia.startsWith('courtlistener')) return 'courtlistener';
  if (discoveredVia === 'discovered') return 'discovered';
  return 'publishers';
}

export function syndicationCatalogLabel(catalogId: string): string {
  switch (catalogId) {
    case 'worldmonitor':
      return 'World Monitor catalog';
    case 'crucix':
      return 'Crucix seeds';
    case 'legal':
      return 'Legal & courts';
    case 'cornell-lii':
      return 'Cornell LII (Wex)';
    case 'govinfo':
      return 'GovInfo (official federal)';
    case 'courtlistener':
      return 'CourtListener / FLP';
    case 'discovered':
      return 'Discovered feeds';
    default:
      return 'Registered publishers';
  }
}

export function classifyRegistrySource(source: CommunityFeedSource): RssSyndicationTier {
  const via = (source.discoveredVia || '').toLowerCase();
  if (via === 'discovered' || via.startsWith('discover:')) return 'discovered';
  if (
    via.startsWith('worldmonitor:') ||
    via.startsWith('crucix') ||
    via === 'manual' ||
    via === 'import' ||
    via.includes('seed')
  ) {
    return 'syndicated';
  }
  return 'syndicated';
}

export function classifyCuratedFeed(_feed: FeedDef): RssSyndicationTier {
  return 'platform';
}

export function buildSyndicationCatalogs(sources: CommunityFeedSource[]): RssSyndicationCatalog[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    if (classifyRegistrySource(source) !== 'syndicated') continue;
    const id = syndicationCatalogId(source.discoveredVia);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, sourceCount]) => ({
      id,
      label: syndicationCatalogLabel(id),
      sourceCount,
    }))
    .sort((a, b) => b.sourceCount - a.sourceCount);
}

export function groupSourcesByTier(sources: CommunityFeedSource[]) {
  const platform: CommunityFeedSource[] = [];
  const syndicated: CommunityFeedSource[] = [];
  const discovered: CommunityFeedSource[] = [];
  for (const source of sources) {
    const tier = classifyRegistrySource(source);
    if (tier === 'platform') platform.push(source);
    else if (tier === 'discovered') discovered.push(source);
    else syndicated.push(source);
  }
  return { platform, syndicated, discovered };
}

export function buildRssSyndicationMeta(options: {
  platformSourceCount: number;
  registrySources: CommunityFeedSource[];
}) {
  const { platform, syndicated, discovered } = groupSourcesByTier(options.registrySources);
  return {
    platform: {
      tier: 'platform' as const,
      label: RSS_TIER_LABELS.platform,
      description: RSS_TIER_DESCRIPTIONS.platform,
      sourceCount: options.platformSourceCount,
    },
    syndicated: {
      tier: 'syndicated' as const,
      label: RSS_TIER_LABELS.syndicated,
      description: RSS_TIER_DESCRIPTIONS.syndicated,
      sourceCount: syndicated.length,
      catalogs: buildSyndicationCatalogs(options.registrySources),
    },
    discovered: {
      tier: 'discovered' as const,
      label: RSS_TIER_LABELS.discovered,
      description: RSS_TIER_DESCRIPTIONS.discovered,
      sourceCount: discovered.length,
    },
  };
}

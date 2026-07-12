import type {
  PlatformCommunityFeedsModuleConfig,
  PlatformFeedsConfig,
} from './types.js';

export function defaultCommunityFeedsModuleConfig(): PlatformCommunityFeedsModuleConfig {
  const feeds: PlatformFeedsConfig = {
    enabled: process.env.HARVEST_FEEDS_ENABLED !== '0',
    delegateFromJudicium: process.env.HARVEST_FEEDS_DELEGATE_JUDICIUM !== '0',
    layersIntervalMinutes: Number(process.env.HARVEST_FEEDS_LAYERS_INTERVAL_MINUTES || 30),
    rssIntervalMinutes: Number(process.env.HARVEST_FEEDS_RSS_INTERVAL_MINUTES || 60),
    dailyIntervalHours: Number(process.env.HARVEST_FEEDS_DAILY_INTERVAL_HOURS || 24),
    startupDelaySeconds: Number(process.env.HARVEST_FEEDS_STARTUP_DELAY_SECONDS || 20),
  };
  return {
    ...feeds,
    enrichment: {
      autoOnIngest: process.env.HARVEST_FEEDS_ENRICH_ON_INGEST !== '0',
      backfillHours: Number(process.env.HARVEST_FEEDS_BACKFILL_HOURS || 168),
      backfillLimit: Number(process.env.HARVEST_FEEDS_BACKFILL_LIMIT || 500),
    },
    expansion: {
      enabled: process.env.HARVEST_FEEDS_EXPANSION_ENABLED !== '0',
      defaultEnqueue: process.env.HARVEST_FEEDS_EXPANSION_ENQUEUE === '1',
      maxTargetsPerRun: Number(process.env.HARVEST_FEEDS_EXPANSION_MAX_TARGETS || 25),
      cascadesWorkflow: process.env.HARVEST_FEEDS_EXPANSION_WORKFLOW || 'threat-feed',
    },
  };
}

/** Keep legacy communityFeeds in sync with modules.communityFeeds base fields */
export function syncLegacyCommunityFeeds(
  module: PlatformCommunityFeedsModuleConfig,
): PlatformFeedsConfig {
  return {
    enabled: module.enabled,
    delegateFromJudicium: module.delegateFromJudicium,
    layersIntervalMinutes: module.layersIntervalMinutes,
    rssIntervalMinutes: module.rssIntervalMinutes,
    dailyIntervalHours: module.dailyIntervalHours,
    startupDelaySeconds: module.startupDelaySeconds,
  };
}

export function resolveCommunityFeedsConfig(
  config: { communityFeeds: PlatformFeedsConfig; modules?: { communityFeeds?: Partial<PlatformCommunityFeedsModuleConfig> } },
): PlatformCommunityFeedsModuleConfig {
  const base = defaultCommunityFeedsModuleConfig();
  const fromModule = config.modules?.communityFeeds || {};
  const fromLegacy = config.communityFeeds || {};
  return {
    ...base,
    ...fromLegacy,
    ...fromModule,
    enrichment: { ...base.enrichment, ...(fromModule.enrichment || {}) },
    expansion: { ...base.expansion, ...(fromModule.expansion || {}) },
  };
}

import type { HarvestModuleContract } from '../types.js';

export const COMMUNITY_FEEDS_CONTRACT_VERSION = '1.2.0';

export const COMMUNITY_FEEDS_MODULE_ID = 'community-feeds' as const;

/** Canonical API base (Harvest-owned). Judicium proxies /api/community/* here. */
export const COMMUNITY_FEEDS_API_BASE = '/api/feeds/community';

export const communityFeedsContract: HarvestModuleContract = {
  id: COMMUNITY_FEEDS_MODULE_ID,
  version: COMMUNITY_FEEDS_CONTRACT_VERSION,
  name: 'Community Feeds',
  description:
    'Operating-picture aggregation: RSS, sensor layers, enrichment, slice/dice facets, and optional keyword expansion into collection.',
  owner: 'harvest',
  store: {
    database: 'harvest-postgres',
    tables: ['community_items', 'community_stream_status', 'community_feed_sources'],
  },
  services: [
    {
      id: 'community-feeds-api',
      kind: 'api',
      description: 'Read and operate on aggregated community intelligence items.',
      basePath: COMMUNITY_FEEDS_API_BASE,
      endpoints: [
        { method: 'GET', path: '/items', judiciumProxyPath: '/api/community/items', auth: 'session', description: 'List/filter community items' },
        { method: 'GET', path: '/facets', judiciumProxyPath: '/api/community/facets', auth: 'session', description: 'Keyword/entity/category facets' },
        { method: 'GET', path: '/status', judiciumProxyPath: '/api/community/status', auth: 'session', description: 'Stream health and stats' },
        { method: 'GET', path: '/daily', judiciumProxyPath: '/api/community/daily', auth: 'session', description: 'Live RSS digest (ephemeral)' },
        { method: 'GET', path: '/layers', judiciumProxyPath: '/api/community/layers', auth: 'session', description: 'Free sensor layer catalog' },
        { method: 'GET', path: '/layers/:layer', judiciumProxyPath: '/api/community/layers/:layer', auth: 'session', description: 'Fetch and persist one layer' },
        { method: 'GET', path: '/corroboration', judiciumProxyPath: '/api/community/corroboration', auth: 'session', description: 'Narrative/sensor corroboration links' },
        { method: 'GET', path: '/pull/status', judiciumProxyPath: '/api/community/pull/status', auth: 'session', description: 'Pull worker status' },
        { method: 'POST', path: '/pull', judiciumProxyPath: '/api/community/pull', auth: 'collection-token', description: 'Trigger layers/rss/daily pull' },
        { method: 'POST', path: '/ingest', judiciumProxyPath: '/api/community/ingest', auth: 'collection-token', description: 'Upsert items from external stream' },
        { method: 'POST', path: '/enrich', judiciumProxyPath: '/api/community/enrich', auth: 'collection-token', description: 'Backfill keyword/entity enrichment' },
        { method: 'POST', path: '/expand', judiciumProxyPath: '/api/community/expand', auth: 'collection-token', description: 'Expand keywords to collection targets; optional Cascades enqueue' },
        { method: 'GET', path: '/sources', judiciumProxyPath: '/api/community/sources', auth: 'session', description: 'List registered RSS/Atom feed sources' },
        { method: 'POST', path: '/sources/discover', judiciumProxyPath: '/api/community/sources/discover', auth: 'session', description: 'Discover feeds from a site or feed URL' },
        { method: 'POST', path: '/sources', judiciumProxyPath: '/api/community/sources', auth: 'session', description: 'Register a feed source for automatic pull' },
        { method: 'POST', path: '/sources', judiciumProxyPath: '/api/community/sources', auth: 'session', description: 'Register a feed source for automatic pull' },
        { method: 'POST', path: '/sources/import', judiciumProxyPath: '/api/community/sources/import', auth: 'session', description: 'Bulk-import Crucix seeds or World Monitor AGPL RSS catalog' },
        { method: 'GET', path: '/sources/catalog/worldmonitor', judiciumProxyPath: '/api/community/sources/catalog/worldmonitor', auth: 'session', description: 'Browse World Monitor open-source RSS catalog (_feeds.ts)' },
        { method: 'PATCH', path: '/sources/:id', judiciumProxyPath: '/api/community/sources/:id', auth: 'session', description: 'Update feed source (enable, category, auto-pull)' },
        { method: 'DELETE', path: '/sources/:id', judiciumProxyPath: '/api/community/sources/:id', auth: 'session', description: 'Remove a registered feed source' },
        { method: 'POST', path: '/sources/:id/pull', judiciumProxyPath: '/api/community/sources/:id/pull', auth: 'collection-token', description: 'Pull one registered feed immediately' },
      ],
    },
  ],
  workers: [
    { id: 'feeds-layers', description: 'USGS/GDACS, OpenSky, Feodo/URLHaus pulls', schedulerKinds: ['feeds-layers'] },
    { id: 'feeds-rss', description: 'Global RSS digest + registered feed sources', schedulerKinds: ['feeds-rss'] },
    { id: 'feeds-daily', description: 'Full daily community pull cycle', schedulerKinds: ['feeds-daily'] },
  ],
  consumers: [
    {
      consumer: 'judicium',
      role: 'read',
      mustUse: [
        'GET /api/community/items',
        'GET /api/community/facets',
        'GET /api/community/status',
      ],
      mustNot: [
        'own community_items primary store',
        'run local community pull worker when HARVEST_FEEDS_ENABLED=1',
        'write feed_items for community operating picture',
      ],
    },
    {
      consumer: 'cascades',
      role: 'write',
      mustUse: ['collection_targets seeded via POST /api/feeds/community/expand'],
      mustNot: ['ingest RSS directly into community_items'],
    },
  ],
  configKeys: [
    'modules.communityFeeds.enabled',
    'modules.communityFeeds.delegateFromJudicium',
    'modules.communityFeeds.layersIntervalMinutes',
    'modules.communityFeeds.rssIntervalMinutes',
    'modules.communityFeeds.dailyIntervalHours',
    'modules.communityFeeds.enrichment.autoOnIngest',
    'modules.communityFeeds.expansion.enabled',
    'modules.communityFeeds.expansion.defaultEnqueue',
  ],
};

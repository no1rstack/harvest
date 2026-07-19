import type { HarvestModuleContract } from '../types.js';

export const COMMUNITY_FEEDS_CONTRACT_VERSION = '1.4.0';

export const COMMUNITY_FEEDS_MODULE_ID = 'community-feeds' as const;

/** Harvest foundation API — World Monitor layout (/api/<service>/v1/<rpc-name>). */
export const HARVEST_FOUNDATION_API_REFERENCE =
  'https://www.worldmonitor.app/docs/api-reference';

/** Legacy Judicium proxy base — map/UI may use any shape; foundation is v1 RPCs. */
export const COMMUNITY_FEEDS_API_BASE = '/api/feeds/community';

export const communityFeedsContract: HarvestModuleContract = {
  id: COMMUNITY_FEEDS_MODULE_ID,
  version: COMMUNITY_FEEDS_CONTRACT_VERSION,
  name: 'Community Feeds',
  description:
    'Operating-picture aggregation: RSS, sensor layers, enrichment. Harvest foundation APIs follow World Monitor service layout; Judicium community map uses legacy proxy paths.',
  owner: 'harvest',
  store: {
    database: 'harvest-postgres',
    tables: ['community_items', 'community_stream_status', 'community_feed_sources'],
  },
  services: [
    {
      id: 'harvest-foundation-v1',
      kind: 'api',
      description: 'Canonical Harvest RPC surface (World Monitor API layout).',
      basePath: '/api',
      endpoints: [
        { method: 'GET', path: '/news/v1/list-feed-digest', auth: 'session', description: 'RSS digest by category (NewsItem envelope)' },
        { method: 'GET', path: '/news/v1/list-community-items', auth: 'session', description: 'Filtered narrative items' },
        { method: 'GET', path: '/news/v1/list-feed-sources', auth: 'session', description: 'Feed source registry' },
        { method: 'GET', path: '/seismology/v1/list-earthquakes', auth: 'session', description: 'USGS earthquakes' },
        { method: 'GET', path: '/climate/v1/list-climate-disasters', auth: 'session', description: 'GDACS disasters' },
        { method: 'GET', path: '/cyber/v1/list-cyber-threats', auth: 'session', description: 'Feodo/URLHaus indicators' },
        { method: 'GET', path: '/aviation/v1/list-aircraft-positions', auth: 'session', description: 'OpenSky snapshot' },
        { method: 'POST', path: '/batch/v1/execute', auth: 'session', description: 'Batch read fan-out (max 20 GETs)' },
        { method: 'GET', path: '/platform/v1/list-services', auth: 'session', description: 'Service catalog' },
        { method: 'GET', path: '/platform/v1/get-community-status', auth: 'session', description: 'Pull worker status' },
        { method: 'POST', path: '/platform/v1/run-community-pull', auth: 'collection-token', description: 'Trigger ingestion pull' },
      ],
    },
    {
      id: 'community-feeds-legacy',
      kind: 'api',
      description: 'Legacy aliases for Judicium /api/community/* proxy — not the foundation layer.',
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
        { method: 'POST', path: '/sources/import', judiciumProxyPath: '/api/community/sources/import', auth: 'session', description: 'Bulk-import Crucix, World Monitor, or legal RSS catalog' },
        { method: 'GET', path: '/sources/catalog/worldmonitor', judiciumProxyPath: '/api/community/sources/catalog/worldmonitor', auth: 'session', description: 'Browse World Monitor open-source RSS catalog (_feeds.ts)' },
        { method: 'GET', path: '/sources/catalog/legal', judiciumProxyPath: '/api/community/sources/catalog/legal', auth: 'session', description: 'Browse legal RSS catalog (Lawyers & Settlements, JD Supra, courts)' },
        { method: 'PATCH', path: '/sources/:id', judiciumProxyPath: '/api/community/sources/:id', auth: 'session', description: 'Update feed source (enable, category, auto-pull)' },
        { method: 'DELETE', path: '/sources/:id', judiciumProxyPath: '/api/community/sources/:id', auth: 'session', description: 'Remove a registered feed source' },
        { method: 'POST', path: '/sources/:id/pull', judiciumProxyPath: '/api/community/sources/:id/pull', auth: 'collection-token', description: 'Pull one registered feed immediately' },
      ],
    },
  ],
  workers: [
    { id: 'feeds-layers', description: 'USGS/GDACS, OpenSky, Feodo/URLHaus pulls', schedulerKinds: ['feeds-layers'] },
    { id: 'feeds-rss', description: 'Global RSS digest + registered feed sources', schedulerKinds: ['feeds-rss'] },
    { id: 'feeds-corpus', description: 'Shared corpora (AIID, APTnotes) → community_items', schedulerKinds: ['feeds-corpus'] },
    { id: 'feeds-daily', description: 'Full daily community pull cycle (layers + RSS + corpus)', schedulerKinds: ['feeds-daily'] },
  ],
  consumers: [
    {
      consumer: 'judicium',
      role: 'read',
      mustUse: [
        'GET /api/news/v1/list-feed-digest (foundation)',
        'GET /api/news/v1/list-community-items (foundation)',
        'GET /api/community/items (legacy proxy — any map shape)',
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

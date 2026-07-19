/**
 * Harvest API v1 service catalog — layout follows World Monitor API reference.
 * @see https://www.worldmonitor.app/docs/api-reference
 */

export interface HarvestServiceRpc {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
}

export interface HarvestServiceGroup {
  id: string;
  label: string;
  description: string;
  basePath: string;
  rpcs: HarvestServiceRpc[];
}

export const HARVEST_API_LAYOUT_REFERENCE =
  'https://www.worldmonitor.app/docs/api-reference';

export const HARVEST_V1_SERVICES: HarvestServiceGroup[] = [
  {
    id: 'news',
    label: 'News',
    description: 'RSS digest and community narrative items (Harvest-owned ingestion).',
    basePath: '/api/news/v1',
    rpcs: [
      { method: 'GET', path: '/list-feed-digest', summary: 'Pre-aggregated feed digest by category' },
      { method: 'GET', path: '/list-community-items', summary: 'Filtered community news items' },
      { method: 'GET', path: '/list-feed-sources', summary: 'Registered RSS/Atom feed sources' },
    ],
  },
  {
    id: 'seismology',
    label: 'Seismology',
    description: 'Earthquake events from USGS (Harvest sensor layer).',
    basePath: '/api/seismology/v1',
    rpcs: [{ method: 'GET', path: '/list-earthquakes', summary: 'Recent earthquakes M4.5+' }],
  },
  {
    id: 'climate',
    label: 'Climate',
    description: 'Climate-relevant disaster alerts from GDACS.',
    basePath: '/api/climate/v1',
    rpcs: [{ method: 'GET', path: '/list-climate-disasters', summary: 'GDACS disaster alerts' }],
  },
  {
    id: 'cyber',
    label: 'Cyber',
    description: 'Threat indicators from Feodo and URLHaus.',
    basePath: '/api/cyber/v1',
    rpcs: [{ method: 'GET', path: '/list-cyber-threats', summary: 'Active cyber threat indicators' }],
  },
  {
    id: 'aviation',
    label: 'Aviation',
    description: 'Aircraft position snapshot from OpenSky.',
    basePath: '/api/aviation/v1',
    rpcs: [{ method: 'GET', path: '/list-aircraft-positions', summary: 'Sampled aircraft positions' }],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    description: 'Collection observations, entities, graph, claims, STIX export.',
    basePath: '/api/intelligence/v1',
    rpcs: [
      { method: 'GET', path: '/observations', summary: 'Collection observations' },
      { method: 'GET', path: '/graph/neighbors', summary: 'Entity graph neighbors' },
      { method: 'GET', path: '/claims', summary: 'Analyst claims' },
      { method: 'GET', path: '/ontology', summary: 'Ontology snapshot' },
    ],
  },
  {
    id: 'collection',
    label: 'Collection',
    description: 'Cascades-facing collection platform (targets, steps, events).',
    basePath: '/api/collection',
    rpcs: [
      { method: 'GET', path: '/catalog', summary: 'Workflow catalog' },
      { method: 'POST', path: '/steps/collect-connector', summary: 'Run one connector' },
    ],
  },
  {
    id: 'batch',
    label: 'Batch',
    description: 'Concurrent read fan-out (max 20 GET operations per request).',
    basePath: '/api/batch/v1',
    rpcs: [{ method: 'POST', path: '/execute', summary: 'Execute batch read operations' }],
  },
  {
    id: 'platform',
    label: 'Platform',
    description: 'Harvest ops — pull workers, scheduler, module status.',
    basePath: '/api/platform/v1',
    rpcs: [
      { method: 'GET', path: '/get-community-status', summary: 'Community feeds worker status' },
      { method: 'POST', path: '/run-community-pull', summary: 'Trigger RSS/layers/daily pull' },
      { method: 'GET', path: '/list-services', summary: 'This service catalog' },
    ],
  },
];

/** GET paths allowed in batch execute (Harvest v1 reads only). */
export const HARVEST_BATCH_ALLOWLIST = new Set([
  '/api/news/v1/list-feed-digest',
  '/api/news/v1/list-community-items',
  '/api/news/v1/list-feed-sources',
  '/api/seismology/v1/list-earthquakes',
  '/api/climate/v1/list-climate-disasters',
  '/api/cyber/v1/list-cyber-threats',
  '/api/aviation/v1/list-aircraft-positions',
  '/api/platform/v1/get-community-status',
  '/api/platform/v1/list-services',
]);

export function listServicesCatalog() {
  return {
    layoutReference: HARVEST_API_LAYOUT_REFERENCE,
    apiBase: '/api',
    version: 'v1',
    services: HARVEST_V1_SERVICES,
    batch: {
      path: '/api/batch/v1/execute',
      maxOperations: 20,
      allowedPaths: [...HARVEST_BATCH_ALLOWLIST],
    },
    legacy: {
      note: 'Judicium community map may consume legacy /api/feeds/community/* aliases; Harvest foundation is v1 RPC layout.',
      communityFeedsBase: '/api/feeds/community',
    },
  };
}

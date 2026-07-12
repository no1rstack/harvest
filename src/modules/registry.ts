import { loadPlatformConfig } from '../platform/config.js';
import type { HarvestModuleContract, HarvestModuleId, HarvestModuleSummary } from './types.js';
import {
  COMMUNITY_FEEDS_API_BASE,
  COMMUNITY_FEEDS_CONTRACT_VERSION,
  COMMUNITY_FEEDS_MODULE_ID,
  communityFeedsContract,
} from './community-feeds/contract.js';

const CONTRACTS: Record<HarvestModuleId, HarvestModuleContract> = {
  'community-feeds': communityFeedsContract,
  collection: {
    id: 'collection',
    version: '0.1.0',
    name: 'Collection Platform',
    description: 'Target registry, Cascades orchestration, observations (see /api/collection, /api/harvest).',
    owner: 'harvest',
    store: { database: 'harvest-postgres', tables: ['collection_targets', 'osint_harvest_findings'] },
    services: [],
    workers: [],
    consumers: [{ consumer: 'judicium', role: 'read', mustUse: ['/api/intelligence/v1/*'] }],
    configKeys: ['scheduler.cascadesDuePull'],
  },
  intelligence: {
    id: 'intelligence',
    version: '0.1.0',
    name: 'Intelligence Core',
    description: 'Claims, knowledge objects, STIX materialization (see /api/intelligence/v1).',
    owner: 'harvest',
    store: { database: 'harvest-postgres', tables: ['knowledge_objects', 'stix_objects'] },
    services: [],
    workers: [],
    consumers: [{ consumer: 'judicium', role: 'read', mustUse: ['/api/intelligence/v1/*'] }],
    configKeys: [],
  },
};

export function listHarvestModules(): HarvestModuleSummary[] {
  const config = loadPlatformConfig();
  const cf = config.modules.communityFeeds;
  const publicUrl = config.integrations.harvestPublicUrl.replace(/\/$/, '');

  return [
    {
      id: COMMUNITY_FEEDS_MODULE_ID,
      version: COMMUNITY_FEEDS_CONTRACT_VERSION,
      name: communityFeedsContract.name,
      enabled: cf.enabled,
      owner: 'harvest',
      apiBase: `${publicUrl}${COMMUNITY_FEEDS_API_BASE}`,
    },
    {
      id: 'collection',
      version: CONTRACTS.collection.version,
      name: CONTRACTS.collection.name,
      enabled: config.scheduler.enabled,
      owner: 'harvest',
      apiBase: `${publicUrl}/api/collection`,
    },
    {
      id: 'intelligence',
      version: CONTRACTS.intelligence.version,
      name: CONTRACTS.intelligence.name,
      enabled: config.judicium.useHarvestIntelligenceHttp,
      owner: 'harvest',
      apiBase: `${publicUrl}/api/intelligence/v1`,
    },
  ];
}

export function getHarvestModuleContract(id: string): HarvestModuleContract | null {
  return CONTRACTS[id as HarvestModuleId] ?? null;
}

export function getCommunityFeedsContract(): HarvestModuleContract {
  return communityFeedsContract;
}

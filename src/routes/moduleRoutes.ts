/**
 * Harvest platform modules API — explicit contracts for cross-product integration.
 */

import type { Express } from 'express';
import { loadPlatformConfig } from '../platform/config.js';
import { resolveCommunityFeedsConfig } from '../modules/community-feeds/config.js';
import {
  COMMUNITY_FEEDS_CONTRACT_VERSION,
  COMMUNITY_FEEDS_MODULE_ID,
} from '../modules/community-feeds/contract.js';
import { getHarvestModuleContract, listHarvestModules } from '../modules/registry.js';

export function registerModuleRoutes(app: Express): void {
  app.get('/api/platform/modules', (_req, res) => {
    try {
      const config = loadPlatformConfig();
      res.json({
        modules: listHarvestModules(),
        owner: 'harvest',
        configPath: process.env.HARVEST_PLATFORM_CONFIG_DIR || 'data/platform-config.json',
        judiciumDelegation: config.modules.communityFeeds.delegateFromJudicium,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/platform/modules/:moduleId/contract', (req, res) => {
    const contract = getHarvestModuleContract(String(req.params.moduleId || ''));
    if (!contract) {
      return res.status(404).json({ error: 'Unknown module', id: req.params.moduleId });
    }
    const config = loadPlatformConfig();
    const moduleConfig =
      contract.id === COMMUNITY_FEEDS_MODULE_ID
        ? resolveCommunityFeedsConfig(config)
        : undefined;
    res.json({
      contract,
      runtime: {
        enabled: moduleConfig?.enabled,
        config: moduleConfig,
      },
    });
  });

  app.get('/api/platform/modules/community-feeds/config', (_req, res) => {
    try {
      const config = loadPlatformConfig();
      res.json({
        module: COMMUNITY_FEEDS_MODULE_ID,
        version: COMMUNITY_FEEDS_CONTRACT_VERSION,
        config: resolveCommunityFeedsConfig(config),
        legacyAlias: config.communityFeeds,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

/** Attach module identity headers on community feeds API responses */
export function communityFeedsContractHeaders(
  _req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  res.setHeader('X-Harvest-Module', COMMUNITY_FEEDS_MODULE_ID);
  res.setHeader('X-Harvest-Module-Version', COMMUNITY_FEEDS_CONTRACT_VERSION);
  res.setHeader('X-Harvest-Module-Owner', 'harvest');
  next();
}

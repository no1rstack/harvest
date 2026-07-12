/**
 * Platform configuration API — schedulers, integrations, Judicium wiring.
 */

import type { Express } from 'express';
import path from 'path';
import { getPlatformConfigPath, loadPlatformConfig } from '../platform/config.js';
import {
  applyPlatformConfigUpdate,
  getSchedulerStatus,
  restartPlatformScheduler,
  startPlatformScheduler,
  triggerSchedulerRun,
} from '../platform/scheduler.js';
import type { PlatformConfig } from '../platform/types.js';
import { getCommunityPullStatusAsync } from '../feeds/communityPullWorker.js';

export function registerPlatformRoutes(app: Express): void {
  app.get('/api/harvest/platform/config', (_req, res) => {
    try {
      const config = loadPlatformConfig();
      res.json({
        config,
        configPath: getPlatformConfigPath(),
        envOverrides: {
          HARVEST_SCHEDULER_ENABLED: process.env.HARVEST_SCHEDULER_ENABLED ?? null,
          HARVEST_FEEDS_ENABLED: process.env.HARVEST_FEEDS_ENABLED ?? null,
          CASCADES_API_URL: process.env.CASCADES_API_URL ?? null,
          CASCADES_PUBLIC_URL: process.env.CASCADES_PUBLIC_URL ?? null,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/harvest/platform/config', (req, res) => {
    try {
      const body = (req.body?.config || req.body || {}) as Partial<PlatformConfig>;
      const next = applyPlatformConfigUpdate(body);
      res.json({ ok: true, config: next, configPath: getPlatformConfigPath() });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/harvest/platform/status', async (_req, res) => {
    try {
      const config = loadPlatformConfig();
      const scheduler = getSchedulerStatus();
      const feeds = await getCommunityPullStatusAsync();
      res.json({
        config,
        scheduler,
        feeds,
        targetsFile: path.join(process.cwd(), 'scripts/osint-harvest/targets.txt'),
        judicium: {
          useHarvestIntelligenceHttp: config.judicium.useHarvestIntelligenceHttp,
          harvestIntelligenceUrl: config.judicium.harvestIntelligenceUrl,
          communityFeedsDelegate: config.modules.communityFeeds.delegateFromJudicium,
          suggestedEnv: {
            HARVEST_INTELLIGENCE_URL: config.judicium.harvestIntelligenceUrl,
            HARVEST_FEEDS_URL: `${config.integrations.harvestPublicUrl}/api/feeds/community`,
            HARVEST_FEEDS_ENABLED: config.modules.communityFeeds.enabled ? '1' : '0',
            COMMUNITY_PULL_DISABLED: config.modules.communityFeeds.delegateFromJudicium ? '1' : '0',
          },
          contract: {
            module: 'community-feeds',
            version: '1.0.0',
            contractUrl: `${config.integrations.harvestPublicUrl}/api/feeds/community/contract`,
          },
        },
        modules: {
          communityFeeds: config.modules.communityFeeds,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/harvest/platform/restart', (_req, res) => {
    try {
      restartPlatformScheduler();
      res.json({ ok: true, scheduler: getSchedulerStatus() });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/harvest/platform/run/:kind', async (req, res) => {
    const kind = String(req.params.kind || '') as
      | 'cascades-due' | 'daily-pull' | 'feeds-layers' | 'feeds-rss' | 'feeds-daily';
    const allowed = ['cascades-due', 'daily-pull', 'feeds-layers', 'feeds-rss', 'feeds-daily'];
    if (!allowed.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${allowed.join(', ')}` });
    }
    try {
      const result = await triggerSchedulerRun(kind);
      res.status(202).json({ ok: true, kind, result, scheduler: getSchedulerStatus() });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

export function bootPlatformScheduler(): void {
  startPlatformScheduler();
}

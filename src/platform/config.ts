import fs from 'fs';
import path from 'path';
import type { PlatformConfig } from './types.js';

const CONFIG_VERSION = 1 as const;
const CONFIG_DIR = process.env.HARVEST_PLATFORM_CONFIG_DIR || path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'platform-config.json');

export function defaultPlatformConfig(): PlatformConfig {
  const now = new Date().toISOString();
  return {
    version: CONFIG_VERSION,
    updatedAt: now,
    scheduler: {
      enabled: process.env.HARVEST_SCHEDULER_ENABLED !== '0',
      cascadesDuePull: {
        enabled: process.env.HARVEST_CASCADES_DUE_ENABLED !== '0',
        intervalMinutes: Number(process.env.HARVEST_CASCADES_DUE_INTERVAL_MINUTES || 60),
        workflowTemplate: 'passive-domain-collection',
        limit: Number(process.env.HARVEST_CASCADES_DUE_LIMIT || 100),
        seedFromTargetsFile: true,
      },
      dailyPull: {
        enabled: process.env.HARVEST_DAILY_PULL_ENABLED !== '0',
        mode: (process.env.HARVEST_DAILY_PULL_MODE as PlatformConfig['scheduler']['dailyPull']['mode']) || 'cascades-due',
        intervalHours: Number(process.env.HARVEST_DAILY_PULL_INTERVAL_HOURS || 24),
        dryRun: process.env.HARVEST_DAILY_PULL_DRY_RUN === '1',
      },
    },
    communityFeeds: {
      enabled: process.env.HARVEST_FEEDS_ENABLED !== '0',
      delegateFromJudicium: process.env.HARVEST_FEEDS_DELEGATE_JUDICIUM !== '0',
      layersIntervalMinutes: Number(process.env.HARVEST_FEEDS_LAYERS_INTERVAL_MINUTES || 30),
      rssIntervalMinutes: Number(process.env.HARVEST_FEEDS_RSS_INTERVAL_MINUTES || 60),
      dailyIntervalHours: Number(process.env.HARVEST_FEEDS_DAILY_INTERVAL_HOURS || 24),
      startupDelaySeconds: Number(process.env.HARVEST_FEEDS_STARTUP_DELAY_SECONDS || 20),
    },
    integrations: {
      cascadesApiUrl: (process.env.CASCADES_API_URL || 'http://cascades:3000').replace(/\/$/, ''),
      cascadesPublicUrl: (process.env.CASCADES_PUBLIC_URL || 'https://cascades.noirstack.com').replace(/\/$/, ''),
      harvestPublicUrl: (process.env.HARVEST_PUBLIC_URL || 'https://harvest.noirstack.com').replace(/\/$/, ''),
      judiciumPublicUrl: (process.env.JUDICIUM_PUBLIC_URL || 'https://judicium.app').replace(/\/$/, ''),
    },
    judicium: {
      useHarvestIntelligenceHttp: process.env.JUDICIUM_USE_HARVEST_INTELLIGENCE !== '0',
      harvestIntelligenceUrl: (
        process.env.HARVEST_INTELLIGENCE_URL ||
        process.env.HARVEST_PUBLIC_URL ||
        'https://harvest.noirstack.com'
      ).replace(/\/$/, ''),
    },
  };
}

function mergeConfig(partial: Partial<PlatformConfig>, base: PlatformConfig): PlatformConfig {
  return {
    ...base,
    ...partial,
    version: CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
    scheduler: {
      ...base.scheduler,
      ...(partial.scheduler || {}),
      cascadesDuePull: { ...base.scheduler.cascadesDuePull, ...(partial.scheduler?.cascadesDuePull || {}) },
      dailyPull: { ...base.scheduler.dailyPull, ...(partial.scheduler?.dailyPull || {}) },
    },
    communityFeeds: { ...base.communityFeeds, ...(partial.communityFeeds || {}) },
    integrations: { ...base.integrations, ...(partial.integrations || {}) },
    judicium: { ...base.judicium, ...(partial.judicium || {}) },
  };
}

let cached: PlatformConfig | null = null;

export function getPlatformConfigPath(): string {
  return CONFIG_FILE;
}

export function loadPlatformConfig(): PlatformConfig {
  if (cached) return cached;
  const base = defaultPlatformConfig();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<PlatformConfig>;
      cached = mergeConfig(raw, base);
      return cached;
    }
  } catch (err) {
    console.warn('[platform] config load failed, using defaults:', (err as Error).message);
  }
  cached = base;
  return cached;
}

export function savePlatformConfig(partial: Partial<PlatformConfig>): PlatformConfig {
  const current = loadPlatformConfig();
  const next = mergeConfig(partial, current);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o644 });
  cached = next;
  return next;
}

export function reloadPlatformConfig(): PlatformConfig {
  cached = null;
  return loadPlatformConfig();
}

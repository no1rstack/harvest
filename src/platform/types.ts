/** Harvest platform integration — schedulers, feeds, product wiring. */

export type DailyPullMode = 'cascades-due' | 'shell' | 'both' | 'disabled';

export interface PlatformSchedulerConfig {
  enabled: boolean;
  /** Poll due targets and enqueue passive-domain-collection via Cascades */
  cascadesDuePull: {
    enabled: boolean;
    intervalMinutes: number;
    workflowTemplate: string;
    limit: number;
    seedFromTargetsFile: boolean;
  };
  /** Full daily cycle (seed targets + due pull) */
  dailyPull: {
    enabled: boolean;
    mode: DailyPullMode;
    intervalHours: number;
    dryRun: boolean;
  };
}

export interface PlatformFeedsConfig {
  enabled: boolean;
  delegateFromJudicium: boolean;
  layersIntervalMinutes: number;
  rssIntervalMinutes: number;
  dailyIntervalHours: number;
  startupDelaySeconds: number;
}

export interface PlatformIntegrationsConfig {
  cascadesApiUrl: string;
  cascadesPublicUrl: string;
  harvestPublicUrl: string;
  judiciumPublicUrl: string;
}

export interface PlatformJudiciumConfig {
  /** When true, Judicium should read intelligence via Harvest HTTP only */
  useHarvestIntelligenceHttp: boolean;
  harvestIntelligenceUrl: string;
}

export interface PlatformConfig {
  version: 1;
  updatedAt: string;
  scheduler: PlatformSchedulerConfig;
  communityFeeds: PlatformFeedsConfig;
  integrations: PlatformIntegrationsConfig;
  judicium: PlatformJudiciumConfig;
}

export interface SchedulerRunRecord {
  kind: 'cascades-due' | 'daily-pull' | 'feeds-layers' | 'feeds-rss' | 'feeds-daily';
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
  submissions?: number;
  failed?: number;
}

export interface PlatformStatus {
  config: PlatformConfig;
  scheduler: {
    active: boolean;
    lastRuns: SchedulerRunRecord[];
    nextDueAt?: Record<string, string | null>;
  };
  feeds?: ReturnType<typeof import('../feeds/communityPullWorker.js').getCommunityPullStatus>;
}

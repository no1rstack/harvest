/**
 * In-process platform scheduler — collection due pull + optional shell daily.
 */

import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { getHarvestPool } from '../db/harvestPostgres.js';
import { submitDueTargetsToCascades } from '../collection/submitDue.js';
import { loadPlatformConfig, reloadPlatformConfig, savePlatformConfig } from './config.js';
import type { PlatformConfig, SchedulerRunRecord } from './types.js';
import {
  restartCommunityFeedsWorker,
  startCommunityFeedsWorker,
  stopCommunityFeedsWorker,
} from '../feeds/communityPullWorker.js';

const ROOT = process.cwd();
const TARGETS_FILE = path.join(ROOT, 'scripts/osint-harvest/targets.txt');
const LOG_DIR = path.join(ROOT, 'logs/osint-harvest');
const MAX_RUN_HISTORY = 40;

let active = false;
let timers: ReturnType<typeof setInterval>[] = [];
let shellJob: ChildProcess | null = null;
const lastRuns: SchedulerRunRecord[] = [];
const nextDueAt: Record<string, string | null> = {};

function pushRun(record: SchedulerRunRecord) {
  lastRuns.unshift(record);
  if (lastRuns.length > MAX_RUN_HISTORY) lastRuns.length = MAX_RUN_HISTORY;
}

function recordStart(kind: SchedulerRunRecord['kind']): SchedulerRunRecord {
  const rec: SchedulerRunRecord = {
    kind,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  pushRun(rec);
  return rec;
}

function recordFinish(rec: SchedulerRunRecord, status: 'completed' | 'failed', detail?: string, extra?: Partial<SchedulerRunRecord>) {
  rec.finishedAt = new Date().toISOString();
  rec.status = status;
  if (detail) rec.detail = detail;
  Object.assign(rec, extra);
}

async function runCascadesDue(cfg: PlatformConfig): Promise<void> {
  const pool = getHarvestPool();
  if (!pool) {
    console.warn('[platform-scheduler] cascades-due skipped — no harvest pool');
    return;
  }
  const rec = recordStart('cascades-due');
  try {
    const result = await submitDueTargetsToCascades(pool, {
      dryRun: cfg.scheduler.dailyPull.dryRun,
      limit: cfg.scheduler.cascadesDuePull.limit,
      seedFromTargetsFile: cfg.scheduler.cascadesDuePull.seedFromTargetsFile ? TARGETS_FILE : undefined,
      actor: 'harvest-platform-scheduler',
    });
    recordFinish(rec, result.failed > 0 ? 'failed' : 'completed', undefined, {
      submissions: result.submissions.length,
      failed: result.failed,
    });
    console.log(`[platform-scheduler] cascades-due submissions=${result.submissions.length} failed=${result.failed}`);
  } catch (err: unknown) {
    recordFinish(rec, 'failed', (err as Error).message);
    console.warn('[platform-scheduler] cascades-due error:', (err as Error).message);
  }
}

function runShellDaily(dryRun: boolean): void {
  if (shellJob) {
    console.warn('[platform-scheduler] shell daily skipped — job already running');
    return;
  }
  const rec = recordStart('daily-pull');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOG_DIR, `scheduler-daily-${stamp}.log`);
  const out = fs.openSync(logFile, 'a');
  const args = dryRun ? ['run', 'osint:daily:dry'] : ['run', 'osint:daily'];
  shellJob = spawn('npm', args, { cwd: ROOT, env: process.env, stdio: ['ignore', out, out] });
  shellJob.on('exit', (code) => {
    recordFinish(rec, code === 0 ? 'completed' : 'failed', `exit=${code} log=${logFile}`);
    shellJob = null;
    try { fs.closeSync(out); } catch { /* ignore */ }
  });
}

async function runDailyPull(cfg: PlatformConfig): Promise<void> {
  const mode = cfg.scheduler.dailyPull.mode;
  if (mode === 'disabled') return;
  if (mode === 'shell' || mode === 'both') runShellDaily(cfg.scheduler.dailyPull.dryRun);
  if (mode === 'cascades-due' || mode === 'both') await runCascadesDue(cfg);
}

function scheduleInterval(key: string, ms: number, fn: () => void | Promise<void>) {
  const tick = () => {
    nextDueAt[key] = new Date(Date.now() + ms).toISOString();
    Promise.resolve(fn()).catch((e) => console.warn(`[platform-scheduler] ${key} failed:`, (e as Error).message));
  };
  nextDueAt[key] = new Date(Date.now() + ms).toISOString();
  timers.push(setInterval(tick, ms));
}

export function stopPlatformScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
  active = false;
  stopCommunityFeedsWorker();
  if (shellJob) {
    try { shellJob.kill('SIGTERM'); } catch { /* ignore */ }
    shellJob = null;
  }
}

export function restartPlatformScheduler(): void {
  stopPlatformScheduler();
  startPlatformScheduler();
}

export function startPlatformScheduler(): void {
  if (active) return;
  const cfg = reloadPlatformConfig();
  const pool = getHarvestPool();

  if (cfg.communityFeeds.enabled && pool) {
    startCommunityFeedsWorker(pool);
  } else {
    stopCommunityFeedsWorker();
  }

  if (!cfg.scheduler.enabled) {
    console.log('[platform-scheduler] Disabled (scheduler.enabled=false)');
    active = true;
    return;
  }

  active = true;
  const dueMs = cfg.scheduler.cascadesDuePull.intervalMinutes * 60_000;
  const dailyMs = cfg.scheduler.dailyPull.intervalHours * 3_600_000;

  if (cfg.scheduler.cascadesDuePull.enabled) {
    console.log(`[platform-scheduler] Cascades due pull every ${cfg.scheduler.cascadesDuePull.intervalMinutes}m`);
    scheduleInterval('cascades-due', dueMs, () => runCascadesDue(cfg));
    setTimeout(() => runCascadesDue(cfg).catch(() => {}), 30_000);
  }

  if (cfg.scheduler.dailyPull.enabled && cfg.scheduler.dailyPull.mode !== 'disabled') {
    console.log(
      `[platform-scheduler] Daily pull every ${cfg.scheduler.dailyPull.intervalHours}h mode=${cfg.scheduler.dailyPull.mode}`,
    );
    scheduleInterval('daily-pull', dailyMs, () => runDailyPull(cfg));
  }
}

export function getSchedulerStatus() {
  return {
    active,
    lastRuns: [...lastRuns],
    nextDueAt: { ...nextDueAt },
    shellJobRunning: Boolean(shellJob),
  };
}

export async function triggerSchedulerRun(
  kind: 'cascades-due' | 'daily-pull' | 'feeds-layers' | 'feeds-rss' | 'feeds-daily',
): Promise<SchedulerRunRecord | SchedulerRunRecord[]> {
  const cfg = loadPlatformConfig();
  const pool = getHarvestPool();

  if (kind === 'cascades-due') {
    await runCascadesDue(cfg);
    return lastRuns[0];
  }
  if (kind === 'daily-pull') {
    await runDailyPull(cfg);
    return lastRuns[0];
  }

  if (!pool) throw new Error('Harvest Postgres not configured');

  const { pullFreeLayers, pullRssDigest, runCommunityDailyPull } = await import('../feeds/communityPullWorker.js');

  if (kind === 'feeds-layers') {
    const rec = recordStart('feeds-layers');
    try {
      const results = await pullFreeLayers();
      const persisted = results.reduce((n, r) => n + r.persisted, 0);
      recordFinish(rec, 'completed', undefined, { submissions: persisted });
    } catch (err: unknown) {
      recordFinish(rec, 'failed', (err as Error).message);
    }
    return rec;
  }

  if (kind === 'feeds-rss') {
    const rec = recordStart('feeds-rss');
    try {
      const result = await pullRssDigest();
      recordFinish(rec, 'completed', undefined, { submissions: result.persisted });
    } catch (err: unknown) {
      recordFinish(rec, 'failed', (err as Error).message);
    }
    return rec;
  }

  const rec = recordStart('feeds-daily');
  try {
    await runCommunityDailyPull();
    recordFinish(rec, 'completed');
  } catch (err: unknown) {
    recordFinish(rec, 'failed', (err as Error).message);
  }
  return rec;
}

export function applyPlatformConfigUpdate(partial: Partial<PlatformConfig>): PlatformConfig {
  const next = savePlatformConfig(partial);
  restartPlatformScheduler();
  if (next.communityFeeds.enabled && getHarvestPool()) {
    restartCommunityFeedsWorker(getHarvestPool()!);
  }
  return next;
}

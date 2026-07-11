/**
 * Collection operations — connector health, provider dashboard, NOC metrics, workflow analytics.
 */

import type { Pool } from 'pg';
import { CONNECTOR_IDS } from '../../scripts/osint-harvest/collection/connectors.js';

export type ConnectorHealthState =
  | 'healthy'
  | 'warning'
  | 'degraded'
  | 'offline'
  | 'rate_limited'
  | 'authentication_failed'
  | 'disabled';

export interface ConnectorHealthRow {
  connector: string;
  label: string;
  status: ConnectorHealthState;
  success: number;
  fail: number;
  successRate?: number;
  avgDurationMs?: number;
  rateLimitHits: number;
  lastSuccess?: string;
  lastError?: string;
  lastRun?: string;
}

export interface ProviderDashboardRow extends ConnectorHealthRow {
  failures24h: number;
  runs24h: number;
  observations24h: number;
}

function deriveHealthStatus(row: {
  success: number;
  fail: number;
  lastError?: string;
  avgDurationMs?: number;
  rateLimitHits: number;
}): ConnectorHealthState {
  const total = row.success + row.fail;
  if (!total) return 'offline';
  const err = (row.lastError || '').toLowerCase();
  if (err.includes('auth') || err.includes('401') || err.includes('403')) return 'authentication_failed';
  if (row.rateLimitHits > 0 || err.includes('429') || err.includes('rate')) return 'rate_limited';
  if (row.fail > row.success) return 'degraded';
  if (row.avgDurationMs != null && row.avgDurationMs > 5000) return 'warning';
  if (row.fail > 0 && row.success / total < 0.7) return 'warning';
  return 'healthy';
}

async function aggregateConnectorEvents(
  pool: Pool,
  sinceHours: number,
): Promise<Map<string, ConnectorHealthRow & { durations: number[]; rateLimitHits: number }>> {
  const stats = new Map<string, ConnectorHealthRow & { durations: number[]; rateLimitHits: number }>();

  for (const id of CONNECTOR_IDS) {
    stats.set(id, {
      connector: id,
      label: id,
      status: 'offline',
      success: 0,
      fail: 0,
      rateLimitHits: 0,
      durations: [],
    });
  }

  const r = await pool.query(
    `SELECT event_type, payload, created_at
     FROM collection_events
     WHERE created_at >= NOW() - ($1::text || ' hours')::interval
       AND event_type IN (
         'collection.connector.completed',
         'collection.connector.failed'
       )
     ORDER BY created_at DESC
     LIMIT 5000`,
    [String(sinceHours)],
  );

  for (const row of r.rows) {
    const payload = (row.payload || {}) as Record<string, unknown>;
    const connector = String(payload.connector || '').trim();
    if (!connector) continue;
    if (!stats.has(connector)) {
      stats.set(connector, {
        connector,
        label: connector,
        status: 'offline',
        success: 0,
        fail: 0,
        rateLimitHits: 0,
        durations: [],
      });
    }
    const s = stats.get(connector)!;
    const errors = Array.isArray(payload.errors) ? payload.errors.join(' ') : '';
    if (row.event_type === 'collection.connector.completed') {
      s.success += 1;
      s.lastSuccess = row.created_at;
      s.lastRun = row.created_at;
      const ms = Number(payload.duration_ms);
      if (ms > 0) s.durations.push(ms);
    } else {
      s.fail += 1;
      s.lastError = errors || String(payload.error || 'failed');
      s.lastRun = row.created_at;
      if (s.lastError.toLowerCase().includes('429') || s.lastError.toLowerCase().includes('rate')) {
        s.rateLimitHits += 1;
      }
    }
  }

  return stats;
}

export async function getConnectorHealth(
  pool: Pool,
  opts: { sinceHours?: number } = {},
): Promise<{ connectors: ConnectorHealthRow[]; updatedAt: string }> {
  const sinceHours = opts.sinceHours ?? 24;
  const stats = await aggregateConnectorEvents(pool, sinceHours);

  const connectors = [...stats.values()].map((row) => {
    const total = row.success + row.fail;
    const avgDurationMs = row.durations.length
      ? Math.round(row.durations.reduce((a, b) => a + b, 0) / row.durations.length)
      : undefined;
    const successRate = total ? Math.round((row.success / total) * 1000) / 10 : undefined;
    const status = deriveHealthStatus({
      success: row.success,
      fail: row.fail,
      lastError: row.lastError,
      avgDurationMs,
      rateLimitHits: row.rateLimitHits,
    });
    return {
      connector: row.connector,
      label: row.label,
      status,
      success: row.success,
      fail: row.fail,
      successRate,
      avgDurationMs,
      rateLimitHits: row.rateLimitHits,
      lastSuccess: row.lastSuccess,
      lastError: row.lastError,
      lastRun: row.lastRun,
    };
  }).sort((a, b) => (b.success + b.fail) - (a.success + a.fail));

  return { connectors, updatedAt: new Date().toISOString() };
}

export async function getProviderDashboard(
  pool: Pool,
): Promise<{ providers: ProviderDashboardRow[]; updatedAt: string }> {
  const stats = await aggregateConnectorEvents(pool, 24);

  const obs = await pool.query(
    `SELECT payload, created_at FROM collection_events
     WHERE created_at >= NOW() - INTERVAL '24 hours'
       AND event_type = 'observation.persisted'`,
  );
  const obsByConnector = new Map<string, number>();
  for (const row of obs.rows) {
    const payload = (row.payload || {}) as Record<string, unknown>;
    const src = String(payload.source || 'unknown');
    obsByConnector.set(src, (obsByConnector.get(src) || 0) + 1);
  }

  const providers = [...stats.values()].map((row) => {
    const total = row.success + row.fail;
    const avgDurationMs = row.durations.length
      ? Math.round(row.durations.reduce((a, b) => a + b, 0) / row.durations.length)
      : undefined;
    const status = deriveHealthStatus({
      success: row.success,
      fail: row.fail,
      lastError: row.lastError,
      avgDurationMs,
      rateLimitHits: row.rateLimitHits,
    });
    return {
      connector: row.connector,
      label: row.label,
      status,
      success: row.success,
      fail: row.fail,
      successRate: total ? Math.round((row.success / total) * 1000) / 10 : undefined,
      avgDurationMs,
      rateLimitHits: row.rateLimitHits,
      lastSuccess: row.lastSuccess,
      lastError: row.lastError,
      lastRun: row.lastRun,
      failures24h: row.fail,
      runs24h: total,
      observations24h: obsByConnector.get(row.connector) || 0,
    };
  }).sort((a, b) => b.runs24h - a.runs24h);

  return { providers, updatedAt: new Date().toISOString() };
}

export async function getCollectionNocMetrics(pool: Pool): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);

  const [targets, events, findings, runs] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE enabled)::int AS enabled,
      COUNT(*) FILTER (WHERE next_collect_at IS NOT NULL AND next_collect_at <= NOW())::int AS due
      FROM collection_targets`),
    pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM collection_events WHERE created_at >= CURRENT_DATE
       GROUP BY event_type`,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today
       FROM osint_harvest_findings`,
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM osint_harvest_runs WHERE started_at >= CURRENT_DATE
       GROUP BY status`,
    ),
  ]);

  const eventCounts: Record<string, number> = {};
  for (const row of events.rows) eventCounts[row.event_type] = row.count;

  const runCounts: Record<string, number> = {};
  for (const row of runs.rows) runCounts[row.status] = row.count;

  const health = await getConnectorHealth(pool, { sinceHours: 24 });
  const degraded = health.connectors.filter((c) =>
    ['degraded', 'offline', 'rate_limited', 'authentication_failed'].includes(c.status),
  ).length;

  return {
    date: today,
    targets: targets.rows[0],
    findings: findings.rows[0],
    events: eventCounts,
    runs: runCounts,
    connectorHealth: {
      total: health.connectors.length,
      healthy: health.connectors.filter((c) => c.status === 'healthy').length,
      degraded,
    },
    providerErrors24h:
      (eventCounts['collection.connector.failed'] || 0) +
      (eventCounts['collection.failed'] || 0),
    observationsPersistedToday: eventCounts['observation.persisted'] || 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function getWorkflowAnalytics(
  pool: Pool,
  workflowTemplate: string,
  days = 30,
): Promise<Record<string, unknown>> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const runs = await pool.query(
    `SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE event_type IN ('collection.completed', 'collection.completed_with_warnings'))::int AS completed,
      COUNT(*) FILTER (WHERE event_type = 'collection.failed')::int AS failed
     FROM collection_events
     WHERE payload->>'workflow_template' = $1
       AND created_at >= $2
       AND event_type IN ('collection.completed', 'collection.completed_with_warnings', 'collection.failed')`,
    [workflowTemplate, since.toISOString()],
  );

  const obs = await pool.query(
    `SELECT COUNT(*)::int AS observations,
      COUNT(DISTINCT workflow_run_id)::int AS runs_with_obs
     FROM osint_harvest_findings
     WHERE workflow_template = $1 AND created_at >= $2`,
    [workflowTemplate, since.toISOString()],
  );

  const connectors = await pool.query(
    `SELECT connector_id AS connector, COUNT(*)::int AS observations
     FROM osint_harvest_findings
     WHERE workflow_template = $1 AND created_at >= $2 AND connector_id IS NOT NULL
     GROUP BY connector_id ORDER BY observations DESC`,
    [workflowTemplate, since.toISOString()],
  );

  const totalRuns = runs.rows[0]?.total || 0;
  const completed = runs.rows[0]?.completed || 0;
  const observations = obs.rows[0]?.observations || 0;

  return {
    workflow_template: workflowTemplate,
    period_days: days,
    totalRuns,
    completedRuns: completed,
    failedRuns: runs.rows[0]?.failed || 0,
    successRate: totalRuns ? Math.round((completed / totalRuns) * 1000) / 10 : undefined,
    totalObservations: observations,
    avgObservationsPerRun: totalRuns ? Math.round(observations / totalRuns) : undefined,
    connectorContribution: connectors.rows,
    updatedAt: new Date().toISOString(),
  };
}

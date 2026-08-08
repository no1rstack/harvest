import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { getHarvestPool } from '../db/harvestPostgres.js';

interface DeadSource {
  name: string;
  domain: string;
  category: string;
  source_type: string;
  access_method: string;
  feed_url: string;
  site_url: string;
  status: string;
  auth_required: boolean;
  registration: string;
}

interface RetiredTarget {
  id: string;
  target_type: string;
  value: string;
  product: string;
  workflow_template: string;
  priority: number;
  origin: string;
  last_collected_at: string | null;
  last_used_cascades_run_id: string | null;
  disabled_at: string | null;
  reason: string;
}

interface RetiredFeed {
  id: string;
  name: string;
  feed_url: string;
  category: string;
  discovered_via: string;
  last_ok_at: string | null;
  last_error: string | null;
  updated_at: string | null;
  reason: string;
}

interface RetiredPolicy {
  id: string;
  name: string;
  workflow_template: string;
  schedule_mode: string;
  schedule_value: string;
  description: string;
  reason: string;
}

interface RetiredArtifacts {
  summary: {
    deadCliTools: number;
    disabledTargets: number;
    disabledFeeds: number;
    disabledPolicies: number;
    deprecatedWorkflows: number;
    total: number;
  };
  deadCliTools: DeadSource[];
  disabledTargets: RetiredTarget[];
  disabledFeeds: RetiredFeed[];
  disabledPolicies: RetiredPolicy[];
  deprecatedWorkflows: Array<{ workflow: string; total: number; active: number; inactive: number }>;
}

export function registerRetiredRoutes(app: Express): void {
  app.get('/api/retired', async (_req, res) => {
    try {
      const pool = getHarvestPool();
      const dataFile = path.join(process.cwd(), 'data', 'dead-and-disabled-sources.json');
      let deadCliTools: DeadSource[] = [];
      if (fs.existsSync(dataFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
          deadCliTools = raw.sources || [];
        } catch { /* ignore */ }
      }

      // ── Disabled collection targets ──
      let disabledTargets: RetiredTarget[] = [];
      if (pool) {
        const { rows } = await pool.query(`
          SELECT
            id::text,
            target_type,
            value,
            product,
            workflow_template,
            priority,
            origin,
            last_collected_at,
            last_cascades_run_id AS last_used_cascades_run_id,
            updated_at AS disabled_at,
            CASE
              WHEN last_collected_at IS NULL THEN 'never collected'
              WHEN last_collected_at < NOW() - INTERVAL '30 days' THEN 'stale (>30 days)'
              ELSE 'manually disabled'
            END AS reason
          FROM collection_targets
          WHERE enabled = false
          ORDER BY updated_at DESC
        `);
        disabledTargets = rows;
      }

      // ── Disabled feed sources ──
      let disabledFeeds: RetiredFeed[] = [];
      if (pool) {
        const { rows } = await pool.query(`
          SELECT
            id::text,
            name,
            feed_url,
            category,
            discovered_via,
            last_ok_at,
            last_error,
            updated_at,
            CASE
              WHEN NOT enabled THEN 'manually disabled'
              WHEN NOT auto_pull THEN 'auto-pull turned off'
              WHEN last_error IS NOT NULL AND last_ok_at IS NULL THEN 'broken (never pulled successfully)'
              ELSE 'inactive'
            END AS reason
          FROM community_feed_sources
          WHERE enabled = false OR auto_pull = false
             OR (last_error IS NOT NULL AND last_ok_at IS NULL)
          ORDER BY updated_at DESC
        `);
        disabledFeeds = rows;
      }

      // ── Disabled policies ──
      let disabledPolicies: RetiredPolicy[] = [];
      if (pool) {
        const { rows } = await pool.query(`
          SELECT
            id,
            name,
            workflow_template,
            schedule_mode,
            schedule_value,
            description,
            'manually disabled' AS reason
          FROM collection_policies
          WHERE enabled = false
          ORDER BY updated_at DESC
        `);
        disabledPolicies = rows;
      }

      // ── Deprecated workflows ──
      let deprecatedWorkflows: Array<{ workflow: string; total: number; active: number; inactive: number }> = [];
      if (pool) {
        const { rows } = await pool.query(`
          WITH workflow_counts AS (
            SELECT
              workflow_template AS workflow,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE enabled = true) AS active,
              COUNT(*) FILTER (WHERE enabled = false) AS inactive
            FROM collection_targets
            GROUP BY workflow_template
          )
          SELECT workflow, total, active, inactive
          FROM workflow_counts
          WHERE inactive > 0 AND active = 0
          ORDER BY total DESC
        `);
        deprecatedWorkflows = rows;
      }

      const result: RetiredArtifacts = {
        summary: {
          deadCliTools: deadCliTools.length,
          disabledTargets: disabledTargets.length,
          disabledFeeds: disabledFeeds.length,
          disabledPolicies: disabledPolicies.length,
          deprecatedWorkflows: deprecatedWorkflows.length,
          total:
            deadCliTools.length +
            disabledTargets.length +
            disabledFeeds.length +
            disabledPolicies.length +
            deprecatedWorkflows.length,
        },
        deadCliTools,
        disabledTargets,
        disabledFeeds,
        disabledPolicies,
        deprecatedWorkflows,
      };

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Retire all broken feed sources (dead domains ≥4 failures, transient ≥12 failures)
  app.post('/api/retired/retire-broken-feeds', async (req, res) => {
    try {
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'no database pool' });

      const aggressive = req.body?.aggressive === true;

      // ── Dead-domain errors: retire at 2+ failures (was 4) ──
      const deadResult = await pool.query(`
        UPDATE community_feed_sources
        SET enabled = false, auto_pull = false, updated_at = NOW()
        WHERE enabled = true
          AND consecutive_failures >= ${aggressive ? 2 : 4}
          AND last_error IS NOT NULL
          AND last_ok_at IS NOT NULL
          AND (
            LOWER(last_error) LIKE '%enotfound%'
            OR LOWER(last_error) LIKE '%getaddrinfo%'
            OR LOWER(last_error) LIKE '%eai_again%'
            OR LOWER(last_error) LIKE '%econnrefused%'
            OR LOWER(last_error) LIKE '%econnreset%'
            OR LOWER(last_error) LIKE '%epipe%'
            OR LOWER(last_error) LIKE '%certificate%expired%'
            OR LOWER(last_error) LIKE '%unable to resolve%'
            OR LOWER(last_error) LIKE '%no address associated%'
          )
        RETURNING id, name, feed_url, last_error
      `);

      // ── Transient / generic "pull failed" errors: retire at 3+ failures ──
      const transientResult = await pool.query(`
        UPDATE community_feed_sources
        SET enabled = false, auto_pull = false, updated_at = NOW()
        WHERE enabled = true
          AND consecutive_failures >= ${aggressive ? 3 : 12}
          AND last_error IS NOT NULL
          AND last_ok_at IS NOT NULL
          AND NOT (
            LOWER(last_error) LIKE '%enotfound%'
            OR LOWER(last_error) LIKE '%getaddrinfo%'
            OR LOWER(last_error) LIKE '%eai_again%'
            OR LOWER(last_error) LIKE '%econnrefused%'
            OR LOWER(last_error) LIKE '%econnreset%'
            OR LOWER(last_error) LIKE '%epipe%'
            OR LOWER(last_error) LIKE '%certificate%expired%'
            OR LOWER(last_error) LIKE '%unable to resolve%'
            OR LOWER(last_error) LIKE '%no address associated%'
          )
        RETURNING id, name, feed_url, last_error
      `);

      // ── HTTP 4xx/5xx errors: retire at 1+ failure ──
      const httpResult = await pool.query(`
        UPDATE community_feed_sources
        SET enabled = false, auto_pull = false, updated_at = NOW()
        WHERE enabled = true
          AND last_error IS NOT NULL
          AND (
            LOWER(last_error) LIKE '%http 404%'
            OR LOWER(last_error) LIKE '%http 401%'
            OR LOWER(last_error) LIKE '%http 403%'
            OR LOWER(last_error) LIKE '%http 410%'
            OR LOWER(last_error) LIKE '%http 500%'
            OR LOWER(last_error) LIKE '%http 502%'
            OR LOWER(last_error) LIKE '%http 503%'
          )
        RETURNING id, name, feed_url, last_error
      `);

      // ── Also catch feeds with never-had-success but 3+ failures ──
      const neverOkResult = await pool.query(`
        UPDATE community_feed_sources
        SET enabled = false, auto_pull = false, updated_at = NOW()
        WHERE enabled = true
          AND consecutive_failures >= 3
          AND last_error IS NOT NULL
          AND last_ok_at IS NULL
        RETURNING id, name, feed_url, last_error
      `);

      const totalRetired =
        (deadResult.rowCount ?? 0) +
        (transientResult.rowCount ?? 0) +
        (httpResult.rowCount ?? 0) +
        (neverOkResult.rowCount ?? 0);

      const retired = [
        ...(deadResult.rows || []),
        ...(transientResult.rows || []),
        ...(httpResult.rows || []),
        ...(neverOkResult.rows || []),
      ];

      res.json({
        retired: totalRetired,
        deadDomains: deadResult.rowCount ?? 0,
        transient: transientResult.rowCount ?? 0,
        httpErrors: httpResult.rowCount ?? 0,
        neverOk: neverOkResult.rowCount ?? 0,
        retired_feeds: retired.slice(0, 50).map((r: any) => ({
          id: r.id,
          name: r.name,
          url: r.feed_url,
          error: String(r.last_error || '').slice(0, 100),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

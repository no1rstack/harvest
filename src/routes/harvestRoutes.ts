/**
 * Ungated Harvest Admin API — status, targets, trigger single/daily pulls.
 * Mounted at /api/harvest/* — reads/writes the shared harvest Postgres store.
 */

import type { Express } from 'express';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { harvestQuery, getHarvestPool, isHarvestPgEnabled } from '../db/harvestPostgres.js';

interface HarvestRouteDeps {
  /** Optional fallbacks — preferred path is shared harvest pool */
  isPgEnabled?: () => boolean;
  pgQuery?: (text: string, params?: any[]) => Promise<any[]>;
}

const ROOT = process.cwd();
const TARGETS_FILE = path.join(ROOT, 'scripts/osint-harvest/targets.txt');
const LOG_DIR = path.join(ROOT, 'logs/osint-harvest');

let activeJob: {
  proc: ChildProcess;
  kind: string;
  startedAt: string;
  logFile: string;
} | null = null;
let lastJob: { kind: string; startedAt: string; finishedAt: string; exitCode: number | null; logFile: string } | null = null;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function storeEnabled(): boolean {
  return isHarvestPgEnabled();
}

async function q(text: string, params?: any[]): Promise<any[]> {
  return harvestQuery(text, params);
}

async function buildStatus(_deps: HarvestRouteDeps) {
  if (!storeEnabled()) {
    return {
      enabled: false,
      store: 'harvest',
      summary: { runs: 0, findings: 0, inserted: 0, running: 0, failed: 0, last_run_at: null },
      runs: [],
      bySource: [],
      byEntityType: [],
      recentFindings: [],
      daily: null,
      job: jobPayload(),
    };
  }

  const [summaryRows, runs, bySource, byEntityType, recentFindings] = await Promise.all([
    q(`
      SELECT
        (SELECT COUNT(*)::int FROM osint_harvest_runs) AS runs,
        (SELECT COUNT(*)::int FROM osint_harvest_findings) AS findings,
        (SELECT COALESCE(SUM(inserted),0)::int FROM osint_harvest_runs) AS inserted,
        (SELECT COUNT(*)::int FROM osint_harvest_runs WHERE status = 'running') AS running,
        (SELECT COUNT(*)::int FROM osint_harvest_runs WHERE status = 'failed') AS failed,
        (SELECT MAX(started_at) FROM osint_harvest_runs) AS last_run_at
    `).catch(() => [{ runs: 0, findings: 0, inserted: 0, running: 0, failed: 0, last_run_at: null }]),
    q(`
      SELECT id, target, case_id, product, status, total_findings, inserted, skipped,
             harvesters, errors, started_at, finished_at
      FROM osint_harvest_runs
      ORDER BY started_at DESC
      LIMIT 40
    `).catch(() => []),
    q(`
      SELECT source, COUNT(*)::int AS count
      FROM osint_harvest_findings
      GROUP BY source ORDER BY count DESC LIMIT 20
    `).catch(() => []),
    q(`
      SELECT entity_type, COUNT(*)::int AS count
      FROM osint_harvest_findings
      GROUP BY entity_type ORDER BY count DESC LIMIT 20
    `).catch(() => []),
    q(`
      SELECT id, source, entity_type, value, title, severity, confidence, product, observed_at, created_at
      FROM osint_harvest_findings
      ORDER BY created_at DESC LIMIT 30
    `).catch(() => []),
  ]);

  let daily: Record<string, unknown> | null = null;
  try {
    const summaryPath = path.join(LOG_DIR, 'latest-summary.json');
    if (fs.existsSync(summaryPath)) {
      daily = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    }
  } catch { /* optional */ }

  return {
    enabled: true,
    store: 'harvest',
    summary: summaryRows?.[0] || { runs: 0, findings: 0, inserted: 0, running: 0, failed: 0, last_run_at: null },
    runs,
    bySource,
    byEntityType,
    recentFindings,
    daily,
    job: jobPayload(),
  };
}

function jobPayload() {
  return {
    running: Boolean(activeJob),
    startedAt: activeJob?.startedAt || lastJob?.startedAt,
    kind: activeJob?.kind || lastJob?.kind,
    lastExit: lastJob?.exitCode ?? null,
    lastLog: activeJob?.logFile || lastJob?.logFile,
  };
}

function startJob(kind: string, args: string[]): { ok: true; logFile: string } | { ok: false; error: string } {
  if (activeJob) {
    return { ok: false, error: `Job already running (${activeJob.kind}) since ${activeJob.startedAt}` };
  }
  ensureLogDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOG_DIR, `job-${kind}-${stamp}.log`);
  const out = fs.openSync(logFile, 'a');
  const proc = spawn('npm', args, {
    cwd: ROOT,
    env: process.env,
    detached: false,
    stdio: ['ignore', out, out],
  });
  activeJob = { proc, kind, startedAt: new Date().toISOString(), logFile };
  proc.on('exit', (code) => {
    lastJob = {
      kind,
      startedAt: activeJob?.startedAt || new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: code,
      logFile,
    };
    activeJob = null;
    try { fs.closeSync(out); } catch { /* ignore */ }
  });
  return { ok: true, logFile };
}

export function registerHarvestRoutes(app: Express, deps: HarvestRouteDeps = {}): void {
  app.get('/api/harvest/status', async (_req, res) => {
    try {
      res.json(await buildStatus(deps));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/osint-harvest', async (_req, res) => {
    try {
      res.json(await buildStatus(deps));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/harvest/runs/:id', async (req, res) => {
    try {
      if (!storeEnabled()) return res.status(503).json({ error: 'Harvest Postgres not enabled' });
      const runs = await q(`SELECT * FROM osint_harvest_runs WHERE id = $1`, [req.params.id]);
      if (!runs.length) return res.status(404).json({ error: 'Run not found' });
      const findings = await q(
        `SELECT id, source, entity_type, value, title, severity, confidence, tags, product, observed_at, created_at
         FROM osint_harvest_findings WHERE run_id = $1
         ORDER BY created_at DESC LIMIT 200`,
        [req.params.id],
      );
      res.json({ run: runs[0], findings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/osint-harvest/runs/:id', async (req, res) => {
    try {
      if (!storeEnabled()) return res.status(503).json({ error: 'Harvest Postgres not enabled' });
      const runs = await q(`SELECT * FROM osint_harvest_runs WHERE id = $1`, [req.params.id]);
      if (!runs.length) return res.status(404).json({ error: 'Run not found' });
      const findings = await q(
        `SELECT id, source, entity_type, value, title, severity, confidence, tags, product, observed_at, created_at
         FROM osint_harvest_findings WHERE run_id = $1
         ORDER BY created_at DESC LIMIT 200`,
        [req.params.id],
      );
      res.json({ run: runs[0], findings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/harvest/findings', async (req, res) => {
    try {
      if (!storeEnabled()) return res.status(503).json({ error: 'Harvest Postgres not enabled' });
      const qText = String(req.query.q || '').trim();
      const source = String(req.query.source || '').trim();
      const entityType = String(req.query.entityType || req.query.entity_type || '').trim();
      const product = String(req.query.product || '').trim();
      const workflowRunId = String(req.query.workflowRunId || req.query.workflow_run_id || '').trim();
      const nodeId = String(req.query.nodeId || req.query.node_id || '').trim();
      const connectorId = String(req.query.connector || req.query.connector_id || '').trim();
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);

      const where: string[] = [];
      const params: unknown[] = [];
      const add = (clause: string, value: unknown) => {
        params.push(value);
        where.push(clause.replace('?', `$${params.length}`));
      };
      if (qText) {
        params.push(`%${qText}%`);
        const i = params.length;
        where.push(`(value ILIKE $${i} OR title ILIKE $${i} OR label ILIKE $${i} OR description ILIKE $${i})`);
      }
      if (source) add('source = ?', source);
      if (entityType) add('entity_type = ?', entityType);
      if (product) add('product = ?', product);
      if (workflowRunId) add('workflow_run_id = ?', workflowRunId);
      if (nodeId) add('node_id = ?', nodeId);
      if (connectorId) add('connector_id = ?', connectorId);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const countRows = await q(
        `SELECT COUNT(*)::int AS total FROM osint_harvest_findings ${whereSql}`,
        params,
      );
      const total = countRows[0]?.total ?? 0;

      const listParams = [...params, limit, offset];
      const findings = await q(
        `SELECT id, run_id, case_id, product, source, source_id, entity_type, value, label, title,
                description, severity, confidence, tags, observed_at, created_at,
                workflow_template, workflow_version, workflow_run_id, node_id, connector_id, target_id
         FROM osint_harvest_findings
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      res.json({
        total,
        limit,
        offset,
        findings,
        filters: {
          q: qText || null,
          source: source || null,
          entityType: entityType || null,
          product: product || null,
          connector: connectorId || null,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/harvest/findings/:id', async (req, res) => {
    try {
      if (!storeEnabled()) return res.status(503).json({ error: 'Harvest Postgres not enabled' });
      const rows = await q(
        `SELECT f.*, r.target AS run_target, r.status AS run_status, r.started_at AS run_started_at
         FROM osint_harvest_findings f
         LEFT JOIN osint_harvest_runs r ON r.id = f.run_id
         WHERE f.id = $1`,
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ error: 'Finding not found' });
      res.json({ finding: rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/harvest/targets', (_req, res) => {
    try {
      const content = fs.existsSync(TARGETS_FILE)
        ? fs.readFileSync(TARGETS_FILE, 'utf8')
        : '# domain [case_id]\n# product domain [case_id]\n';
      res.json({ path: TARGETS_FILE, content });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/harvest/targets', (req, res) => {
    try {
      const content = String(req.body?.content ?? '');
      if (content.length > 200_000) {
        return res.status(400).json({ error: 'targets file too large' });
      }
      fs.mkdirSync(path.dirname(TARGETS_FILE), { recursive: true });
      fs.writeFileSync(TARGETS_FILE, content.endsWith('\n') ? content : content + '\n', { mode: 0o644 });
      res.json({ ok: true, path: TARGETS_FILE, bytes: Buffer.byteLength(content) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/harvest/config/public', (_req, res) => {
    res.json({
      cascadesUrl: process.env.CASCADES_PUBLIC_URL?.replace(/\/$/, '') ?? null,
    });
  });

  app.post('/api/harvest/run', async (req, res) => {
    try {
      if (!storeEnabled()) return res.status(503).json({ error: 'Harvest Postgres not enabled' });
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'Harvest pool unavailable' });

      const target = String(req.body?.target || '').trim();
      const product = String(req.body?.product || req.body?.tag || 'shared').toLowerCase();
      const caseId = req.body?.caseId != null && req.body?.caseId !== '' ? Number(req.body.caseId) : undefined;
      if (!target) return res.status(400).json({ error: 'target required' });

      const { upsertTarget, inferTargetType, getTargetByValue, ensureCollectionSchema } = await import(
        '../collection/targetRegistry.js'
      );
      const { submitTargetIdToCascades } = await import('../collection/submitDue.js');
      await ensureCollectionSchema(pool);

      let regTarget = await getTargetByValue(pool, inferTargetType(target), target, product);
      if (!regTarget) {
        regTarget = await upsertTarget(pool, {
          target_type: inferTargetType(target),
          value: target,
          product,
          case_id: Number.isFinite(caseId) ? caseId : undefined,
          origin: 'api',
        });
      }

      const result = await submitTargetIdToCascades(pool, regTarget.id, {
        wait: Boolean(req.body?.wait),
      });
      res.status(result?.error ? 500 : 202).json({
        ok: !result?.error,
        engine: 'cascades',
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/harvest/run/legacy', (req, res) => {
    const tag = String(req.body?.product || req.body?.tag || 'shared').toLowerCase();
    const target = String(req.body?.target || '').trim();
    const harvesters = String(req.body?.harvesters || 'crtsh,dns,rdap,hackertarget,urlhaus,rss');
    const caseId = req.body?.caseId != null && req.body?.caseId !== ''
      ? String(req.body.caseId)
      : '';
    if (!target) return res.status(400).json({ error: 'target required' });

    const args = [
      'run', 'osint:harvest', '--',
      '--product', 'harvest',
      '--tag', tag,
      '--target', target,
      '--harvesters', harvesters,
      '--max', String(req.body?.max || 100),
      '--timeout', String(req.body?.timeout || 20000),
    ];
    if (caseId) args.push('--case', caseId);

    const started = startJob('single', args);
    if (!started.ok) return res.status(409).json({ error: started.error });
    res.status(202).json({ ok: true, kind: 'single', logFile: started.logFile, args });
  });

  app.post('/api/harvest/daily', (req, res) => {
    const dryRun = Boolean(req.body?.dryRun);
    const args = dryRun
      ? ['run', 'osint:daily:dry']
      : ['run', 'osint:daily'];
    const started = startJob(dryRun ? 'daily-dry' : 'daily', args);
    if (!started.ok) return res.status(409).json({ error: started.error });
    res.status(202).json({ ok: true, kind: dryRun ? 'daily-dry' : 'daily', logFile: started.logFile });
  });

  app.get('/api/harvest/job', (_req, res) => {
    res.json(jobPayload());
  });
}

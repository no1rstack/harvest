/**
 * Collection Platform API — Target Registry + step handlers for Cascades nodes.
 * Orchestration is Cascades-only; this module does not run full pipelines.
 */

import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getHarvestPool, isHarvestPgEnabled } from '../db/harvestPostgres.js';
import {
  listTargets,
  getTarget,
  upsertTarget,
  deleteTarget,
  listDueTargets,
  seedTargetsFromFile,
} from '../collection/targetRegistry.js';
import { listWorkflowTemplates } from '../collection/templates.js';
import { listCollectionProfiles } from '../collection/profiles.js';
import { listCollectionPolicies } from '../collection/policies.js';
import { COLLECTION_ASSET_TYPES, ASSET_TYPE_LABELS } from '../collection/asset-types.js';
import {
  getConnectorHealth,
  getProviderDashboard,
  getCollectionNocMetrics,
  getWorkflowAnalytics,
} from '../collection/operations.js';
import { getCollectionStrategy, listCollectionStrategies } from '../collection/strategies.js';
import { COLLECTION_CAPABILITIES, CAPABILITY_LABELS } from '../collection/capabilities.js';
import { listCatalogWorkflows } from '../collection/workflow-catalog.js';
import { TARGET_DEPENDENCY_RULES } from '../collection/dependencies.js';
import { listObservationEvents } from '../collection/observation-events.js';
import { PLATFORM_MATURITY_LEVELS, COLLECTION_PLATFORM_NAME } from '../collection/platform.js';
import { validateTargetInput } from '../collection/validation.js';
import { listRelationships } from '../collection/relationships.js';
import { getCollectionConfig, setCollectionConfig } from '../collection/collectionConfig.js';
import {
  normalizeProviderData,
  validateObservations,
  deduplicateObservations,
  type ProviderFinding,
} from '../collection/stixNormalize.js';
import { listCollectionEvents, publishCollectionEvent } from '../collection/events.js';
import { parseExecutionContext } from '../collection/executionContext.js';
import { incCounter } from '../api/metrics.js';
import {
  submitDueTargetsToCascades,
  submitTargetIdToCascades,
} from '../collection/submitDue.js';
import {
  bootstrapCollectionPlatform,
  bridgeFindingsToH3xa,
  bridgeWorkflowRunToH3xa,
} from '../collection/intelligence-bridge.js';
import type { CollectionTargetInput } from '../collection/types.js';

const TARGETS_FILE = path.join(process.cwd(), 'scripts/osint-harvest/targets.txt');

function poolOr503(res: Response) {
  const pool = getHarvestPool();
  if (!pool || !isHarvestPgEnabled()) {
    res.status(503).json({ error: 'Harvest Postgres not enabled' });
    return null;
  }
  return pool;
}

function internalTokenOk(req: Request): boolean {
  const expected = process.env.COLLECTION_INTERNAL_TOKEN || '';
  const got = String(req.headers['x-collection-token'] || '');
  return Boolean(expected && got === expected);
}

function requireInternal(req: Request, res: Response): boolean {
  if (internalTokenOk(req)) return true;
  res.status(401).json({ error: 'invalid collection token' });
  return false;
}

function collectionBodyLimit(req: Request, res: Response): boolean {
  const limit = getCollectionConfig().max_step_body_bytes;
  const len = parseInt(String(req.headers['content-length'] || '0'), 10);
  if (len > limit) {
    res.status(413).json({ error: `payload exceeds max_step_body_bytes (${limit})` });
    return false;
  }
  return true;
}

export function registerCollectionRoutes(app: Express): void {
  app.get('/api/collection/config', (_req, res) => {
    res.json(getCollectionConfig());
  });

  app.patch('/api/collection/config', (req, res) => {
    if (!requireInternal(req, res)) return;
    res.json(setCollectionConfig(req.body || {}));
  });

  app.get('/api/collection/templates', (_req, res) => {
    res.json({ templates: listCatalogWorkflows(), catalog: true });
  });

  app.get('/api/collection/catalog', (_req, res) => {
    res.json({
      platform: COLLECTION_PLATFORM_NAME,
      maturity_levels: PLATFORM_MATURITY_LEVELS,
      workflows: listCatalogWorkflows(),
    });
  });

  app.get('/api/collection/capabilities', (_req, res) => {
    res.json({
      capabilities: COLLECTION_CAPABILITIES.map((id) => ({
        id,
        label: CAPABILITY_LABELS[id],
      })),
    });
  });

  app.get('/api/collection/strategies', (_req, res) => {
    res.json({ strategies: listCollectionStrategies() });
  });

  app.get('/api/collection/strategies/:id', (req, res) => {
    const strategy = getCollectionStrategy(req.params.id);
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    res.json({ strategy });
  });

  app.get('/api/collection/dependencies', (_req, res) => {
    res.json({ rules: TARGET_DEPENDENCY_RULES });
  });

  app.get('/api/collection/observations/events', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const events = await listObservationEvents(pool, {
        observation_id: String(req.query.observation_id || '').trim() || undefined,
        workflow_run_id: String(req.query.workflow_run_id || '').trim() || undefined,
        event_type: String(req.query.event_type || '').trim() || undefined,
        limit: parseInt(String(req.query.limit || '100'), 10) || 100,
      });
      res.json({ events, count: events.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/graph', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const relationships = await listRelationships(pool, {
        source_value: String(req.query.source || '').trim() || undefined,
        target_value: String(req.query.target || '').trim() || undefined,
        workflow_run_id: String(req.query.workflow_run_id || '').trim() || undefined,
        limit: parseInt(String(req.query.limit || '200'), 10) || 200,
      });
      res.json({ graph: relationships, count: relationships.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/profiles', (_req, res) => {
    res.json({ profiles: listCollectionProfiles() });
  });

  app.get('/api/collection/policies', (_req, res) => {
    res.json({ policies: listCollectionPolicies() });
  });

  app.get('/api/collection/asset-types', (_req, res) => {
    res.json({
      asset_types: COLLECTION_ASSET_TYPES.map((id) => ({
        id,
        label: ASSET_TYPE_LABELS[id],
      })),
    });
  });

  app.get('/api/collection/connectors/health', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const sinceHours = parseInt(String(req.query.sinceHours || '24'), 10) || 24;
      res.json(await getConnectorHealth(pool, { sinceHours }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/providers', async (_req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      res.json(await getProviderDashboard(pool));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/ops/metrics', async (_req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      res.json(await getCollectionNocMetrics(pool));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/bootstrap', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const result = await bootstrapCollectionPlatform(pool, {
        sync_h3xa: req.body?.sync_h3xa !== false,
        run_due: Boolean(req.body?.run_due),
        dry_run: Boolean(req.body?.dryRun || req.body?.dry_run),
        force: Boolean(req.body?.force),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/intelligence/sync', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const workflowRunId = String(req.body?.workflow_run_id || req.body?.workflowRunId || '').trim();
      const targetId = String(req.body?.target_id || req.body?.targetId || '').trim();
      const limit = parseInt(String(req.body?.limit || '1000'), 10) || 1000;

      const result = workflowRunId
        ? await bridgeWorkflowRunToH3xa(pool, workflowRunId)
        : await bridgeFindingsToH3xa(pool, {
            target_id: targetId || undefined,
            limit,
            backfill_graph: req.body?.backfill_graph !== false,
          });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/workflows/:template/analytics', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const days = parseInt(String(req.query.days || '30'), 10) || 30;
      res.json(await getWorkflowAnalytics(pool, req.params.template, days));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/relationships', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const relationships = await listRelationships(pool, {
        source_value: String(req.query.source || '').trim() || undefined,
        target_value: String(req.query.target || '').trim() || undefined,
        workflow_run_id: String(req.query.workflow_run_id || '').trim() || undefined,
        limit: parseInt(String(req.query.limit || '100'), 10) || 100,
      });
      res.json({ relationships, count: relationships.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/targets', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const enabled =
        req.query.enabled === 'true' ? true : req.query.enabled === 'false' ? false : undefined;
      const product = String(req.query.product || '').trim() || undefined;
      const targetType = String(req.query.target_type || '').trim() || undefined;
      const collectionPolicy = String(req.query.collection_policy || '').trim() || undefined;
      const collectionProfile = String(req.query.collection_profile || '').trim() || undefined;
      const limit = parseInt(String(req.query.limit || '200'), 10) || 200;
      const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
      res.json(
        await listTargets(pool, {
          enabled,
          product,
          target_type: targetType,
          collection_policy: collectionPolicy,
          collection_profile: collectionProfile,
          limit,
          offset,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/targets/due', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const workflow = String(req.query.workflow || '').trim() || undefined;
      const targets = await listDueTargets(pool, { workflow_template: workflow });
      res.json({ count: targets.length, targets });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/targets/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const target = await getTarget(pool, req.params.id);
      if (!target) return res.status(404).json({ error: 'Target not found' });
      res.json({ target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/targets', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const body = req.body as CollectionTargetInput;
      const validation = validateTargetInput(body);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const target = await upsertTarget(pool, { ...body, origin: body.origin || 'api' });
      res.status(201).json({ target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/collection/targets/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const existing = await getTarget(pool, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Target not found' });
      const target = await upsertTarget(pool, {
        target_type: req.body.target_type || existing.target_type,
        value: req.body.value || existing.value,
        product: req.body.product ?? existing.product,
        case_id: req.body.case_id ?? existing.case_id,
        workflow_template: req.body.workflow_template ?? existing.workflow_template,
        collection_profile: req.body.collection_profile ?? existing.collection_profile,
        collection_policy: req.body.collection_policy ?? existing.collection_policy,
        collection_strategy: req.body.collection_strategy ?? existing.collection_strategy,
        priority: req.body.priority ?? existing.priority,
        frequency: req.body.frequency ?? existing.frequency,
        enabled: req.body.enabled ?? existing.enabled,
        origin: existing.origin,
        owner: req.body.owner ?? existing.owner,
        classification: req.body.classification ?? existing.classification,
        sensitivity: req.body.sensitivity ?? existing.sensitivity,
        tags: req.body.tags ?? existing.tags,
        confidence: req.body.confidence ?? existing.confidence,
        source: req.body.source ?? existing.intel_source,
        metadata: req.body.metadata ?? existing.metadata,
        expires_at: req.body.expires_at ?? existing.expires_at,
      });
      res.json({ target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/collection/targets/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const ok = await deleteTarget(pool, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Target not found' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/targets/seed', async (_req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const content = fs.existsSync(TARGETS_FILE) ? fs.readFileSync(TARGETS_FILE, 'utf8') : '';
      const result = await seedTargetsFromFile(pool, content);
      res.json({ ok: true, ...result, path: TARGETS_FILE });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Enqueue one Cascades workflow run (does not execute connectors in-process). */
  app.post('/api/collection/run', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const targetId = String(req.body?.targetId || req.body?.target_id || '').trim();
      const dryRun = Boolean(req.body?.dryRun);
      const wait = Boolean(req.body?.wait);

      if (targetId) {
        const result = await submitTargetIdToCascades(pool, targetId, { dryRun, wait });
        if (!result) return res.status(404).json({ error: 'Target not found' });
        return res.status(result.error ? 500 : 202).json(result);
      }

      const targetValue = String(req.body?.target || '').trim();
      if (targetValue) {
        const created = await upsertTarget(pool, {
          target_type: req.body.target_type,
          value: targetValue,
          product: req.body.product || 'shared',
          workflow_template: req.body.workflow_template,
          collection_profile: req.body.collection_profile,
          collection_policy: req.body.collection_policy,
          collection_strategy: req.body.collection_strategy,
          owner: req.body.owner,
          classification: req.body.classification,
          sensitivity: req.body.sensitivity,
          tags: req.body.tags,
          confidence: req.body.confidence,
          source: req.body.source,
          origin: 'api',
        });
        const result = await submitTargetIdToCascades(pool, created.id, { dryRun, wait });
        return res.status(result?.error ? 500 : 202).json(result);
      }

      return res.status(400).json({ error: 'targetId or target required' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Enqueue passive-domain-collection for each due target via Cascades. */
  app.post('/api/collection/run/due', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const result = await submitDueTargetsToCascades(pool, {
        dryRun: Boolean(req.body?.dryRun),
        wait: Boolean(req.body?.wait),
        force: Boolean(req.body?.force),
        limit: parseInt(String(req.body?.limit || '100'), 10) || 100,
        seedFromTargetsFile: TARGETS_FILE,
        actor: req.body?.actor || 'harvest-scheduler',
      });
      res.status(202).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/collection/events', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const events = await listCollectionEvents(pool, {
        target_id: String(req.query.target_id || '').trim() || undefined,
        run_id: String(req.query.run_id || req.query.cascades_run_id || '').trim() || undefined,
        limit: parseInt(String(req.query.limit || '50'), 10) || 50,
      });
      res.json({ events, count: events.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Cascades semantic step APIs (Harvest data plane only) ──

  app.post('/api/collection/steps/collect-connector', async (req, res) => {
    if (!requireInternal(req, res)) return;
    if (!collectionBodyLimit(req, res)) return;
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { runSingleConnector } = await import('../../scripts/osint-harvest/collection/connectors.js');
      const targetId = String(req.body?.targetId || '').trim();
      const connector = String(req.body?.connector || '').trim();
      const execution = parseExecutionContext(req.body);
      if (!targetId || !connector) {
        return res.status(400).json({ error: 'targetId and connector required' });
      }
      const target = await getTarget(pool, targetId);
      if (!target) return res.status(404).json({ error: 'Target not found' });

      const result = await runSingleConnector(target, connector, {
        maxResults: parseInt(String(req.body?.maxResults || '100'), 10) || 100,
        timeoutMs: parseInt(String(req.body?.timeoutMs || '20000'), 10) || 20000,
      });

      await publishCollectionEvent(pool, {
        event_type:
          result.status === 'failed'
            ? 'collection.connector.failed'
            : 'collection.connector.completed',
        target_id: targetId,
        run_id: execution?.workflow_run_id,
        cascades_run_id: execution?.workflow_run_id,
        request_id: execution?.request_id,
        payload: {
          connector,
          connector_version: result.connector_version,
          findings_count: result.findings.length,
          errors: result.errors,
          duration_ms: result.duration_ms,
          node_id: execution?.node_id,
        },
      });

      incCounter('collection_connector_total', {
        connector,
        status: result.status === 'failed' ? 'failed' : 'completed',
      });

      res.json({ ...result, request_id: execution?.request_id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/steps/normalize', (req, res) => {
    if (!requireInternal(req, res)) return;
    try {
      const findings = (req.body?.findings || []) as ProviderFinding[];
      const execution = parseExecutionContext(req.body);
      const runId = String(req.body?.runId || execution?.workflow_run_id || `step-${Date.now()}`);
      const targetId = String(req.body?.targetId || execution?.target_id || 'unknown');
      const observations = normalizeProviderData(findings, {
        runId,
        targetId,
        targetValue: req.body?.targetValue || '',
        execution,
      });
      res.json({ observations, count: observations.length, request_id: execution?.request_id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/steps/validate', (req, res) => {
    if (!requireInternal(req, res)) return;
    try {
      res.json(validateObservations(req.body?.observations || []));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/steps/deduplicate', (req, res) => {
    if (!requireInternal(req, res)) return;
    try {
      res.json(deduplicateObservations(req.body?.observations || []));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/steps/persist', async (req, res) => {
    if (!requireInternal(req, res)) return;
    if (!collectionBodyLimit(req, res)) return;
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { persistObservationsStep } = await import('../../scripts/osint-harvest/collection/steps.js');
      const execution = parseExecutionContext(req.body);
      const targetId = String(req.body?.targetId || '').trim();
      const runId = String(req.body?.runId || execution?.workflow_run_id || `col-${Date.now()}`);
      if (!targetId) return res.status(400).json({ error: 'targetId required' });
      const target = await getTarget(pool, targetId);
      if (!target) return res.status(404).json({ error: 'Target not found' });

      const result = await persistObservationsStep(pool, {
        runId,
        target,
        observations: req.body?.observations || [],
        execution,
        harvesters: req.body?.harvesters || [],
        dryRun: Boolean(req.body?.dryRun),
        stream: req.body?.stream,
      });
      res.json({ ...result, request_id: execution?.request_id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/collection/steps/finalize', async (req, res) => {
    if (!requireInternal(req, res)) return;
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { finalizeCollectionStep } = await import('../../scripts/osint-harvest/collection/steps.js');
      const targetId = String(req.body?.targetId || '').trim();
      const workflowRunId = String(req.body?.workflowRunId || req.body?.runId || '').trim();
      if (!targetId || !workflowRunId) {
        return res.status(400).json({ error: 'targetId and workflowRunId required' });
      }
      const result = await finalizeCollectionStep(pool, {
        targetId,
        workflowRunId,
        persist: req.body?.persist || {},
        merge: req.body?.merge || {},
        dryRun: Boolean(req.body?.dryRun),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

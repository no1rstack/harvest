/**
 * Harvest-side scheduler — workflow-catalog and strategy aware.
 * Does NOT execute connectors; Cascades is the sole orchestration engine.
 */

import type { Pool } from 'pg';
import { submitCascadesWorkflow, waitForCascadesRun, type CascadesRunDetail } from './cascadesClient.js';
import { publishCollectionEvent } from './events.js';
import { resolveProfileCollectors, profileCapabilities } from './profiles.js';
import {
  resolveTargetStrategy,
  strategyExecutionContext,
} from './strategies.js';
import { cascadesWorkflowId, normalizeWorkflowId } from './workflow-catalog.js';
import { ensureCollectionSchema, getTarget, listDueTargets, seedTargetsFromFile } from './targetRegistry.js';
import type { CollectionTarget } from './types.js';

export interface CascadesSubmissionResult {
  target_id: string;
  target_value: string;
  workflow_template: string;
  cascades_run_id: string;
  cascades_status: string;
  dry_run: boolean;
  error?: string;
  run_detail?: CascadesRunDetail;
}

export async function submitTargetToCascades(
  pool: Pool,
  target: CollectionTarget,
  opts: { dryRun?: boolean; wait?: boolean; actor?: string; force?: boolean } = {},
): Promise<CascadesSubmissionResult> {
  const strategy = resolveTargetStrategy(target);
  const exec = strategyExecutionContext(strategy);
  const workflowTemplate = normalizeWorkflowId(target.workflow_template || exec.workflow_template);
  const cascadesId = cascadesWorkflowId(workflowTemplate);
  const profileCollectors = resolveProfileCollectors(workflowTemplate, exec.profile);
  const metaCollectors = Array.isArray(target.metadata?.collectors)
    ? (target.metadata.collectors as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim())
    : [];
  const collectors = metaCollectors.length > 0 ? metaCollectors : profileCollectors;

  const seedTarget =
    (typeof target.metadata?.seed_target === 'string' && target.metadata.seed_target.trim()) ||
    target.value;
  const dayKey = new Date().toISOString().slice(0, 10);
  const idempotencyKey = opts.force
    ? `collect-${target.id}-${Date.now()}`
    : `collect-${target.id}-${dayKey}`;

  await publishCollectionEvent(pool, {
    event_type: 'collection.requested',
    target_id: target.id,
    payload: {
      target_value: seedTarget,
      registry_value: target.value,
      workflow_template: workflowTemplate,
      collection_strategy: strategy.id,
      collection_profile: exec.profile,
      collection_policy: exec.policy,
      capabilities: exec.capabilities,
      collectors,
      exhaust_source: Boolean(target.metadata?.exhaust_source),
      dry_run: Boolean(opts.dryRun),
    },
  });

  try {
    const submission = await submitCascadesWorkflow(
      cascadesId,
      {
        targetId: target.id,
        target_id: target.id,
        target: seedTarget,
        domain: seedTarget,
        product: target.product,
        workflow_template: workflowTemplate,
        collection_strategy: strategy.id,
        collection_profile: exec.profile,
        collection_policy: exec.policy,
        capabilities: exec.capabilities,
        collectors,
        exhaust_source: Boolean(target.metadata?.exhaust_source),
        provenance_source: target.metadata?.provenance_source,
      },
      {
        idempotencyKey,
        actor: opts.actor || 'collection-scheduler',
        dryRun: opts.dryRun,
      },
    );

    await pool.query(
      `UPDATE collection_targets SET last_cascades_run_id = $2, updated_at = NOW() WHERE id = $1`,
      [target.id, submission.runId],
    );

    await publishCollectionEvent(pool, {
      event_type: 'collection.started',
      target_id: target.id,
      run_id: submission.runId,
      cascades_run_id: submission.runId,
      payload: {
        cascades_status: submission.status,
        workflow_template: workflowTemplate,
        collection_strategy: strategy.id,
      },
    });

    let runDetail: CascadesRunDetail | undefined;
    if (opts.wait && !opts.dryRun) {
      runDetail = await waitForCascadesRun(submission.runId);
    }

    return {
      target_id: target.id,
      target_value: target.value,
      workflow_template: workflowTemplate,
      cascades_run_id: submission.runId,
      cascades_status: runDetail?.status || submission.status,
      dry_run: Boolean(opts.dryRun),
      run_detail: runDetail,
    };
  } catch (err) {
    const message = (err as Error).message;
    await publishCollectionEvent(pool, {
      event_type: 'collection.failed',
      target_id: target.id,
      payload: { error: message, stage: 'enqueue' },
    });
    return {
      target_id: target.id,
      target_value: target.value,
      workflow_template: workflowTemplate,
      cascades_run_id: '',
      cascades_status: 'failed',
      dry_run: Boolean(opts.dryRun),
      error: message,
    };
  }
}

export async function submitDueTargetsToCascades(
  pool: Pool,
  opts: {
    dryRun?: boolean;
    wait?: boolean;
    limit?: number;
    seedFromTargetsFile?: string;
    actor?: string;
    force?: boolean;
  } = {},
): Promise<{ submissions: CascadesSubmissionResult[]; failed: number }> {
  await ensureCollectionSchema(pool);

  if (opts.seedFromTargetsFile) {
    const fs = await import('fs');
    if (fs.existsSync(opts.seedFromTargetsFile)) {
      await seedTargetsFromFile(pool, fs.readFileSync(opts.seedFromTargetsFile, 'utf8'));
    }
  }

  const due = opts.force
    ? (await (async () => {
        const { listTargets } = await import('./targetRegistry.js');
        const { resolveTargetPolicy } = await import('./policies.js');
        const { targets } = await listTargets(pool, { enabled: true, limit: opts.limit ?? 500 });
        return targets.filter((t) => {
          const policy = resolveTargetPolicy(t);
          return policy.schedule_mode === 'interval' || policy.schedule_mode === 'cron';
        });
      })())
    : await listDueTargets(pool, { limit: opts.limit ?? 100 });

  const submissions: CascadesSubmissionResult[] = [];
  let failed = 0;

  for (const target of due) {
    const result = await submitTargetToCascades(pool, target, {
      dryRun: opts.dryRun,
      wait: opts.wait,
      actor: opts.actor,
      force: opts.force,
    });
    submissions.push(result);
    if (result.error || result.cascades_status === 'failed') failed++;
  }

  return { submissions, failed };
}

export async function submitTargetIdToCascades(
  pool: Pool,
  targetId: string,
  opts: { dryRun?: boolean; wait?: boolean; force?: boolean } = {},
): Promise<CascadesSubmissionResult | null> {
  const target = await getTarget(pool, targetId);
  if (!target) return null;
  return submitTargetToCascades(pool, target, opts);
}

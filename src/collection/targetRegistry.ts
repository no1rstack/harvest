/**
 * Target Registry — what to collect, when, and under which workflow template.
 */

import type { Pool } from 'pg';
import { inferAssetType } from './asset-types.js';
import {
  defaultPolicyForTemplate,
  isTimeScheduledPolicy,
  nextCollectAtForPolicy,
  resolveTargetPolicy,
  TIME_SCHEDULED_POLICY_IDS,
} from './policies.js';
import type {
  CollectionTarget,
  CollectionTargetInput,
  CollectionTargetType,
} from './types.js';
import {
  normalizeWorkflowId,
} from './templates.js';
import { defaultWorkflowForAssetType, getCatalogWorkflow } from './workflow-catalog.js';
import { defaultStrategyForWorkflow, getCollectionStrategy } from './strategies.js';
import { ensureDependencySchema } from './discovery.js';
import { ensureObservationEventSchema } from './observation-events.js';
import { ensureRelationshipSchema } from './relationships.js';
import { validateTargetInput } from './validation.js';

export { inferAssetType as inferTargetType };

export function normalizeTargetValue(value: string): string {
  return value.trim().toLowerCase();
}

function resolveRegistryDefaults(input: CollectionTargetInput, targetType: CollectionTargetType) {
  const workflow = normalizeWorkflowId(
    input.workflow_template || defaultWorkflowForAssetType(targetType),
  );
  const catalog = getCatalogWorkflow(workflow);
  const strategy =
    (input.collection_strategy && getCollectionStrategy(input.collection_strategy)) ||
    defaultStrategyForWorkflow(workflow);

  const policyId =
    input.collection_policy ||
    strategy.policy ||
    catalog?.default_policy ||
    defaultPolicyForTemplate(workflow).id;
  const policy = resolveTargetPolicy({
    collection_policy: policyId,
    workflow_template: workflow,
    frequency: input.frequency,
  });
  const profileId =
    input.collection_profile ||
    strategy.profile ||
    policy.default_profile ||
    catalog?.default_profile ||
    'standard';
  const frequency = (input.frequency ||
    policy.schedule_value ||
    'daily') as CollectionTarget['frequency'];

  return {
    workflow: strategy.workflow_template || workflow,
    policy,
    policyId,
    profileId,
    strategyId: strategy.id,
    frequency,
  };
}

export async function ensureCollectionSchema(pool: Pool): Promise<void> {
  const { COLLECTION_SCHEMA_SQL } = await import('./schema.js');
  await pool.query(COLLECTION_SCHEMA_SQL);
  const { ensureIntelligenceCoreSchema } = await import('../intelligence/core/collections.js');
  const { seedOntologyV1 } = await import('../intelligence/ontology/registry.js');
  await ensureIntelligenceCoreSchema(pool);
  await seedOntologyV1(pool);
  await seedCollectionPolicies(pool);
  await ensureDependencySchema(pool);
  await ensureObservationEventSchema(pool);
  await ensureRelationshipSchema(pool);
}

async function seedCollectionPolicies(pool: Pool): Promise<void> {
  const { COLLECTION_POLICIES } = await import('./policies.js');
  for (const policy of Object.values(COLLECTION_POLICIES)) {
    await pool.query(
      `INSERT INTO collection_policies
        (id, name, workflow_template, schedule_mode, schedule_value, default_profile, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         workflow_template = EXCLUDED.workflow_template,
         schedule_mode = EXCLUDED.schedule_mode,
         schedule_value = EXCLUDED.schedule_value,
         default_profile = EXCLUDED.default_profile,
         description = EXCLUDED.description,
         updated_at = NOW()`,
      [
        policy.id,
        policy.name,
        policy.workflow_template,
        policy.schedule_mode,
        policy.schedule_value,
        policy.default_profile,
        policy.description,
      ],
    );
  }
}

function mapTargetRow(row: Record<string, unknown>): CollectionTarget {
  return {
    ...(row as CollectionTarget),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    collection_profile: (row.collection_profile as string) || 'standard',
    collection_policy: (row.collection_policy as string) || null,
    collection_strategy: (row.collection_strategy as string) || null,
    parent_target_id: (row.parent_target_id as string) || null,
    discovery_depth: Number(row.discovery_depth ?? 0),
    confidence: row.confidence != null ? Number(row.confidence) : null,
  };
}

export async function listTargets(
  pool: Pool,
  opts: {
    enabled?: boolean;
    product?: string;
    target_type?: string;
    collection_policy?: string;
    collection_profile?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ targets: CollectionTarget[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.enabled != null) {
    params.push(opts.enabled);
    where.push(`enabled = $${params.length}`);
  }
  if (opts.product) {
    params.push(opts.product);
    where.push(`product = $${params.length}`);
  }
  if (opts.target_type) {
    params.push(opts.target_type);
    where.push(`target_type = $${params.length}`);
  }
  if (opts.collection_policy) {
    params.push(opts.collection_policy);
    where.push(`collection_policy = $${params.length}`);
  }
  if (opts.collection_profile) {
    params.push(opts.collection_profile);
    where.push(`collection_profile = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await pool.query(
    `SELECT COUNT(*)::int AS total FROM collection_targets ${whereSql}`,
    params,
  );
  const limit = Math.min(opts.limit ?? 200, 500);
  const offset = opts.offset ?? 0;
  const listParams = [...params, limit, offset];
  const rows = await pool.query(
    `SELECT * FROM collection_targets ${whereSql}
     ORDER BY priority DESC, normalized_value ASC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  return {
    targets: rows.rows.map(mapTargetRow),
    total: countRow.rows[0]?.total ?? 0,
  };
}

export async function getTarget(pool: Pool, id: string): Promise<CollectionTarget | null> {
  const r = await pool.query(`SELECT * FROM collection_targets WHERE id = $1`, [id]);
  return r.rows[0] ? mapTargetRow(r.rows[0]) : null;
}

export async function getTargetByValue(
  pool: Pool,
  targetType: CollectionTargetType,
  value: string,
  product = 'shared',
): Promise<CollectionTarget | null> {
  const r = await pool.query(
    `SELECT * FROM collection_targets
     WHERE target_type = $1 AND normalized_value = $2 AND product = $3 AND case_id IS NULL
     LIMIT 1`,
    [targetType, normalizeTargetValue(value), product],
  );
  return r.rows[0] ? mapTargetRow(r.rows[0]) : null;
}

export async function upsertTarget(
  pool: Pool,
  input: CollectionTargetInput,
): Promise<CollectionTarget> {
  const validation = validateTargetInput(input);
  if (!validation.ok) throw new Error(validation.error);

  const targetType = input.target_type || inferAssetType(input.value);
  const normalized = normalizeTargetValue(input.value);
  const product = input.product || 'shared';
  const { workflow, policy, policyId, profileId, strategyId, frequency } = resolveRegistryDefaults(
    input,
    targetType,
  );

  const existing = await pool.query(
    `SELECT * FROM collection_targets
     WHERE target_type = $1 AND normalized_value = $2 AND product = $3
       AND COALESCE(case_id, -1) = COALESCE($4, -1)`,
    [targetType, normalized, product, input.case_id ?? null],
  );

  const tags = input.tags ?? null;
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

  if (existing.rows[0]?.id) {
    const prev = existing.rows[0];
    const valueChanged = String(prev.value).trim() !== input.value.trim();
    const typeChanged = prev.target_type !== targetType;
    const r = await pool.query(
      `UPDATE collection_targets SET
         value = $2,
         target_type = $3,
         workflow_template = $4,
         collection_profile = COALESCE($5, collection_profile),
         collection_policy = COALESCE($6, collection_policy),
         collection_strategy = COALESCE($7, collection_strategy),
         priority = COALESCE($8, priority),
         frequency = COALESCE($9, frequency),
         enabled = COALESCE($10, enabled),
         origin = COALESCE($11, origin),
         origin_ref = COALESCE($12, origin_ref),
         owner = COALESCE($13, owner),
         classification = COALESCE($14, classification),
         sensitivity = COALESCE($15, sensitivity),
         tags = COALESCE($16::text[], tags),
         confidence = COALESCE($17, confidence),
         intel_source = COALESCE($18, intel_source),
         metadata = COALESCE($19::jsonb, metadata),
         expires_at = COALESCE($20, expires_at),
         last_changed_at = CASE WHEN $21 THEN NOW() ELSE last_changed_at END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        existing.rows[0].id,
        input.value.trim(),
        targetType,
        workflow,
        input.collection_profile ?? profileId,
        input.collection_policy ?? policyId,
        input.collection_strategy ?? strategyId,
        input.priority ?? null,
        input.frequency ?? frequency,
        input.enabled ?? null,
        input.origin ?? null,
        input.origin_ref ?? null,
        input.owner ?? null,
        input.classification ?? null,
        input.sensitivity ?? null,
        tags,
        input.confidence ?? null,
        input.source ?? null,
        metadataJson,
        input.expires_at ?? null,
        valueChanged || typeChanged,
      ],
    );
    return mapTargetRow(r.rows[0]);
  }

  const r = await pool.query(
    `INSERT INTO collection_targets
      (target_type, value, normalized_value, product, case_id, workflow_template,
       collection_profile, collection_policy, collection_strategy, priority, frequency, enabled, origin, origin_ref,
       owner, classification, sensitivity, tags, confidence, intel_source, metadata,
       first_seen_at, expires_at, next_collect_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,NOW(),$22,$23)
     RETURNING *`,
    [
      targetType,
      input.value.trim(),
      normalized,
      product,
      input.case_id ?? null,
      workflow,
      input.collection_profile ?? profileId,
      input.collection_policy ?? policyId,
      input.collection_strategy ?? strategyId,
      input.priority ?? 50,
      frequency,
      input.enabled ?? true,
      input.origin || 'manual',
      input.origin_ref ?? null,
      input.owner ?? null,
      input.classification ?? null,
      input.sensitivity ?? null,
      tags || [],
      input.confidence ?? null,
      input.source ?? null,
      JSON.stringify(input.metadata || {}),
      input.expires_at ?? null,
      null,
    ],
  );
  return mapTargetRow(r.rows[0]);
}

export async function deleteTarget(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM collection_targets WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function listDueTargets(
  pool: Pool,
  opts: { workflow_template?: string; limit?: number } = {},
): Promise<CollectionTarget[]> {
  const params: unknown[] = [TIME_SCHEDULED_POLICY_IDS];
  let where = `enabled = TRUE
    AND (next_collect_at IS NULL OR next_collect_at <= NOW())
    AND COALESCE(collection_policy, 'passive-domain-daily') = ANY($1::text[])
    AND frequency NOT IN ('manual')`;

  if (opts.workflow_template) {
    params.push(opts.workflow_template);
    where += ` AND workflow_template = $${params.length}`;
  }
  params.push(Math.min(opts.limit ?? 100, 500));
  const r = await pool.query(
    `SELECT * FROM collection_targets
     WHERE ${where}
     ORDER BY priority DESC, next_collect_at ASC NULLS FIRST
     LIMIT $${params.length}`,
    params,
  );
  return r.rows.map(mapTargetRow);
}

export async function markTargetCollected(
  pool: Pool,
  id: string,
  target: Pick<CollectionTarget, 'collection_policy' | 'workflow_template' | 'frequency'>,
): Promise<void> {
  const policy = resolveTargetPolicy(target);
  if (!isTimeScheduledPolicy(policy)) return;
  const nextAt = nextCollectAtForPolicy(policy);
  await pool.query(
    `UPDATE collection_targets SET
       last_collected_at = NOW(),
       next_collect_at = $2,
       updated_at = NOW()
     WHERE id = $1`,
    [id, nextAt?.toISOString() ?? null],
  );
}

/** Parse targets.txt lines into registry inputs. */
export function parseTargetsFileLine(line: string): CollectionTargetInput | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const parts = trimmed.split(/\s+/);
  let product = 'shared';
  let value = '';
  let caseId: number | undefined;

  if (parts.length >= 2 && ['h3xa', 'judicium', 'harvest'].includes(parts[0])) {
    product = parts[0] === 'harvest' ? 'shared' : parts[0];
    value = parts[1];
    if (parts[2] && /^\d+$/.test(parts[2])) caseId = parseInt(parts[2], 10);
  } else {
    value = parts[0];
    if (parts[1] && /^\d+$/.test(parts[1])) caseId = parseInt(parts[1], 10);
  }

  if (!value) return null;

  const targetType = inferAssetType(value);
  return {
    target_type: targetType,
    value,
    product,
    case_id: caseId ?? null,
    workflow_template: defaultTemplateForAssetType(targetType),
    origin: 'targets.txt',
    origin_ref: 'scripts/osint-harvest/targets.txt',
  };
}

export async function seedTargetsFromFile(
  pool: Pool,
  content: string,
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;
  for (const line of content.split('\n')) {
    const input = parseTargetsFileLine(line);
    if (!input) {
      skipped++;
      continue;
    }
    await upsertTarget(pool, input);
    upserted++;
  }
  return { upserted, skipped };
}

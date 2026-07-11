/**
 * Level 6 Intelligence — bridge Collection Platform → H3XA STIX store.
 * Harvest DB holds observations; H3XA holds correlated STIX objects + relationships.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { getH3xaPool, isH3xaPgEnabled } from '../db/h3xaPostgres.js';
import { H3XA_STIX_SCHEMA_SQL } from '../db/h3xaStixSchema.js';
import { makeStixId } from '../lib/stixId.js';
import {
  ensureRelationshipSchema,
  upsertObservationRelationships,
} from './relationships.js';
import type { CollectionObservation } from './types.js';

export type CollectionStixPlatform = 'collection';

function stixUuidFromSeed(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function mapEntityToStixType(entityType: string, value: string): string {
  const t = entityType.toLowerCase();
  if (t === 'domain' || t === 'subdomain' || t === 'hostname' || t === 'dns_record') return 'domain-name';
  if (t === 'email') return 'email-addr';
  if (t === 'url' || t === 'feed_item') return 'url';
  if (t === 'ip') return value.includes(':') ? 'ipv6-addr' : 'ipv4-addr';
  if (t === 'organization' || t === 'person' || t === 'whois') return 'identity';
  return 'x-collection-observable';
}

function resolveStixId(row: {
  stix_id?: string | null;
  stix_type?: string | null;
  entity_type: string;
  value: string;
  source?: string | null;
}): { stix_id: string; stix_type: string } {
  if (row.stix_id && row.stix_type) {
    return { stix_id: row.stix_id, stix_type: row.stix_type };
  }
  const stixType = mapEntityToStixType(row.entity_type, row.value);
  const seed = `${row.source || 'collection'}|${row.entity_type}|${row.value.toLowerCase().trim()}`;
  return { stix_id: `${stixType}--${stixUuidFromSeed(`${stixType}:${seed}`)}`, stix_type: stixType };
}

function parseRelated(raw: unknown): Array<{ type: string; value: string; relation: string }> {
  if (Array.isArray(raw)) return raw as Array<{ type: string; value: string; relation: string }>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function resolveH3xaObjectId(type: string, value: string, seed?: string): Promise<string> {
  const pool = getH3xaPool();
  if (!pool) throw new Error('H3XA database not configured');
  const normalized = value.trim().toLowerCase();
  const existing = await pool.query(
    `SELECT id FROM stix_objects WHERE type = $1 AND LOWER(value) = $2 LIMIT 1`,
    [type, normalized],
  );
  if (existing.rows[0]?.id) return String(existing.rows[0].id);
  return makeStixId(type, seed || `${type}:${normalized}`);
}

async function ensureH3xaSchema(): Promise<boolean> {
  const pool = getH3xaPool();
  if (!pool) return false;
  await pool.query(H3XA_STIX_SCHEMA_SQL);
  return true;
}

async function upsertStixObjectOnH3xa(input: {
  id: string;
  type: string;
  value?: string | null;
  name?: string | null;
  identity_class?: string | null;
  confidence?: number | null;
  object?: Record<string, unknown>;
  native_id: string;
  attributes?: Record<string, unknown>;
  seen_at?: string;
}): Promise<{ id: string; inserted: boolean }> {
  const pool = getH3xaPool();
  if (!pool) throw new Error('H3XA database not configured');

  const value = input.value?.trim().toLowerCase() || null;
  const name = input.name?.trim() || null;
  const now = input.seen_at || new Date().toISOString();
  const conf100 =
    input.confidence == null
      ? null
      : input.confidence <= 1
        ? Math.round(input.confidence * 100)
        : Math.round(input.confidence);

  const objectJson = {
    type: input.type,
    spec_version: '2.1',
    id: input.id,
    ...(name ? { name } : {}),
    ...(value ? { value } : {}),
    ...(input.identity_class ? { identity_class: input.identity_class } : {}),
    ...(conf100 != null ? { confidence: conf100 } : {}),
    ...(input.object || {}),
  };

  const contentHash = crypto.createHash('sha256').update(JSON.stringify(objectJson)).digest('hex').slice(0, 16);
  const existing = await pool.query('SELECT id FROM stix_objects WHERE id = $1', [input.id]);
  const inserted = existing.rowCount === 0;

  await pool.query(
    `INSERT INTO stix_objects (
      id, type, spec_version, created, modified, confidence, name, value,
      identity_class, object_json, content_hash, first_seen, last_seen
    ) VALUES ($1,$2,'2.1',$3,$3,$4,$5,$6,$7,$8::jsonb,$9,$3,$3)
    ON CONFLICT (id) DO UPDATE SET
      last_seen = EXCLUDED.last_seen,
      modified = EXCLUDED.modified,
      confidence = COALESCE(EXCLUDED.confidence, stix_objects.confidence),
      object_json = EXCLUDED.object_json,
      content_hash = EXCLUDED.content_hash,
      updated_at = NOW()`,
    [
      input.id,
      input.type,
      now,
      conf100,
      name,
      value,
      input.identity_class || null,
      JSON.stringify(objectJson),
      contentHash,
    ],
  );

  await pool.query(
    `INSERT INTO stix_object_sources (object_id, platform, native_id, attributes, confidence, first_seen, last_seen)
     VALUES ($1,'collection',$2,$3::jsonb,$4,$5,$5)
     ON CONFLICT (object_id, platform, native_id) DO UPDATE SET
       last_seen = EXCLUDED.last_seen,
       attributes = stix_object_sources.attributes || EXCLUDED.attributes,
       confidence = COALESCE(EXCLUDED.confidence, stix_object_sources.confidence)`,
    [
      input.id,
      input.native_id,
      JSON.stringify(input.attributes || {}),
      input.confidence ?? null,
      now,
    ],
  );

  return { id: input.id, inserted };
}

async function upsertStixRelationshipOnH3xa(input: {
  relationship_type: string;
  source_ref: string;
  target_ref: string;
  description?: string;
  confidence?: number | null;
}): Promise<string> {
  const pool = getH3xaPool();
  if (!pool) throw new Error('H3XA database not configured');

  const id = makeStixId(
    'relationship',
    `${input.relationship_type}:${input.source_ref}:${input.target_ref}`,
  );
  const conf100 =
    input.confidence == null
      ? null
      : input.confidence <= 1
        ? Math.round(input.confidence * 100)
        : Math.round(input.confidence);

  await pool.query(
    `INSERT INTO stix_relationships (id, relationship_type, source_ref, target_ref, description, confidence, object_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (relationship_type, source_ref, target_ref) DO UPDATE SET
       modified = NOW(),
       confidence = COALESCE(EXCLUDED.confidence, stix_relationships.confidence)`,
    [
      id,
      input.relationship_type,
      input.source_ref,
      input.target_ref,
      input.description || null,
      conf100,
      JSON.stringify({
        type: 'relationship',
        spec_version: '2.1',
        id,
        relationship_type: input.relationship_type,
        source_ref: input.source_ref,
        target_ref: input.target_ref,
      }),
    ],
  );
  return id;
}

export interface IntelligenceBridgeResult {
  ok: boolean;
  h3xa_enabled: boolean;
  objects_upserted: number;
  objects_inserted: number;
  relationships_upserted: number;
  findings_processed: number;
  graph_edges_processed: number;
  errors: string[];
}

export async function bridgeFindingRowToH3xa(
  row: Record<string, unknown>,
): Promise<{ objectId: string; inserted: boolean } | null> {
  if (!isH3xaPgEnabled()) return null;

  const { stix_id, stix_type } = resolveStixId({
    stix_id: row.stix_id as string,
    stix_type: row.stix_type as string,
    entity_type: String(row.entity_type || 'unknown'),
    value: String(row.value || ''),
    source: row.source as string,
  });

  const entityType = String(row.entity_type || '').toLowerCase();
  const result = await upsertStixObjectOnH3xa({
    id: await resolveH3xaObjectId(stix_type, String(row.value || ''), stix_id),
    type: stix_type,
    value: String(row.value || ''),
    name: (row.label as string) || (row.title as string) || String(row.value || ''),
    identity_class:
      entityType === 'organization' ? 'organization' : entityType === 'person' ? 'individual' : undefined,
    confidence: row.confidence != null ? Number(row.confidence) : 0.7,
    native_id: String(row.id || stix_id),
    attributes: {
      harvest_finding_id: row.id,
      source: row.source,
      entity_type: row.entity_type,
      workflow_run_id: row.workflow_run_id,
      connector_id: row.connector_id,
      workflow_template: row.workflow_template,
      product: row.product,
    },
    seen_at: (row.observed_at as string) || (row.created_at as string),
  });

  return { objectId: result.id, inserted: result.inserted };
}

export async function bridgeCollectionGraphToH3xa(
  harvestPool: Pool,
  opts: { workflow_run_id?: string; limit?: number } = {},
): Promise<{ relationships: number; errors: string[] }> {
  if (!isH3xaPgEnabled()) return { relationships: 0, errors: ['H3XA database not configured'] };
  await ensureH3xaSchema();
  await ensureRelationshipSchema(harvestPool);

  const params: unknown[] = [];
  let where = '';
  if (opts.workflow_run_id) {
    params.push(opts.workflow_run_id);
    where = `WHERE workflow_run_id = $${params.length}`;
  }
  params.push(Math.min(opts.limit ?? 500, 2000));

  const edges = await harvestPool.query(
    `SELECT * FROM collection_relationships ${where}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );

  let relationships = 0;
  const errors: string[] = [];

  for (const edge of edges.rows) {
    try {
      const sourceType = String(edge.source_stix_id || '').split('--')[0] || 'x-collection-observable';
      const targetType =
        String(edge.target_stix_id || '').split('--')[0] ||
        mapEntityToStixType(edge.target_type, edge.target_value);

      const sourceRef = await resolveH3xaObjectId(
        sourceType,
        edge.source_value,
        edge.source_stix_id as string,
      );
      const targetRef = await resolveH3xaObjectId(
        targetType,
        edge.target_value,
        edge.target_stix_id as string,
      );

      await upsertStixObjectOnH3xa({
        id: sourceRef,
        type: sourceType,
        value: edge.source_value,
        native_id: edge.source_observation_id,
        confidence: edge.confidence != null ? Number(edge.confidence) : 0.7,
      });

      await upsertStixObjectOnH3xa({
        id: targetRef,
        type: targetType,
        value: edge.target_value,
        native_id: `edge-target:${edge.id}`,
        confidence: edge.confidence != null ? Number(edge.confidence) : 0.7,
      });

      await upsertStixRelationshipOnH3xa({
        relationship_type: edge.relationship_type,
        source_ref: sourceRef,
        target_ref: targetRef,
        description: `collection:${edge.connector_id || 'unknown'}`,
        confidence: edge.confidence != null ? Number(edge.confidence) : 0.7,
      });
      relationships++;
    } catch (err) {
      errors.push(`${edge.id}: ${(err as Error).message}`);
    }
  }

  return { relationships, errors };
}

export async function bridgeWorkflowRunToH3xa(
  harvestPool: Pool,
  workflowRunId: string,
): Promise<IntelligenceBridgeResult> {
  return bridgeFindingsToH3xa(harvestPool, { workflow_run_id: workflowRunId });
}

export async function bridgeFindingsToH3xa(
  harvestPool: Pool,
  opts: {
    workflow_run_id?: string;
    target_id?: string;
    limit?: number;
    backfill_graph?: boolean;
  } = {},
): Promise<IntelligenceBridgeResult> {
  const result: IntelligenceBridgeResult = {
    ok: false,
    h3xa_enabled: isH3xaPgEnabled(),
    objects_upserted: 0,
    objects_inserted: 0,
    relationships_upserted: 0,
    findings_processed: 0,
    graph_edges_processed: 0,
    errors: [],
  };

  if (!result.h3xa_enabled) {
    result.errors.push('H3XA_DATABASE_URL not configured');
    return result;
  }

  await ensureH3xaSchema();

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.workflow_run_id) {
    params.push(opts.workflow_run_id);
    where.push(`workflow_run_id = $${params.length}`);
  }
  if (opts.target_id) {
    params.push(opts.target_id);
    where.push(`target_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 1000, 5000));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const findings = await harvestPool.query(
    `SELECT * FROM osint_harvest_findings ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );

  for (const row of findings.rows) {
    try {
      const bridged = await bridgeFindingRowToH3xa(row);
      if (bridged) {
        result.objects_upserted++;
        if (bridged.inserted) result.objects_inserted++;
        result.findings_processed++;

        const { stix_id } = resolveStixId({
          stix_id: row.stix_id,
          stix_type: row.stix_type,
          entity_type: row.entity_type,
          value: row.value,
          source: row.source,
        });

        if (!row.stix_id || !row.stix_type) {
          await harvestPool.query(
            `UPDATE osint_harvest_findings SET stix_id = $2, stix_type = $3 WHERE id = $1`,
            [row.id, stix_id, resolveStixId(row).stix_type],
          );
        }

        if (opts.backfill_graph !== false) {
          const related = parseRelated(row.related);
          if (related.length) {
            const obs: CollectionObservation = {
              stix_id,
              stix_type: resolveStixId(row).stix_type,
              entity_type: row.entity_type,
              value: row.value,
              label: row.label || row.value,
              title: row.title || row.value,
              source: row.source,
              source_id: row.source_id || row.id,
              observed_at: row.observed_at || row.created_at,
              content_hash: row.content_hash || row.id,
              stix_object: {},
              provenance: {},
              related,
            };
            await upsertObservationRelationships(harvestPool, obs, {
              observationId: row.id,
              workflowRunId: row.workflow_run_id,
              connectorId: row.connector_id || row.source,
            });
          }
        }
      }
    } catch (err) {
      result.errors.push(`${row.id}: ${(err as Error).message}`);
    }
  }

  const graph = await bridgeCollectionGraphToH3xa(harvestPool, {
    workflow_run_id: opts.workflow_run_id,
    limit: opts.limit,
  });
  result.relationships_upserted = graph.relationships;
  result.graph_edges_processed = graph.relationships;
  result.errors.push(...graph.errors);
  result.ok = result.errors.length === 0 || result.objects_upserted > 0;
  return result;
}

export async function upgradeRegistryStrategies(harvestPool: Pool): Promise<number> {
  const { defaultStrategyForWorkflow } = await import('./strategies.js');
  const { normalizeWorkflowId } = await import('./workflow-catalog.js');

  const rows = await harvestPool.query(
    `SELECT id, workflow_template, collection_strategy FROM collection_targets`,
  );

  let updated = 0;
  for (const row of rows.rows) {
    if (row.collection_strategy) continue;
    const wf = normalizeWorkflowId(String(row.workflow_template || 'passive-domain'));
    const strategy = defaultStrategyForWorkflow(wf);
    await harvestPool.query(
      `UPDATE collection_targets SET
         collection_strategy = $2,
         collection_profile = COALESCE(collection_profile, $3),
         collection_policy = COALESCE(collection_policy, $4),
         workflow_template = $5,
         updated_at = NOW()
       WHERE id = $1`,
      [row.id, strategy.id, strategy.profile, strategy.policy, strategy.workflow_template],
    );
    updated++;
  }
  return updated;
}

export async function bootstrapCollectionPlatform(
  harvestPool: Pool,
  opts: {
    sync_h3xa?: boolean;
    run_due?: boolean;
    dry_run?: boolean;
    force?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const { ensureCollectionSchema } = await import('./targetRegistry.js');
  const { bootstrapIntelligenceCore } = await import('../intelligence/core/bootstrap.js');
  await ensureCollectionSchema(harvestPool);
  const phase0 = await bootstrapIntelligenceCore(harvestPool);

  const strategiesUpgraded = await upgradeRegistryStrategies(harvestPool);

  const counts = await harvestPool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM osint_harvest_findings) AS findings,
      (SELECT COUNT(*)::int FROM collection_targets) AS targets,
      (SELECT COUNT(*)::int FROM collection_relationships) AS graph_edges,
      (SELECT COUNT(*)::int FROM observation_events) AS observation_events,
      (SELECT COUNT(*)::int FROM collections) AS collections,
      (SELECT COUNT(*)::int FROM domain_events) AS domain_events,
      (SELECT COUNT(*)::int FROM ontology_entity_types) AS ontology_entity_types,
      (SELECT COUNT(*)::int FROM source_artifacts) AS source_artifacts,
      (SELECT COUNT(*)::int FROM extraction_runs) AS extraction_runs,
      (SELECT COUNT(*)::int FROM observed_entities) AS observed_entities,
      (SELECT COUNT(*)::int FROM provenance) AS provenance_records,
      (SELECT COUNT(*)::int FROM resolved_entities) AS resolved_entities,
      (SELECT COUNT(*)::int FROM knowledge_objects) AS knowledge_objects,
      (SELECT COUNT(*)::int FROM claims) AS claims,
      (SELECT COUNT(*)::int FROM automation_rules) AS automation_rules
  `);

  let h3xaBridge: IntelligenceBridgeResult | null = null;
  if (opts.sync_h3xa !== false) {
    h3xaBridge = await bridgeFindingsToH3xa(harvestPool, {
      backfill_graph: true,
      limit: 5000,
    });
  }

  let dueResult: unknown = null;
  if (opts.run_due) {
    const { submitDueTargetsToCascades } = await import('./submitDue.js');
    dueResult = await submitDueTargetsToCascades(harvestPool, {
      dryRun: Boolean(opts.dry_run),
      force: Boolean(opts.force),
      limit: 50,
      actor: 'platform-bootstrap',
    });
  }

  return {
    schema: 'migrated',
    phase0,
    strategies_upgraded: strategiesUpgraded,
    counts: counts.rows[0],
    h3xa_bridge: h3xaBridge,
    due_submissions: dueResult,
  };
}

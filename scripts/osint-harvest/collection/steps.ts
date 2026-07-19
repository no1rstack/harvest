/**
 * Harvest collection step handlers — called by Cascades semantic nodes via HTTP.
 * Does NOT orchestrate workflows.
 */

import type { Pool } from 'pg';
import {
  ensureHarvestSchema,
  startHarvestRun,
  finishHarvestRun,
} from '../pg-writer.js';
import type { CollectionObservation, CollectionTarget } from '../../../src/collection/types.js';
import type { CollectionExecutionContext, CollectionTerminalStatus } from '../../../src/collection/executionContext.js';
import { deriveTerminalStatus } from '../../../src/collection/executionContext.js';
import { ensureCollectionSchema, getTarget, markTargetCollected } from '../../../src/collection/targetRegistry.js';
import { publishCollectionEvent } from '../../../src/collection/events.js';
import { collectorsForTarget } from '../../../src/collection/templates.js';
import { resolveProfileCollectors } from '../../../src/collection/profiles.js';
import { observationBatchSize } from '../../../src/collection/collectionConfig.js';
import { upsertObservationRelationships } from '../../../src/collection/relationships.js';
import { appendObservationEvent } from '../../../src/collection/observation-events.js';
import { discoverFromObservations } from '../../../src/collection/discovery.js';
import { bridgeWorkflowRunToH3xa } from '../../../src/collection/intelligence-bridge.js';
import { bridgeWorkflowRunToJudicium } from '../../../src/collection/judicium-bridge.js';
import { ensureCollectionForRun, finishCollection } from '../../../src/intelligence/core/collections.js';
import type { ExtractionRun } from '../../../src/intelligence/core/extractions.js';
import { persistObservationLineage } from '../../../src/intelligence/core/ingest.js';
import { publishDomainEvent } from '../../../src/intelligence/core/domain-events.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../../../src/intelligence/ontology/types.js';
import { runPostCollectionCapabilities } from '../../../src/intelligence/core/post-collection.js';

export { observationBatchSize };

export async function persistObservationsStep(
  pool: Pool,
  opts: {
    runId: string;
    target: CollectionTarget;
    observations: CollectionObservation[];
    execution?: CollectionExecutionContext;
    harvesters?: string[];
    dryRun?: boolean;
    stream?: {
      batch_index: number;
      batch_total: number;
      total_observations?: number;
      cumulative_inserted?: number;
      cumulative_skipped?: number;
      finish_run?: boolean;
      append_run?: boolean;
    };
  },
): Promise<{ inserted: number; skipped: number; observation_ids: string[]; dry_run?: boolean; batch_index?: number; batch_total?: number }> {
  if (opts.dryRun) {
    return { inserted: 0, skipped: opts.observations.length, observation_ids: [], dry_run: true };
  }

  await ensureHarvestSchema(pool);
  await ensureCollectionSchema(pool);

  const profileCollectors = resolveProfileCollectors(
    opts.target.workflow_template,
    opts.target.collection_profile,
  );
  const harvesters = opts.harvesters?.length
    ? opts.harvesters
    : profileCollectors.length
      ? profileCollectors
      : collectorsForTarget(opts.target.workflow_template, opts.target.target_type);

  const stream = opts.stream;
  const appendRun = Boolean(stream?.append_run);
  const isFirstBatch = !stream || stream.batch_index === 0;
  const isLastBatch = !stream || Boolean(stream.finish_run);
  const exec = opts.execution;

  if (isFirstBatch && !appendRun) {
    await ensureCollectionForRun(pool, {
      id: opts.runId,
      kind: 'scheduled_crawl',
      product: opts.target.product,
      case_id: opts.target.case_id,
      target_id: opts.target.id,
      initiated_by: 'collection-platform',
      cascades_run_id: exec?.workflow_run_id || opts.runId,
      legacy_run_id: opts.runId,
      config: {
        workflow_template: opts.target.workflow_template,
        target_value: opts.target.value,
      },
    });
    await publishDomainEvent(pool, {
      event_type: 'collection.started',
      aggregate_type: 'collection',
      aggregate_id: opts.runId,
      collection_id: opts.runId,
      payload: {
        target_id: opts.target.id,
        target_value: opts.target.value,
        workflow_template: opts.target.workflow_template,
      },
    });
    await startHarvestRun(pool, {
      runId: opts.runId,
      target: opts.target.value,
      caseId: opts.target.case_id ?? undefined,
      userId: 'collection-platform',
      harvesters,
      product: opts.target.product,
    });
  }

  let inserted = 0;
  let skipped = 0;
  const observationIds: string[] = [];
  const extractionCache = new Map<string, ExtractionRun>();

  for (const obs of opts.observations) {
    const id = `ohf_${obs.content_hash.slice(0, 32)}`;
    const result = await pool.query(
      `INSERT INTO osint_harvest_findings
        (id, run_id, case_id, product, source, source_id, entity_type, value, label, title,
         description, severity, confidence, tags, content_hash, raw, related, observed_at,
         target_id, stix_type, stix_id, provenance,
         workflow_template, workflow_version, workflow_run_id, node_id, connector_id, collection_event_id,
         collection_id, ontology_version, observable_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22::jsonb,$23,$24,$25,$26,$27,$28,$29,$30,$31)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING id`,
      [
        id,
        opts.runId,
        opts.target.case_id,
        opts.target.product,
        obs.source,
        obs.source_id,
        obs.entity_type,
        obs.value,
        obs.label,
        obs.title,
        obs.description || '',
        obs.severity || 'info',
        obs.confidence ?? 0.7,
        obs.tags || [],
        obs.content_hash,
        JSON.stringify({ ...obs.raw, stix_object: obs.stix_object }),
        JSON.stringify(obs.related || []),
        obs.observed_at,
        opts.target.id,
        obs.stix_type,
        obs.stix_id,
        JSON.stringify(obs.provenance),
        exec?.workflow_template || opts.target.workflow_template,
        exec?.workflow_version || null,
        exec?.workflow_run_id || opts.runId,
        exec?.node_id || null,
        exec?.connector_id || obs.source,
        exec?.collection_event_id || null,
        opts.runId,
        obs.ontology_version || ACTIVE_ONTOLOGY_VERSION,
        obs.observable_type || null,
      ],
    );

    if (result.rowCount === 0) {
      skipped++;
    } else {
      inserted++;
      observationIds.push(id);
      try {
        const lineage = await persistObservationLineage(pool, {
          collection_id: opts.runId,
          observation_id: id,
          observation: obs,
          execution: exec,
          extractionCache,
        });
        await pool.query(
          `UPDATE osint_harvest_findings
           SET source_artifact_id = $2, extraction_run_id = $3, provenance_id = $4
           WHERE id = $1`,
          [id, lineage.source_artifact_id, lineage.extraction_run_id, lineage.provenance_id],
        );
        const relCount = await upsertObservationRelationships(pool, obs, {
          observationId: id,
          workflowRunId: exec?.workflow_run_id || opts.runId,
          connectorId: exec?.connector_id || obs.source,
          collectionId: opts.runId,
        });
        await publishDomainEvent(pool, {
          event_type: 'observation.created',
          aggregate_type: 'observation',
          aggregate_id: id,
          collection_id: opts.runId,
          ontology_version: obs.ontology_version || ACTIVE_ONTOLOGY_VERSION,
          payload: {
            stix_id: obs.stix_id,
            entity_type: obs.entity_type,
            observable_type: obs.observable_type,
            value: obs.value,
            source: obs.source,
            source_artifact_id: lineage.source_artifact_id,
            extraction_run_id: lineage.extraction_run_id,
            observed_entity_id: lineage.observed_entity_id,
          },
        });
        if (relCount > 0) {
          await publishDomainEvent(pool, {
            event_type: 'relationship.added',
            aggregate_type: 'observation',
            aggregate_id: id,
            collection_id: opts.runId,
            ontology_version: obs.ontology_version || ACTIVE_ONTOLOGY_VERSION,
            payload: { value: obs.value, relationships_added: relCount },
          }).catch(() => {});
        }
        await appendObservationEvent(pool, {
          event_type: 'observation.created',
          observation_id: id,
          stix_id: obs.stix_id,
          target_id: opts.target.id,
          workflow_run_id: exec?.workflow_run_id || opts.runId,
          observation: obs,
        });
      } catch {
        /* graph + event linking is best-effort */
      }
      if (inserted <= 50) {
        await publishCollectionEvent(pool, {
          event_type: 'observation.persisted',
          target_id: opts.target.id,
          run_id: opts.runId,
          cascades_run_id: exec?.workflow_run_id || opts.runId,
          payload: { observation_id: id, source: obs.source, value: obs.value },
        });
      }
    }
  }

  if (isLastBatch) {
    const totalInserted = stream?.cumulative_inserted ?? inserted;
    const totalSkipped = stream?.cumulative_skipped ?? skipped;
    if (appendRun) {
      await pool.query(
        `UPDATE osint_harvest_runs
         SET inserted = COALESCE(inserted, 0) + $2,
             skipped = COALESCE(skipped, 0) + $3,
             status = 'completed',
             finished_at = NOW()
         WHERE id = $1`,
        [opts.runId, totalInserted, totalSkipped],
      );
    } else {
      await finishHarvestRun(pool, {
        runId: opts.runId,
        target: opts.target.value,
        caseId: opts.target.case_id ?? undefined,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        harvesters,
        totalFindings: stream?.total_observations ?? opts.observations.length,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: [],
      });
    }
  }

  return {
    inserted,
    skipped,
    observation_ids: observationIds,
    batch_index: stream?.batch_index,
    batch_total: stream?.batch_total,
  };
}

export async function finalizeCollectionStep(
  pool: Pool,
  opts: {
    targetId: string;
    workflowRunId: string;
    persist: { inserted?: number; skipped?: number; observation_ids?: string[] };
    merge?: {
      findings?: unknown[];
      connector_errors?: string[];
      connector_failures?: number;
      connector_total?: number;
    };
    dryRun?: boolean;
  },
): Promise<{ terminal_status: CollectionTerminalStatus; event_id: string }> {
  const target = await getTarget(pool, opts.targetId);
  if (!target) throw new Error('Target not found');

  const connectorErrors = opts.merge?.connector_errors || [];
  const terminal = deriveTerminalStatus({
    inserted: opts.persist?.inserted,
    connectorErrors,
    connectorFailures: opts.merge?.connector_failures,
  });

  if (!opts.dryRun && terminal !== 'failed') {
    await markTargetCollected(pool, target.id, target);
    await pool.query(
      `UPDATE collection_targets SET last_cascades_run_id = $2, updated_at = NOW() WHERE id = $1`,
      [target.id, opts.workflowRunId],
    );

    const obsRows = await pool.query(
      `SELECT entity_type, value, related
       FROM osint_harvest_findings
       WHERE workflow_run_id = $1 AND target_id = $2`,
      [opts.workflowRunId, target.id],
    );
    const observations = obsRows.rows.map((row) => ({
      entity_type: row.entity_type,
      value: row.value,
      related: Array.isArray(row.related)
        ? row.related
        : typeof row.related === 'string'
          ? JSON.parse(row.related)
          : row.related || [],
      stix_id: '',
      stix_type: '',
      label: '',
      title: '',
      source: '',
      source_id: '',
      observed_at: '',
      content_hash: '',
      stix_object: {},
      provenance: {},
    })) as CollectionObservation[];

    const discovery = await discoverFromObservations(pool, target, observations, {
      workflowRunId: opts.workflowRunId,
    });

    await publishCollectionEvent(pool, {
      event_type: 'discovery.completed',
      target_id: target.id,
      run_id: opts.workflowRunId,
      cascades_run_id: opts.workflowRunId,
      payload: discovery,
    });

    try {
      const bridge = await bridgeWorkflowRunToH3xa(pool, opts.workflowRunId);
      await publishCollectionEvent(pool, {
        event_type: 'intelligence.synced',
        target_id: target.id,
        run_id: opts.workflowRunId,
        cascades_run_id: opts.workflowRunId,
        payload: bridge,
      });
    } catch {
      /* H3XA bridge is best-effort when H3XA_DATABASE_URL unset */
    }

    try {
      const jud = await bridgeWorkflowRunToJudicium(pool, {
        workflowRunId: opts.workflowRunId,
        targetId: target.id,
        targetValue: target.value,
        caseId: target.case_id,
      });
      await publishCollectionEvent(pool, {
        event_type: 'judicium.synced',
        target_id: target.id,
        run_id: opts.workflowRunId,
        cascades_run_id: opts.workflowRunId,
        payload: jud as unknown as Record<string, unknown>,
      });
    } catch {
      /* Judicium bridge is best-effort when token/URL unset */
    }
  }

  const eventType =
    terminal === 'completed_with_warnings'
      ? 'collection.completed_with_warnings'
      : terminal === 'failed'
        ? 'collection.failed'
        : 'collection.completed';

  const evt = await publishCollectionEvent(pool, {
    event_type: eventType,
    target_id: target.id,
    run_id: opts.workflowRunId,
    cascades_run_id: opts.workflowRunId,
    collection_id: opts.workflowRunId,
    payload: {
      terminal_status: terminal,
      target_value: target.value,
      workflow_template: target.workflow_template,
      total_findings: opts.merge?.findings?.length ?? 0,
      inserted: opts.persist?.inserted ?? 0,
      skipped: opts.persist?.skipped ?? 0,
      observation_ids: opts.persist?.observation_ids ?? [],
      connector_errors: connectorErrors,
      connector_failures: opts.merge?.connector_failures ?? 0,
      connector_total: opts.merge?.connector_total ?? 0,
      dry_run: Boolean(opts.dryRun),
    },
  });

  if (!opts.dryRun) {
    await finishCollection(pool, {
      id: opts.workflowRunId,
      status: terminal,
      stats: {
        inserted: opts.persist?.inserted ?? 0,
        skipped: opts.persist?.skipped ?? 0,
        terminal_status: terminal,
      },
    });

    if (terminal !== 'failed') {
      try {
        const post = await runPostCollectionCapabilities(pool, {
          collection_id: opts.workflowRunId,
          target_value: target.value,
          terminal_status: terminal,
        });
        await publishCollectionEvent(pool, {
          event_type: 'intelligence.post_collection',
          target_id: target.id,
          run_id: opts.workflowRunId,
          cascades_run_id: opts.workflowRunId,
          collection_id: opts.workflowRunId,
          payload: post,
        });
      } catch {
        /* post-collection is best-effort */
      }
    }
  }

  return { terminal_status: terminal, event_id: evt.id };
}

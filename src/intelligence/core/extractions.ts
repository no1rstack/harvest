/**
 * Extraction runs — recorded transforms from artifacts to observations.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { CONNECTOR_VERSION } from '../../collection/executionContext.js';
import type { CollectionExecutionContext } from '../../collection/executionContext.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { insertProvenance } from './provenance.js';

export interface ExtractionRun {
  id: string;
  collection_id: string;
  source_artifact_id: string | null;
  method: string;
  connector_id: string | null;
  extractor_version: string;
  workflow_run_id: string | null;
  node_id: string | null;
  status: string;
  ontology_version: string;
  provenance_id: string;
  started_at: string;
  finished_at: string | null;
}

function extractionRunId(
  collectionId: string,
  connectorId: string,
  artifactId: string,
  method: string,
): string {
  const seed = `${collectionId}|${connectorId}|${artifactId}|${method}`;
  return `ext_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

export async function ensureExtractionRun(
  pool: Pool,
  opts: {
    collection_id: string;
    source_artifact_id: string;
    connector_id: string;
    artifact_provenance_id: string;
    execution?: CollectionExecutionContext;
    method?: string;
    ontology_version?: string;
    cache?: Map<string, ExtractionRun>;
  },
): Promise<ExtractionRun> {
  const method = opts.method || 'stix-normalize';
  const cacheKey = `${opts.source_artifact_id}:${method}`;
  if (opts.cache?.has(cacheKey)) {
    return opts.cache.get(cacheKey)!;
  }

  const id = extractionRunId(opts.collection_id, opts.connector_id, opts.source_artifact_id, method);
  const ontology_version = opts.ontology_version || ACTIVE_ONTOLOGY_VERSION;

  const extractionProv = await insertProvenance(pool, {
    collection_id: opts.collection_id,
    provenance_class: 'extraction',
    subject_type: 'extraction_run',
    subject_id: id,
    parent_id: opts.artifact_provenance_id,
    collector_id: opts.connector_id,
    ontology_version,
    id_seed: `${opts.collection_id}:extraction:${id}`,
    payload: {
      method,
      extractor_version: CONNECTOR_VERSION,
      workflow_run_id: opts.execution?.workflow_run_id,
      node_id: opts.execution?.node_id,
    },
  });

  await pool.query(
    `INSERT INTO extraction_runs
      (id, collection_id, source_artifact_id, method, connector_id, extractor_version,
       workflow_run_id, node_id, status, ontology_version, provenance_id, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      opts.collection_id,
      opts.source_artifact_id,
      method,
      opts.connector_id,
      CONNECTOR_VERSION,
      opts.execution?.workflow_run_id || null,
      opts.execution?.node_id || null,
      ontology_version,
      extractionProv.id,
    ],
  );

  const r = await pool.query(`SELECT * FROM extraction_runs WHERE id = $1`, [id]);
  const run = r.rows[0] as ExtractionRun;
  opts.cache?.set(cacheKey, run);
  return run;
}

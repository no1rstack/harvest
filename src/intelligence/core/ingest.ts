/**
 * Ingest lineage — artifact → extraction → observation provenance → observed entity.
 */

import type { Pool } from 'pg';
import type { CollectionObservation } from '../../collection/types.js';
import type { CollectionExecutionContext } from '../../collection/executionContext.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { upsertSourceArtifact } from './artifacts.js';
import { ensureExtractionRun } from './extractions.js';
import { insertProvenance } from './provenance.js';
import { materializeObservedEntity } from './observed-entities.js';
import type { ExtractionRun } from './extractions.js';
import type { SourceArtifact } from './artifacts.js';

export interface ObservationLineage {
  source_artifact_id: string;
  extraction_run_id: string;
  provenance_id: string;
  observed_entity_id: string;
}

export async function persistObservationLineage(
  pool: Pool,
  opts: {
    collection_id: string;
    observation_id: string;
    observation: CollectionObservation;
    execution?: CollectionExecutionContext;
    extractionCache?: Map<string, ExtractionRun>;
  },
): Promise<ObservationLineage> {
  const artifact: SourceArtifact = await upsertSourceArtifact(pool, {
    collection_id: opts.collection_id,
    observation: opts.observation,
    fetch_metadata: {
      workflow_run_id: opts.execution?.workflow_run_id,
      node_id: opts.execution?.node_id,
      connector_id: opts.execution?.connector_id,
    },
  });

  const extraction = await ensureExtractionRun(pool, {
    collection_id: opts.collection_id,
    source_artifact_id: artifact.id,
    connector_id: opts.observation.source,
    artifact_provenance_id: artifact.provenance_id,
    execution: opts.execution,
    ontology_version: opts.observation.ontology_version,
    cache: opts.extractionCache,
  });

  const assertionProv = await insertProvenance(pool, {
    collection_id: opts.collection_id,
    provenance_class: 'assertion',
    subject_type: 'observation',
    subject_id: opts.observation_id,
    parent_id: extraction.provenance_id,
    collector_id: opts.observation.source,
    ontology_version: opts.observation.ontology_version || ACTIVE_ONTOLOGY_VERSION,
    id_seed: `${opts.collection_id}:assertion:${opts.observation_id}`,
    payload: {
      content_hash: opts.observation.content_hash,
      stix_id: opts.observation.stix_id,
      entity_type: opts.observation.entity_type,
      value: opts.observation.value,
      observable_type: opts.observation.observable_type,
    },
  });

  const observed = await materializeObservedEntity(pool, {
    collection_id: opts.collection_id,
    observation_id: opts.observation_id,
    observation: opts.observation,
    extraction_run_id: extraction.id,
    assertion_provenance_id: assertionProv.id,
  });

  return {
    source_artifact_id: artifact.id,
    extraction_run_id: extraction.id,
    provenance_id: assertionProv.id,
    observed_entity_id: observed.id,
  };
}

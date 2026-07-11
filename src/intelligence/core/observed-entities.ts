/**
 * Observed entities — ontology-typed instances materialized from observations.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { CollectionObservation } from '../../collection/types.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { insertProvenance } from './provenance.js';
import { publishDomainEvent } from './domain-events.js';

export interface ObservedEntity {
  id: string;
  collection_id: string;
  observation_id: string;
  extraction_run_id: string | null;
  entity_type: string;
  canonical_value: string;
  stix_type: string | null;
  stix_id: string | null;
  confidence: number | null;
  ontology_version: string;
  provenance_id: string;
  created_at: string;
}

function observedEntityId(observationId: string): string {
  return `obsent_${crypto.createHash('sha256').update(observationId).digest('hex').slice(0, 24)}`;
}

export async function materializeObservedEntity(
  pool: Pool,
  opts: {
    collection_id: string;
    observation_id: string;
    observation: CollectionObservation;
    extraction_run_id: string;
    assertion_provenance_id: string;
    emit_event?: boolean;
  },
): Promise<ObservedEntity> {
  const { observation: obs, observation_id, collection_id } = opts;
  const id = observedEntityId(observation_id);
  const ontology_version = obs.ontology_version || ACTIVE_ONTOLOGY_VERSION;
  const canonical_value = obs.value.trim().toLowerCase();

  const entityProv = await insertProvenance(pool, {
    collection_id,
    provenance_class: 'assertion',
    subject_type: 'observed_entity',
    subject_id: id,
    parent_id: opts.assertion_provenance_id,
    ontology_version,
    collector_id: obs.source,
    id_seed: `${collection_id}:observed_entity:${id}`,
    payload: {
      observation_id,
      entity_type: obs.entity_type,
      canonical_value: obs.value,
      stix_id: obs.stix_id,
    },
  });

  await pool.query(
    `INSERT INTO observed_entities
      (id, collection_id, observation_id, extraction_run_id, entity_type, canonical_value,
       stix_type, stix_id, confidence, ontology_version, provenance_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (observation_id) DO UPDATE SET
       confidence = COALESCE(EXCLUDED.confidence, observed_entities.confidence),
       stix_id = COALESCE(EXCLUDED.stix_id, observed_entities.stix_id)`,
    [
      id,
      collection_id,
      observation_id,
      opts.extraction_run_id,
      obs.entity_type,
      canonical_value,
      obs.stix_type,
      obs.stix_id,
      obs.confidence ?? null,
      ontology_version,
      entityProv.id,
    ],
  );

  if (opts.emit_event !== false) {
    try {
      await publishDomainEvent(pool, {
        event_type: 'entity.observed',
        aggregate_type: 'observed_entity',
        aggregate_id: id,
        collection_id,
        ontology_version,
        payload: {
          observation_id,
          entity_type: obs.entity_type,
          canonical_value: obs.value,
          stix_id: obs.stix_id,
        },
      });
    } catch {
      /* best-effort */
    }
  }

  const r = await pool.query(`SELECT * FROM observed_entities WHERE id = $1`, [id]);
  return r.rows[0] as ObservedEntity;
}

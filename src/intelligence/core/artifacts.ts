/**
 * Source artifacts — immutable provider payloads under a collection.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { CollectionObservation } from '../../collection/types.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';
import { insertProvenance } from './provenance.js';

export interface SourceArtifact {
  id: string;
  collection_id: string;
  connector_id: string;
  source_id: string;
  observable_type: string | null;
  uri: string | null;
  payload_hash: string;
  payload: Record<string, unknown>;
  fetch_metadata: Record<string, unknown>;
  ontology_version: string;
  provenance_id: string;
  created_at: string;
}

function artifactId(collectionId: string, connectorId: string, sourceId: string): string {
  const seed = `${collectionId}|${connectorId}|${sourceId}`;
  return `art_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

export function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

export async function upsertSourceArtifact(
  pool: Pool,
  opts: {
    collection_id: string;
    observation: CollectionObservation;
    uri?: string | null;
    fetch_metadata?: Record<string, unknown>;
  },
): Promise<SourceArtifact> {
  const { observation: obs, collection_id } = opts;
  const connector_id = obs.source;
  const source_id = obs.source_id;
  const id = artifactId(collection_id, connector_id, source_id);
  const payload = { ...(obs.raw || {}), stix_object: obs.stix_object };
  const payload_hash = hashPayload(payload);
  const ontology_version = obs.ontology_version || ACTIVE_ONTOLOGY_VERSION;

  const acquisition = await insertProvenance(pool, {
    collection_id,
    provenance_class: 'acquisition',
    subject_type: 'source_artifact',
    subject_id: id,
    collector_id: connector_id,
    ontology_version,
    id_seed: `${collection_id}:acquisition:${id}`,
    payload: {
      connector_id,
      source_id,
      observable_type: obs.observable_type,
      payload_hash,
    },
  });

  await pool.query(
    `INSERT INTO source_artifacts
      (id, collection_id, connector_id, source_id, observable_type, uri, payload_hash,
       payload, fetch_metadata, ontology_version, provenance_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
     ON CONFLICT (collection_id, connector_id, source_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       payload_hash = EXCLUDED.payload_hash,
       observable_type = COALESCE(EXCLUDED.observable_type, source_artifacts.observable_type),
       fetch_metadata = source_artifacts.fetch_metadata || EXCLUDED.fetch_metadata`,
    [
      id,
      collection_id,
      connector_id,
      source_id,
      obs.observable_type || null,
      opts.uri || null,
      payload_hash,
      JSON.stringify(payload),
      JSON.stringify(opts.fetch_metadata || {}),
      ontology_version,
      acquisition.id,
    ],
  );

  const r = await pool.query(`SELECT * FROM source_artifacts WHERE id = $1`, [id]);
  return r.rows[0] as SourceArtifact;
}

/**
 * Ontology registry — in-memory snapshot with optional Postgres hydration.
 */

import type { Pool } from 'pg';
import type { OntologySnapshot, StixTypeResolution } from './types.js';
import { ACTIVE_ONTOLOGY_VERSION } from './types.js';
import { buildOntologyV1Snapshot } from './v1-seed.js';
import { ONTOLOGY_SCHEMA_SQL } from './schema.js';

let cachedSnapshot: OntologySnapshot = buildOntologyV1Snapshot();

export function getOntologySnapshot(): OntologySnapshot {
  return cachedSnapshot;
}

export function setOntologySnapshot(snapshot: OntologySnapshot): void {
  cachedSnapshot = snapshot;
}

export function resetOntologySnapshot(): void {
  cachedSnapshot = buildOntologyV1Snapshot();
}

/** Resolve connector/extractor alias → canonical entity type id */
export function resolveEntityTypeId(alias: string): string {
  const key = alias.trim().toLowerCase();
  const snap = getOntologySnapshot();
  const direct = snap.entity_types.get(alias);
  if (direct) return direct.id;
  return snap.entity_aliases.get(key) || 'Asset';
}

/** Map entity type + value → STIX type (replaces hardcoded mapEntityToStixType). */
export function resolveStixType(entityTypeAlias: string, value: string): StixTypeResolution {
  const entity_type_id = resolveEntityTypeId(entityTypeAlias);
  const snap = getOntologySnapshot();
  const entity = snap.entity_types.get(entity_type_id);
  let stix_type = entity?.stix_type || 'x-collection-observable';
  if (entity_type_id === 'IpAddress' && value.includes(':')) {
    stix_type = 'ipv6-addr';
  }
  return {
    entity_type_id,
    stix_type,
    stix_identity_class: entity?.stix_identity_class || undefined,
  };
}

/** Infer observable type from connector + entity alias */
export function resolveObservableType(connectorId: string, entityTypeAlias: string): string {
  const snap = getOntologySnapshot();
  const connector = connectorId.toLowerCase();
  for (const [id, ot] of snap.observable_types) {
    if (ot.connector_ids.some((c) => connector.includes(c))) {
      const resolved = resolveEntityTypeId(entityTypeAlias);
      if (ot.entity_type_id === resolved) return id;
    }
  }
  return 'collection.observable';
}

/** Map free-text relation string → ontology relationship type id */
export function resolveRelationshipType(relation: string): string {
  const r = relation.toLowerCase();
  const snap = getOntologySnapshot();
  if (r.includes('resolve') || r.includes('points-to') || r.includes('a-record')) return 'resolves-to';
  if (r.includes('belong') || r.includes('member') || r.includes('asn')) return 'belongs-to';
  if (r.includes('own') || r.includes('registrant')) return 'owned-by';
  if (r.includes('discover') || r.includes('subdomain') || r.includes('host')) return 'discovers';
  if (r.includes('indicat')) return 'indicates';
  if (r.includes('issue') || r.includes('cert')) return 'issued-for';
  if (snap.relationship_types.has(r)) return r;
  return 'related-to';
}

export async function ensureOntologySchema(pool: Pool): Promise<void> {
  await pool.query(ONTOLOGY_SCHEMA_SQL);
}

export async function seedOntologyV1(pool: Pool): Promise<{ version: string; seeded: boolean }> {
  await ensureOntologySchema(pool);
  const version = ACTIVE_ONTOLOGY_VERSION;
  const existing = await pool.query(`SELECT id FROM ontology_versions WHERE id = $1`, [version]);
  if (existing.rowCount && existing.rowCount > 0) {
    await hydrateOntologyFromPool(pool, version);
    return { version, seeded: false };
  }

  const snap = buildOntologyV1Snapshot();
  await pool.query(
    `INSERT INTO ontology_versions (id, status, activated_at) VALUES ($1, 'active', NOW())`,
    [version],
  );

  for (const et of snap.entity_types.values()) {
    await pool.query(
      `INSERT INTO ontology_entity_types
        (version_id, id, label, stix_type, stix_identity_class, identifiers)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [version, et.id, et.label, et.stix_type, et.stix_identity_class, JSON.stringify(et.identifiers)],
    );
  }

  for (const [alias, entity_type_id] of snap.entity_aliases) {
    await pool.query(
      `INSERT INTO ontology_entity_aliases (version_id, alias, entity_type_id) VALUES ($1,$2,$3)`,
      [version, alias, entity_type_id],
    );
  }

  for (const ot of snap.observable_types.values()) {
    await pool.query(
      `INSERT INTO ontology_observable_types (version_id, id, entity_type_id, connector_ids)
       VALUES ($1,$2,$3,$4)`,
      [version, ot.id, ot.entity_type_id, ot.connector_ids],
    );
  }

  for (const rt of snap.relationship_types.values()) {
    await pool.query(
      `INSERT INTO ontology_relationship_types
        (version_id, id, label, source_entity_types, target_entity_types, stix_mapping, origins_allowed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        version,
        rt.id,
        rt.label,
        rt.source_entity_types,
        rt.target_entity_types,
        rt.stix_mapping,
        rt.origins_allowed,
      ],
    );
  }

  for (const kt of snap.knowledge_types.values()) {
    await pool.query(
      `INSERT INTO ontology_knowledge_types (version_id, id, label) VALUES ($1,$2,$3)`,
      [version, kt.id, kt.label],
    );
  }

  setOntologySnapshot(snap);
  return { version, seeded: true };
}

export async function hydrateOntologyFromPool(
  pool: Pool,
  version: string = ACTIVE_ONTOLOGY_VERSION,
): Promise<OntologySnapshot> {
  await ensureOntologySchema(pool);

  const entity_types = new Map<string, import('./types.js').OntologyEntityType>();
  const entity_aliases = new Map<string, string>();
  const observable_types = new Map<string, import('./types.js').OntologyObservableType>();
  const relationship_types = new Map<string, import('./types.js').OntologyRelationshipType>();
  const knowledge_types = new Map<string, import('./types.js').OntologyKnowledgeType>();

  const ets = await pool.query(`SELECT * FROM ontology_entity_types WHERE version_id = $1`, [version]);
  for (const row of ets.rows) {
    entity_types.set(row.id, {
      id: row.id,
      label: row.label,
      stix_type: row.stix_type,
      stix_identity_class: row.stix_identity_class,
      identifiers: row.identifiers || [],
    });
  }

  const aliases = await pool.query(`SELECT * FROM ontology_entity_aliases WHERE version_id = $1`, [version]);
  for (const row of aliases.rows) {
    entity_aliases.set(row.alias, row.entity_type_id);
  }

  const obs = await pool.query(`SELECT * FROM ontology_observable_types WHERE version_id = $1`, [version]);
  for (const row of obs.rows) {
    observable_types.set(row.id, {
      id: row.id,
      entity_type_id: row.entity_type_id,
      connector_ids: row.connector_ids || [],
    });
  }

  const rels = await pool.query(`SELECT * FROM ontology_relationship_types WHERE version_id = $1`, [version]);
  for (const row of rels.rows) {
    relationship_types.set(row.id, {
      id: row.id,
      label: row.label,
      source_entity_types: row.source_entity_types || [],
      target_entity_types: row.target_entity_types || [],
      stix_mapping: row.stix_mapping || 'related-to',
      origins_allowed: row.origins_allowed || ['observed'],
    });
  }

  const know = await pool.query(`SELECT * FROM ontology_knowledge_types WHERE version_id = $1`, [version]);
  for (const row of know.rows) {
    knowledge_types.set(row.id, { id: row.id, label: row.label });
  }

  if (entity_types.size === 0) {
    return buildOntologyV1Snapshot();
  }

  const snapshot: OntologySnapshot = {
    version,
    entity_types,
    entity_aliases,
    observable_types,
    relationship_types,
    knowledge_types,
  };
  setOntologySnapshot(snapshot);
  return snapshot;
}

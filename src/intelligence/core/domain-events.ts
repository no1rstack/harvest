/**
 * Domain events — CQRS event stream for Intelligence Core capabilities.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import { ACTIVE_ONTOLOGY_VERSION } from '../ontology/types.js';

export type DomainEventType =
  | 'collection.started'
  | 'collection.completed'
  | 'collection.completed_with_warnings'
  | 'collection.failed'
  | 'observation.created'
  | 'relationship.added'
  | 'entity.resolved'
  | 'claim.updated';

export interface DomainEvent {
  id: string;
  event_type: DomainEventType | string;
  aggregate_type: string;
  aggregate_id: string;
  collection_id: string | null;
  ontology_version: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function publishDomainEvent(
  pool: Pool,
  opts: {
    event_type: DomainEventType | string;
    aggregate_type: string;
    aggregate_id: string;
    collection_id?: string | null;
    ontology_version?: string;
    payload?: Record<string, unknown>;
  },
): Promise<DomainEvent> {
  const id = `dev_${crypto.randomBytes(12).toString('hex')}`;
  const payload = opts.payload || {};
  const ontology_version = opts.ontology_version || ACTIVE_ONTOLOGY_VERSION;

  await pool.query(
    `INSERT INTO domain_events
      (id, event_type, aggregate_type, aggregate_id, collection_id, ontology_version, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id,
      opts.event_type,
      opts.aggregate_type,
      opts.aggregate_id,
      opts.collection_id ?? null,
      ontology_version,
      JSON.stringify(payload),
    ],
  );

  return {
    id,
    event_type: opts.event_type,
    aggregate_type: opts.aggregate_type,
    aggregate_id: opts.aggregate_id,
    collection_id: opts.collection_id ?? null,
    ontology_version,
    payload,
    created_at: new Date().toISOString(),
  };
}

export async function listDomainEvents(
  pool: Pool,
  opts: {
    collection_id?: string;
    event_type?: string;
    aggregate_type?: string;
    limit?: number;
  } = {},
): Promise<DomainEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.collection_id) {
    params.push(opts.collection_id);
    where.push(`collection_id = $${params.length}`);
  }
  if (opts.event_type) {
    params.push(opts.event_type);
    where.push(`event_type = $${params.length}`);
  }
  if (opts.aggregate_type) {
    params.push(opts.aggregate_type);
    where.push(`aggregate_type = $${params.length}`);
  }

  params.push(Math.min(opts.limit ?? 50, 500));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM domain_events ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows as DomainEvent[];
}

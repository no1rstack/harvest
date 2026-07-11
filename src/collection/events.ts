/**
 * Publish collection lifecycle events (+ domain event stream).
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { CollectionPublishedEvent } from './types.js';
import { publishDomainEvent } from '../intelligence/core/domain-events.js';

export type CollectionEventType =
  | 'collection.requested'
  | 'collection.started'
  | 'collection.connector.completed'
  | 'collection.connector.failed'
  | 'observation.persisted'
  | 'collection.completed'
  | 'collection.completed_with_warnings'
  | 'collection.failed'
  | 'TargetRegistered';

export async function publishCollectionEvent(
  pool: Pool,
  opts: {
    event_type: CollectionEventType | string;
    target_id?: string | null;
    run_id?: string | null;
    cascades_run_id?: string | null;
    request_id?: string | null;
    collection_id?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<CollectionPublishedEvent> {
  const id = `cev_${crypto.randomBytes(12).toString('hex')}`;
  const payload = opts.payload || {};
  const collectionId = opts.collection_id ?? opts.run_id ?? opts.cascades_run_id ?? null;
  await pool.query(
    `INSERT INTO collection_events (id, event_type, target_id, run_id, cascades_run_id, request_id, payload, collection_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      id,
      opts.event_type,
      opts.target_id ?? null,
      opts.run_id ?? opts.cascades_run_id ?? null,
      opts.cascades_run_id ?? opts.run_id ?? null,
      opts.request_id ?? null,
      JSON.stringify(payload),
      collectionId,
    ],
  );

  const aggregateType =
    opts.event_type.startsWith('observation.') ? 'observation' : 'collection';
  try {
    await publishDomainEvent(pool, {
      event_type: opts.event_type,
      aggregate_type: aggregateType,
      aggregate_id: collectionId || id,
      collection_id: collectionId,
      payload: { ...payload, collection_event_id: id },
    });
  } catch {
    /* domain_events table may not exist until Phase 0 bootstrap */
  }

  return {
    id,
    event_type: opts.event_type,
    target_id: opts.target_id ?? null,
    run_id: opts.run_id ?? opts.cascades_run_id ?? null,
    cascades_run_id: opts.cascades_run_id ?? opts.run_id ?? null,
    payload,
    created_at: new Date().toISOString(),
  };
}

export async function listCollectionEvents(
  pool: Pool,
  opts: { target_id?: string; run_id?: string; cascades_run_id?: string; limit?: number } = {},
): Promise<CollectionPublishedEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.target_id) {
    params.push(opts.target_id);
    where.push(`target_id = $${params.length}`);
  }
  if (opts.run_id) {
    params.push(opts.run_id);
    where.push(`(run_id = $${params.length} OR cascades_run_id = $${params.length})`);
  }
  if (opts.cascades_run_id) {
    params.push(opts.cascades_run_id);
    where.push(`cascades_run_id = $${params.length}`);
  }
  params.push(Math.min(opts.limit ?? 50, 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM collection_events ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows as CollectionPublishedEvent[];
}

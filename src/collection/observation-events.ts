/**
 * Immutable Observation Events — state is a projection.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { CollectionObservation } from './types.js';

export const OBSERVATION_EVENT_TYPES = [
  'observation.created',
  'observation.updated',
  'observation.expired',
  'observation.validated',
  'observation.published',
] as const;

export type ObservationEventType = (typeof OBSERVATION_EVENT_TYPES)[number];

export interface ObservationEvent {
  id: string;
  event_type: ObservationEventType;
  observation_id: string;
  stix_id: string;
  target_id: string | null;
  workflow_run_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export const OBSERVATION_EVENTS_SQL = `
CREATE TABLE IF NOT EXISTS observation_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  stix_id TEXT,
  target_id UUID,
  workflow_run_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_observation_events_obs ON observation_events(observation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observation_events_stix ON observation_events(stix_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observation_events_type ON observation_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observation_events_run ON observation_events(workflow_run_id);

CREATE TABLE IF NOT EXISTS observation_projections (
  observation_id TEXT PRIMARY KEY,
  stix_id TEXT NOT NULL,
  target_id UUID,
  entity_type TEXT NOT NULL,
  value TEXT NOT NULL,
  current_state TEXT NOT NULL DEFAULT 'active',
  confidence REAL,
  last_event_type TEXT NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  projection JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obs_projection_value ON observation_projections(value);
CREATE INDEX IF NOT EXISTS idx_obs_projection_target ON observation_projections(target_id);
`;

export async function ensureObservationEventSchema(pool: Pool): Promise<void> {
  await pool.query(OBSERVATION_EVENTS_SQL);
}

export async function appendObservationEvent(
  pool: Pool,
  opts: {
    event_type: ObservationEventType;
    observation_id: string;
    stix_id: string;
    target_id?: string | null;
    workflow_run_id?: string | null;
    payload?: Record<string, unknown>;
    observation?: Partial<CollectionObservation>;
  },
): Promise<ObservationEvent> {
  await ensureObservationEventSchema(pool);

  const id = `oev_${crypto.randomBytes(12).toString('hex')}`;
  const payload = {
    ...(opts.payload || {}),
    ...(opts.observation
      ? {
          entity_type: opts.observation.entity_type,
          value: opts.observation.value,
          source: opts.observation.source,
          confidence: opts.observation.confidence,
        }
      : {}),
  };

  await pool.query(
    `INSERT INTO observation_events
      (id, event_type, observation_id, stix_id, target_id, workflow_run_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      id,
      opts.event_type,
      opts.observation_id,
      opts.stix_id,
      opts.target_id ?? null,
      opts.workflow_run_id ?? null,
      JSON.stringify(payload),
    ],
  );

  if (opts.observation && opts.event_type !== 'observation.expired') {
    const state =
      opts.event_type === 'observation.validated'
        ? 'validated'
        : opts.event_type === 'observation.published'
          ? 'published'
          : 'active';

    await pool.query(
      `INSERT INTO observation_projections
        (observation_id, stix_id, target_id, entity_type, value, current_state, confidence,
         last_event_type, last_event_at, projection, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9::jsonb,NOW())
       ON CONFLICT (observation_id) DO UPDATE SET
         current_state = EXCLUDED.current_state,
         confidence = COALESCE(EXCLUDED.confidence, observation_projections.confidence),
         last_event_type = EXCLUDED.last_event_type,
         last_event_at = NOW(),
         projection = observation_projections.projection || EXCLUDED.projection,
         updated_at = NOW()`,
      [
        opts.observation_id,
        opts.stix_id,
        opts.target_id ?? null,
        opts.observation.entity_type || 'unknown',
        opts.observation.value || '',
        state,
        opts.observation.confidence ?? null,
        opts.event_type,
        JSON.stringify({
          title: opts.observation.title,
          tags: opts.observation.tags,
          provenance: opts.observation.provenance,
        }),
      ],
    );
  }

  return {
    id,
    event_type: opts.event_type,
    observation_id: opts.observation_id,
    stix_id: opts.stix_id,
    target_id: opts.target_id ?? null,
    workflow_run_id: opts.workflow_run_id ?? null,
    payload,
    created_at: new Date().toISOString(),
  };
}

export async function listObservationEvents(
  pool: Pool,
  opts: {
    observation_id?: string;
    stix_id?: string;
    workflow_run_id?: string;
    event_type?: string;
    limit?: number;
  } = {},
): Promise<ObservationEvent[]> {
  await ensureObservationEventSchema(pool);
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.observation_id) {
    params.push(opts.observation_id);
    where.push(`observation_id = $${params.length}`);
  }
  if (opts.stix_id) {
    params.push(opts.stix_id);
    where.push(`stix_id = $${params.length}`);
  }
  if (opts.workflow_run_id) {
    params.push(opts.workflow_run_id);
    where.push(`workflow_run_id = $${params.length}`);
  }
  if (opts.event_type) {
    params.push(opts.event_type);
    where.push(`event_type = $${params.length}`);
  }

  params.push(Math.min(opts.limit ?? 100, 500));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(
    `SELECT * FROM observation_events ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows as ObservationEvent[];
}

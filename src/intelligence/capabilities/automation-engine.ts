/**
 * Automation Engine — react to domain events with registered rules.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { DomainEvent } from '../core/domain-events.js';
import {
  synthesizeCollectionSummary,
  synthesizeNetwork,
  synthesizeProfile,
} from './knowledge-engine.js';
import { resolveIdentityForCollection } from './identity-engine.js';
import { resolveIdentityGraphV2 } from './identity-engine-v2.js';

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  event_type: string;
  event_filter: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
}

const DEFAULT_RULES: Omit<AutomationRule, 'id'>[] = [
  {
    name: 'Collection completed → summary',
    enabled: true,
    event_type: 'collection.completed',
    event_filter: {},
    action_type: 'synthesize_knowledge',
    action_config: { kind: 'collection_summary' },
  },
  {
    name: 'Collection completed (warnings) → summary',
    enabled: true,
    event_type: 'collection.completed_with_warnings',
    event_filter: {},
    action_type: 'synthesize_knowledge',
    action_config: { kind: 'collection_summary' },
  },
  {
    name: 'Collection completed → identity resolution',
    enabled: true,
    event_type: 'collection.completed',
    event_filter: {},
    action_type: 'resolve_identity',
    action_config: {},
  },
  {
    name: 'Collection completed (warnings) → identity',
    enabled: true,
    event_type: 'collection.completed_with_warnings',
    event_filter: {},
    action_type: 'resolve_identity',
    action_config: {},
  },
  {
    name: 'Entity resolved → profile',
    enabled: true,
    event_type: 'entity.resolved',
    event_filter: {},
    action_type: 'synthesize_knowledge',
    action_config: { kind: 'profile' },
  },
  {
    name: 'Collection completed → graph identity v2',
    enabled: true,
    event_type: 'collection.completed',
    event_filter: {},
    action_type: 'resolve_identity_v2',
    action_config: {},
  },
  {
    name: 'Collection completed → start related collection',
    enabled: false,
    event_type: 'entity.resolved',
    event_filter: {},
    action_type: 'start_collection',
    action_config: { mode: 'discovery' },
  },
];

export async function ensureAutomationRules(pool: Pool): Promise<number> {
  let seeded = 0;
  for (const rule of DEFAULT_RULES) {
    const id = `arule_${crypto.createHash('sha256').update(rule.name).digest('hex').slice(0, 16)}`;
    const r = await pool.query(
      `INSERT INTO automation_rules (id, name, enabled, event_type, event_filter, action_type, action_config)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        id,
        rule.name,
        rule.enabled,
        rule.event_type,
        JSON.stringify(rule.event_filter),
        rule.action_type,
        JSON.stringify(rule.action_config),
      ],
    );
    if (r.rowCount) seeded++;
  }
  return seeded;
}

function matchesFilter(event: DomainEvent, filter: Record<string, unknown>): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (event.payload[k] !== v && (event as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

export async function processAutomationEvent(
  pool: Pool,
  event: DomainEvent,
): Promise<Array<{ rule_id: string; status: string; result: Record<string, unknown> }>> {
  const rules = await pool.query(
    `SELECT * FROM automation_rules WHERE enabled = TRUE AND event_type = $1`,
    [event.event_type],
  );

  const outcomes: Array<{ rule_id: string; status: string; result: Record<string, unknown> }> = [];

  for (const rule of rules.rows as AutomationRule[]) {
    if (!matchesFilter(event, rule.event_filter)) continue;

    const runId = `arun_${crypto.randomBytes(8).toString('hex')}`;
    let status = 'completed';
    let result: Record<string, unknown> = {};

    try {
      if (rule.action_type === 'synthesize_knowledge') {
        const kind = String(rule.action_config.kind || 'collection_summary');
        const collectionId = event.collection_id || event.aggregate_id;

        if (kind === 'collection_summary' && collectionId) {
          const ko = await synthesizeCollectionSummary(pool, collectionId);
          result = { knowledge_object_id: ko.id, kind };
        } else if (kind === 'network') {
          const anchor = String(event.payload.target_value || event.payload.canonical_name || '');
          if (anchor) {
            const ko = await synthesizeNetwork(pool, {
              anchor_value: anchor,
              collection_id: event.collection_id,
            });
            result = { knowledge_object_id: ko.id, kind };
          }
        } else if (kind === 'profile') {
          const anchor = String(
            event.payload.canonical_name || event.payload.anchor_value || event.payload.target_value || '',
          );
          if (anchor) {
            const ko = await synthesizeProfile(pool, {
              anchor_value: anchor,
              collection_id: event.collection_id,
            });
            result = ko ? { knowledge_object_id: ko.id, kind } : { skipped: true, reason: 'no resolved entity' };
          }
        }
      } else if (rule.action_type === 'resolve_identity') {
        const collectionId = event.collection_id || event.aggregate_id;
        const anchor = event.payload.target_value ? String(event.payload.target_value) : undefined;
        if (collectionId) {
          const resolution = await resolveIdentityForCollection(pool, {
            source_collection_id: collectionId,
            anchor_value: anchor,
          });
          result = { resolution };
        }
      } else if (rule.action_type === 'resolve_identity_v2') {
        const collectionId = event.collection_id || event.aggregate_id;
        const anchor = event.payload.target_value ? String(event.payload.target_value) : undefined;
        if (collectionId && anchor) {
          const v2 = await resolveIdentityGraphV2(pool, {
            source_collection_id: collectionId,
            anchor_value: anchor,
          });
          result = { resolution_v2: v2 };
        }
      } else if (rule.action_type === 'start_collection') {
        const anchor = String(event.payload.canonical_name || event.payload.target_value || event.payload.value || '').toLowerCase();
        if (anchor) {
          const row = await pool.query(
            `SELECT id FROM collection_targets WHERE normalized_value = $1 AND enabled = TRUE LIMIT 1`,
            [anchor],
          );
          if (row.rowCount) {
            const { getTarget } = await import('../../collection/targetRegistry.js');
            const target = await getTarget(pool, row.rows[0].id);
            if (target) {
              const { submitTargetToCascades } = await import('../../collection/submitDue.js');
              const submission = await submitTargetToCascades(pool, target, {
                force: true,
                actor: 'automation-engine',
              });
              result = { submission };
            }
          } else {
            result = { skipped: true, reason: 'target not in registry', anchor };
          }
        }
      } else {
        status = 'skipped';
        result = { reason: `unknown action_type: ${rule.action_type}` };
      }
    } catch (err) {
      status = 'failed';
      result = { error: (err as Error).message };
    }

    await pool.query(
      `INSERT INTO automation_runs (id, rule_id, event_id, status, result)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [runId, rule.id, event.id, status, JSON.stringify(result)],
    );

    outcomes.push({ rule_id: rule.id, status, result });
  }

  return outcomes;
}

/** Run automation for the latest collection.completed event of a collection. */
export async function runAutomationForCollection(
  pool: Pool,
  collectionId: string,
  payload: Record<string, unknown> = {},
): Promise<Array<{ rule_id: string; status: string; result: Record<string, unknown> }>> {
  await ensureAutomationRules(pool);
  const eventType =
    payload.terminal_status === 'completed_with_warnings'
      ? 'collection.completed_with_warnings'
      : 'collection.completed';

  const event: DomainEvent = {
    id: `synthetic_${collectionId}`,
    event_type: eventType,
    aggregate_type: 'collection',
    aggregate_id: collectionId,
    collection_id: collectionId,
    ontology_version: '1.0.0',
    payload,
    created_at: new Date().toISOString(),
  };
  return processAutomationEvent(pool, event);
}

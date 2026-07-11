/**
 * Collection Policies — reusable schedule plans per workflow template.
 * Replaces flat per-target frequency with intelligent, template-aware cadence.
 */

export type CollectionScheduleMode =
  | 'interval'
  | 'cron'
  | 'webhook'
  | 'continuous'
  | 'incremental'
  | 'manual';

export interface CollectionPolicyDefinition {
  id: string;
  name: string;
  workflow_template: string;
  schedule_mode: CollectionScheduleMode;
  /** interval: hourly|daily|weekly|monthly|15m|6h — cron: expression — webhook/continuous/incremental: trigger label */
  schedule_value: string;
  default_profile: string;
  description: string;
}

export const COLLECTION_POLICIES: Record<string, CollectionPolicyDefinition> = {
  'passive-domain-hourly': {
    id: 'passive-domain-hourly',
    name: 'Passive Domain — Hourly',
    workflow_template: 'passive-domain-collection',
    schedule_mode: 'interval',
    schedule_value: 'hourly',
    default_profile: 'minimal',
    description: 'Lightweight domain sweep every hour.',
  },
  'passive-domain-daily': {
    id: 'passive-domain-daily',
    name: 'Passive Domain — Daily',
    workflow_template: 'passive-domain-collection',
    schedule_mode: 'interval',
    schedule_value: 'daily',
    default_profile: 'standard',
    description: 'Standard passive domain collection once per day.',
  },
  'threat-feed-15m': {
    id: 'threat-feed-15m',
    name: 'Threat Feed — 15 minutes',
    workflow_template: 'threat-feed-sync',
    schedule_mode: 'interval',
    schedule_value: '15m',
    default_profile: 'standard',
    description: 'High-frequency threat indicator polling.',
  },
  'organization-weekly': {
    id: 'organization-weekly',
    name: 'Organization — Weekly',
    workflow_template: 'organization-enrichment',
    schedule_mode: 'interval',
    schedule_value: 'weekly',
    default_profile: 'deep',
    description: 'Weekly org structure and affiliation refresh.',
  },
  'social-identity-monthly': {
    id: 'social-identity-monthly',
    name: 'Social Identity — Monthly',
    workflow_template: 'social-identity-watch',
    schedule_mode: 'interval',
    schedule_value: 'monthly',
    default_profile: 'standard',
    description: 'Monthly social footprint check.',
  },
  'certificate-6h': {
    id: 'certificate-6h',
    name: 'Certificate — Every 6 hours',
    workflow_template: 'certificate-monitor',
    schedule_mode: 'interval',
    schedule_value: '6h',
    default_profile: 'minimal',
    description: 'Certificate transparency and expiry monitoring.',
  },
  'github-webhook': {
    id: 'github-webhook',
    name: 'GitHub — On webhook',
    workflow_template: 'github-repo-watch',
    schedule_mode: 'webhook',
    schedule_value: 'github.push',
    default_profile: 'standard',
    description: 'Triggered by GitHub repository events.',
  },
  'rss-continuous': {
    id: 'rss-continuous',
    name: 'RSS — Continuous',
    workflow_template: 'rss-stream',
    schedule_mode: 'continuous',
    schedule_value: 'stream',
    default_profile: 'minimal',
    description: 'Continuous RSS/feed ingestion loop.',
  },
  'misp-incremental': {
    id: 'misp-incremental',
    name: 'MISP — Incremental sync',
    workflow_template: 'misp-sync',
    schedule_mode: 'incremental',
    schedule_value: 'misp.delta',
    default_profile: 'standard',
    description: 'Incremental MISP event synchronization.',
  },
  'opencti-incremental': {
    id: 'opencti-incremental',
    name: 'OpenCTI — Incremental sync',
    workflow_template: 'opencti-sync',
    schedule_mode: 'incremental',
    schedule_value: 'opencti.delta',
    default_profile: 'standard',
    description: 'Incremental OpenCTI knowledge sync.',
  },
};

const INTERVAL_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function listCollectionPolicies(): CollectionPolicyDefinition[] {
  return Object.values(COLLECTION_POLICIES);
}

export function getCollectionPolicy(id: string): CollectionPolicyDefinition | undefined {
  return COLLECTION_POLICIES[id];
}

import { normalizeWorkflowId } from './workflow-catalog.js';

/** Default policy for a workflow template when target has no explicit policy. */
export function defaultPolicyForTemplate(workflowTemplate: string): CollectionPolicyDefinition {
  const wf = normalizeWorkflowId(workflowTemplate);
  const match = Object.values(COLLECTION_POLICIES).find(
    (p) => normalizeWorkflowId(p.workflow_template) === wf,
  );
  return match || COLLECTION_POLICIES['passive-domain-daily'];
}

export function resolveTargetPolicy(target: {
  collection_policy?: string | null;
  workflow_template: string;
  frequency?: string;
}): CollectionPolicyDefinition {
  if (target.collection_policy && COLLECTION_POLICIES[target.collection_policy]) {
    return COLLECTION_POLICIES[target.collection_policy];
  }
  // Legacy frequency → policy mapping
  const freq = target.frequency || 'daily';
  const wf = normalizeWorkflowId(target.workflow_template);
  if (wf === 'passive-domain') {
    if (freq === 'hourly') return COLLECTION_POLICIES['passive-domain-hourly'];
    if (freq === 'weekly') return COLLECTION_POLICIES['organization-weekly'];
    return COLLECTION_POLICIES['passive-domain-daily'];
  }
  return defaultPolicyForTemplate(target.workflow_template);
}

/** Whether a target should appear in time-based due queries. */
export function isTimeScheduledPolicy(policy: CollectionPolicyDefinition): boolean {
  return policy.schedule_mode === 'interval' || policy.schedule_mode === 'cron';
}

export function nextCollectAtForPolicy(
  policy: CollectionPolicyDefinition,
  from = new Date(),
): Date | null {
  if (policy.schedule_mode === 'manual' || policy.schedule_mode === 'webhook') return null;
  if (policy.schedule_mode === 'continuous' || policy.schedule_mode === 'incremental') return null;

  if (policy.schedule_mode === 'interval') {
    const ms = INTERVAL_MS[policy.schedule_value];
    if (!ms) return null;
    return new Date(from.getTime() + ms);
  }
  // cron: defer to external scheduler — mark null (always due when polled by dedicated worker)
  return null;
}

/** Policies eligible for time-based due-target polling. */
export const TIME_SCHEDULED_POLICY_IDS = Object.values(COLLECTION_POLICIES)
  .filter((p) => p.schedule_mode === 'interval' || p.schedule_mode === 'cron')
  .map((p) => p.id);

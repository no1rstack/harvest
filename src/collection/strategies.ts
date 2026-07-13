/**
 * Collection Strategies — richer than plans or policies alone.
 * A strategy owns workflow, profile, policy, stopping conditions, priority, and escalation.
 */

import type { CollectionCapability } from './capabilities.js';
import { profileCapabilities } from './profiles.js';
import { getCatalogWorkflow, normalizeWorkflowId } from './workflow-catalog.js';
import { resolveTargetPolicy } from './policies.js';

export interface StoppingConditions {
  max_targets?: number;
  max_depth?: number;
  max_observations?: number;
  budget_ms?: number;
  stop_on_no_new_discoveries?: boolean;
}

export interface EscalationRules {
  /** Strategy id to apply on collection failure */
  on_failure?: string;
  /** Strategy id when high-confidence discoveries exceed threshold */
  on_high_value?: string;
  /** Profile to escalate to when depth budget allows */
  deepen_to_profile?: string;
}

export interface CollectionStrategyDefinition {
  id: string;
  name: string;
  description: string;
  workflow_template: string;
  profile: string;
  policy: string;
  priority: number;
  stopping_conditions?: StoppingConditions;
  escalation?: EscalationRules;
  /** Enable automatic discovery fan-out after collection */
  auto_discover: boolean;
  enabled: boolean;
}

export const COLLECTION_STRATEGIES: Record<string, CollectionStrategyDefinition> = {
  'passive-domain-standard': {
    id: 'passive-domain-standard',
    name: 'Passive Domain — Standard',
    description: 'Daily internet presence sweep with standard depth.',
    workflow_template: 'passive-domain',
    profile: 'standard',
    policy: 'passive-domain-daily',
    priority: 50,
    auto_discover: true,
    enabled: true,
    stopping_conditions: { max_depth: 2, stop_on_no_new_discoveries: true },
    escalation: { on_failure: 'passive-domain-minimal', deepen_to_profile: 'deep' },
  },
  'passive-domain-minimal': {
    id: 'passive-domain-minimal',
    name: 'Passive Domain — Minimal',
    description: 'Hourly lightweight presence check.',
    workflow_template: 'passive-domain',
    profile: 'minimal',
    policy: 'passive-domain-hourly',
    priority: 40,
    auto_discover: false,
    enabled: true,
  },
  'passive-domain-deep': {
    id: 'passive-domain-deep',
    name: 'Passive Domain — Deep',
    description: 'Deep infrastructure and identity context.',
    workflow_template: 'passive-domain',
    profile: 'deep',
    policy: 'passive-domain-daily',
    priority: 60,
    auto_discover: true,
    enabled: true,
    stopping_conditions: { max_depth: 3, max_targets: 500 },
    escalation: { on_high_value: 'passive-domain-forensic' },
  },
  'passive-domain-forensic': {
    id: 'passive-domain-forensic',
    name: 'Passive Domain — Forensic',
    description: 'Maximum depth for investigations.',
    workflow_template: 'passive-domain',
    profile: 'forensic',
    policy: 'passive-domain-daily',
    priority: 80,
    auto_discover: true,
    enabled: true,
    stopping_conditions: { max_depth: 4, max_targets: 2000 },
  },
  'osint-investigation-standard': {
    id: 'osint-investigation-standard',
    name: 'OSINT Investigation — Standard',
    description: 'ENNA methodology: scoped passive recon with correlation and report.',
    workflow_template: 'osint-investigation',
    profile: 'deep',
    policy: 'passive-domain-daily',
    priority: 75,
    auto_discover: true,
    enabled: true,
    stopping_conditions: { max_depth: 3, max_targets: 100 },
    escalation: { on_failure: 'passive-domain-minimal' },
  },
  'passive-ip-standard': {
    id: 'passive-ip-standard',
    name: 'Passive IP — Standard',
    workflow_template: 'passive-ip',
    profile: 'standard',
    policy: 'passive-domain-daily',
    priority: 50,
    auto_discover: true,
    enabled: true,
    description: 'Infrastructure topology for IP assets.',
  },
  'organization-deep': {
    id: 'organization-deep',
    name: 'Organization — Deep',
    workflow_template: 'organization',
    profile: 'deep',
    policy: 'organization-weekly',
    priority: 55,
    auto_discover: true,
    enabled: true,
    description: 'Weekly org enrichment with domain fan-out.',
    stopping_conditions: { max_depth: 3 },
  },
  'identity-standard': {
    id: 'identity-standard',
    name: 'Identity — Standard',
    workflow_template: 'identity',
    profile: 'standard',
    policy: 'social-identity-monthly',
    priority: 45,
    auto_discover: true,
    enabled: true,
    description: 'Social identity watch with child Collection fan-out.',
    stopping_conditions: { max_depth: 2, max_targets: 200, stop_on_no_new_discoveries: true },
  },
  'identity-deep': {
    id: 'identity-deep',
    name: 'Identity — Deep (universal seed)',
    workflow_template: 'identity',
    profile: 'deep',
    policy: 'social-identity-monthly',
    priority: 70,
    auto_discover: true,
    enabled: true,
    description:
      'Every word/entity is a Collection: Holehe/Sherlock/Maigret + recursive discover→enqueue.',
    stopping_conditions: {
      max_depth: 4,
      max_targets: 500,
      stop_on_no_new_discoveries: true,
      budget_ms: 600_000,
    },
    escalation: { deepen_to_profile: 'forensic' },
  },
  'threat-feed-standard': {
    id: 'threat-feed-standard',
    name: 'Threat Feed — Standard',
    workflow_template: 'threat-feed',
    profile: 'standard',
    policy: 'threat-feed-15m',
    priority: 70,
    auto_discover: false,
    enabled: true,
    description: 'High-frequency threat indicator polling.',
  },
  'certificate-minimal': {
    id: 'certificate-minimal',
    name: 'Certificate — Minimal',
    workflow_template: 'certificate',
    profile: 'minimal',
    policy: 'certificate-6h',
    priority: 50,
    auto_discover: true,
    enabled: true,
    description: 'Certificate transparency monitoring every 6 hours.',
  },
  'cloud-asset-deep': {
    id: 'cloud-asset-deep',
    name: 'Cloud Asset — Deep',
    workflow_template: 'cloud-asset',
    profile: 'deep',
    policy: 'passive-domain-daily',
    priority: 55,
    auto_discover: true,
    enabled: true,
    description: 'Cloud exposure and cert monitoring.',
  },
  'document-standard': {
    id: 'document-standard',
    name: 'Document — Standard',
    workflow_template: 'document',
    profile: 'standard',
    policy: 'passive-domain-daily',
    priority: 40,
    auto_discover: false,
    enabled: true,
    description: 'Historical document intelligence.',
  },
};

export function listCollectionStrategies(): CollectionStrategyDefinition[] {
  return Object.values(COLLECTION_STRATEGIES).filter((s) => s.enabled);
}

export function getCollectionStrategy(id: string): CollectionStrategyDefinition | undefined {
  return COLLECTION_STRATEGIES[id];
}

export function defaultStrategyForWorkflow(workflowId: string): CollectionStrategyDefinition {
  const entry = getCatalogWorkflow(workflowId);
  if (entry && COLLECTION_STRATEGIES[entry.default_strategy]) {
    return COLLECTION_STRATEGIES[entry.default_strategy];
  }
  const normalized = normalizeWorkflowId(workflowId);
  const match = Object.values(COLLECTION_STRATEGIES).find(
    (s) => normalizeWorkflowId(s.workflow_template) === normalized,
  );
  return match || COLLECTION_STRATEGIES['passive-domain-standard'];
}

export function resolveTargetStrategy(target: {
  collection_strategy?: string | null;
  collection_profile?: string | null;
  collection_policy?: string | null;
  workflow_template: string;
  priority?: number;
}): CollectionStrategyDefinition {
  if (target.collection_strategy && COLLECTION_STRATEGIES[target.collection_strategy]) {
    return COLLECTION_STRATEGIES[target.collection_strategy];
  }

  const policy = resolveTargetPolicy(target);
  const wf = normalizeWorkflowId(target.workflow_template);
  const match = Object.values(COLLECTION_STRATEGIES).find(
    (s) =>
      normalizeWorkflowId(s.workflow_template) === wf &&
      s.policy === policy.id &&
      s.profile === (target.collection_profile || policy.default_profile),
  );
  if (match) return match;

  const catalogDefault = getCatalogWorkflow(wf);
  if (catalogDefault && COLLECTION_STRATEGIES[catalogDefault.default_strategy]) {
    return COLLECTION_STRATEGIES[catalogDefault.default_strategy];
  }

  return defaultStrategyForWorkflow(wf);
}

export function strategyExecutionContext(strategy: CollectionStrategyDefinition): {
  workflow_template: string;
  cascades_workflow_id: string;
  profile: string;
  policy: string;
  priority: number;
  capabilities: CollectionCapability[];
  auto_discover: boolean;
  stopping_conditions?: StoppingConditions;
} {
  const entry = getCatalogWorkflow(strategy.workflow_template);
  return {
    workflow_template: strategy.workflow_template,
    cascades_workflow_id: entry?.cascades_workflow_id || strategy.workflow_template,
    profile: strategy.profile,
    policy: strategy.policy,
    priority: strategy.priority,
    capabilities: profileCapabilities(strategy.profile),
    auto_discover: strategy.auto_discover,
    stopping_conditions: strategy.stopping_conditions,
  };
}

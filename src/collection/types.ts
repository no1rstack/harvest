/**
 * Collection Platform — target registry, observations, workflow templates.
 * Observations align with STIX 2.1 SCOs/SDOs; provenance uses W3C PROV (JSON-LD).
 */

import type { CollectionAssetType } from './asset-types.js';
import type { CollectionProfileId } from './profiles.js';

export type { CollectionAssetType };
export type CollectionTargetType = CollectionAssetType;

/** @deprecated Legacy flat frequency — prefer collection_policy */
export type CollectionFrequency =
  | '15m'
  | 'hourly'
  | '6h'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'manual'
  | 'on_change'
  | 'webhook'
  | 'continuous'
  | 'incremental';

export type CollectionTargetOrigin =
  | 'manual'
  | 'targets.txt'
  | 'case_entity'
  | 'watchlist'
  | 'discovery'
  | 'api';

export type TargetClassification = 'public' | 'internal' | 'restricted' | 'classified' | string;
export type TargetSensitivity = 'low' | 'medium' | 'high' | 'critical' | string;

/** Structured metadata carried on every registry asset. */
export interface TargetRegistryMetadata {
  owner?: string | null;
  classification?: TargetClassification | null;
  confidence?: number | null;
  tags?: string[];
  sensitivity?: TargetSensitivity | null;
  /** Intelligence provenance — distinct from registry origin */
  source?: string | null;
  [key: string]: unknown;
}

export interface CollectionTarget {
  id: string;
  target_type: CollectionTargetType;
  value: string;
  normalized_value: string;
  product: string;
  case_id: number | null;
  workflow_template: string;
  /** Reusable depth preset — expands to collector subset at runtime */
  collection_profile: CollectionProfileId | string | null;
  /** Reusable schedule plan — drives intelligent scheduler */
  collection_policy: string | null;
  /** Rich collection plan — workflow + profile + policy + stopping + escalation */
  collection_strategy: string | null;
  priority: number;
  /** @deprecated — use collection_policy */
  frequency: CollectionFrequency;
  enabled: boolean;
  origin: CollectionTargetOrigin;
  origin_ref: string | null;
  owner: string | null;
  classification: string | null;
  sensitivity: string | null;
  tags: string[];
  confidence: number | null;
  intel_source: string | null;
  parent_target_id: string | null;
  discovery_depth: number;
  metadata: Record<string, unknown>;
  first_seen_at: string | null;
  last_collected_at: string | null;
  last_changed_at: string | null;
  expires_at: string | null;
  next_collect_at: string | null;
  last_cascades_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionTargetInput {
  target_type?: CollectionTargetType;
  value: string;
  product?: string;
  case_id?: number | null;
  workflow_template?: string;
  collection_profile?: CollectionProfileId | string | null;
  collection_policy?: string | null;
  collection_strategy?: string | null;
  priority?: number;
  frequency?: CollectionFrequency;
  enabled?: boolean;
  origin?: CollectionTargetOrigin;
  origin_ref?: string | null;
  owner?: string | null;
  classification?: string | null;
  sensitivity?: string | null;
  tags?: string[];
  confidence?: number | null;
  /** Maps to intel_source column */
  source?: string | null;
  metadata?: Record<string, unknown>;
  expires_at?: string | null;
}

export interface CollectionObservation {
  /** STIX 2.1 type e.g. domain-name, ipv4-addr */
  stix_type: string;
  /** Deterministic STIX-style id */
  stix_id: string;
  /** Canonical ontology entity type id e.g. Domain, Organization */
  entity_type: string;
  /** Ontology observable type id e.g. dns.record */
  observable_type?: string;
  /** Ontology version used when normalizing */
  ontology_version?: string;
  value: string;
  label: string;
  title: string;
  description?: string;
  severity?: string;
  confidence?: number;
  tags?: string[];
  source: string;
  source_id: string;
  observed_at: string;
  content_hash: string;
  /** Full STIX object + PROV bundle */
  stix_object: Record<string, unknown>;
  provenance: Record<string, unknown>;
  raw?: Record<string, unknown>;
  related?: Array<{ type: string; value: string; relation: string }>;
}

export interface CollectionPipelineStepResult {
  step: string;
  ok: boolean;
  duration_ms: number;
  output?: unknown;
  error?: string;
}

export interface CollectionRunResult {
  run_id: string;
  target_id: string;
  target_value: string;
  workflow_template: string;
  status: 'completed' | 'failed';
  steps: CollectionPipelineStepResult[];
  total_findings: number;
  inserted: number;
  skipped: number;
  event_id?: string;
  error?: string;
  started_at: string;
  finished_at: string;
}

export interface CollectionPublishedEvent {
  id: string;
  event_type: string;
  target_id: string | null;
  run_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

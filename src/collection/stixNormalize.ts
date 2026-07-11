/**
 * Map provider findings → STIX 2.1 observations with W3C PROV provenance (JSON-LD).
 */

import crypto from 'crypto';
import type { CollectionObservation } from './types.js';
import type { CollectionExecutionContext } from './executionContext.js';
import { CONNECTOR_VERSION } from './executionContext.js';
import {
  resolveEntityTypeId,
  resolveObservableType,
  resolveStixType,
} from '../intelligence/ontology/registry.js';
import { ACTIVE_ONTOLOGY_VERSION } from '../intelligence/ontology/types.js';

const PROV_CONTEXT = {
  prov: 'http://www.w3.org/ns/prov#',
  stix: 'https://oasis-open.github.io/cti/stix/v2.1/stix-v2.1-spec.html',
};

export interface ProviderFinding {
  source: string;
  sourceId: string;
  entityType: string;
  value: string;
  label?: string;
  title?: string;
  description?: string;
  severity?: string;
  confidence?: number;
  tags?: string[];
  raw?: Record<string, unknown>;
  related?: Array<{ type: string; value: string; relation: string }>;
  observedAt?: string;
}

function stixUuidFromSeed(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function stixId(type: string, seed: string): string {
  return `${type}--${stixUuidFromSeed(`${type}:${seed}`)}`;
}

function mapEntityToStixType(entityType: string, value: string): string {
  return resolveStixType(entityType, value).stix_type;
}

function buildStixObject(
  stixType: string,
  value: string,
  finding: ProviderFinding,
  observedAt: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: stixType,
    spec_version: '2.1',
    id: stixId(stixType, `${finding.source}|${finding.entityType}|${value.toLowerCase()}`),
    created: observedAt,
    modified: observedAt,
  };

  if (stixType === 'domain-name' || stixType === 'url' || stixType === 'email-addr') {
    base.value = value;
  } else if (stixType === 'ipv4-addr' || stixType === 'ipv6-addr') {
    base.value = value;
  } else if (stixType === 'identity') {
    const resolved = resolveStixType(finding.entityType, value);
    base.name = finding.label || value;
    base.identity_class = resolved.stix_identity_class || 'organization';
  } else {
    base.name = finding.title || value;
    base.value = value;
  }

  if (finding.description) base.description = finding.description;
  if (finding.confidence != null) {
    base.confidence = Math.round(Math.min(100, Math.max(0, finding.confidence * 100)));
  }
  if (finding.tags?.length) base.labels = finding.tags;

  return base;
}

function buildProvenance(
  finding: ProviderFinding,
  runId: string,
  targetId: string,
  observedAt: string,
  execution?: CollectionExecutionContext,
): Record<string, unknown> {
  const activityId = execution?.workflow_run_id || runId;
  return {
    '@context': PROV_CONTEXT,
    id: `urn:collection:prov:${crypto.createHash('sha256').update(`${activityId}:${finding.sourceId}`).digest('hex').slice(0, 16)}`,
    type: 'prov:Entity',
    wasGeneratedBy: {
      type: 'prov:Activity',
      id: `urn:collection:run:${activityId}`,
      label: execution?.workflow_template || 'collection-pipeline',
      startedAtTime: observedAt,
    },
    wasAttributedTo: {
      type: 'prov:SoftwareAgent',
      id: `urn:collection:connector:${finding.source}`,
      label: finding.source,
    },
    generatedAtTime: observedAt,
    collection: {
      target_id: targetId,
      ontology_version: ACTIVE_ONTOLOGY_VERSION,
      workflow_template: execution?.workflow_template,
      workflow_version: execution?.workflow_version,
      workflow_run_id: execution?.workflow_run_id || runId,
      node_id: execution?.node_id,
      connector_id: execution?.connector_id || finding.source,
      connector_version: CONNECTOR_VERSION,
      request_id: execution?.request_id,
      collection_event_id: execution?.collection_event_id,
      source_id: finding.sourceId,
    },
  };
}

export function contentHashForFinding(f: ProviderFinding): string {
  const key = `${f.source}|${f.entityType}|${f.value.toLowerCase().trim()}|${f.sourceId}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function normalizeProviderData(
  findings: ProviderFinding[],
  opts: {
    runId: string;
    targetId: string;
    targetValue: string;
    execution?: CollectionExecutionContext;
  },
): CollectionObservation[] {
  return findings.map((f) => {
    const observedAt = f.observedAt || new Date().toISOString();
    const stixResolved = resolveStixType(f.entityType, f.value);
    const stixType = stixResolved.stix_type;
    const entityTypeId = stixResolved.entity_type_id;
    const observableType = resolveObservableType(f.source, f.entityType);
    const stixObject = buildStixObject(stixType, f.value, f, observedAt);
    const id = String(stixObject.id);
    const contentHash = contentHashForFinding(f);

    return {
      stix_type: stixType,
      stix_id: id,
      entity_type: entityTypeId,
      observable_type: observableType,
      ontology_version: ACTIVE_ONTOLOGY_VERSION,
      value: f.value,
      label: f.label || f.value,
      title: f.title || `${f.entityType}: ${f.value}`,
      description: f.description,
      severity: f.severity || 'info',
      confidence: f.confidence ?? 0.7,
      tags: f.tags || [],
      source: f.source,
      source_id: f.sourceId,
      observed_at: observedAt,
      content_hash: contentHash,
      stix_object: stixObject,
      provenance: buildProvenance(f, opts.runId, opts.targetId, observedAt, opts.execution),
      raw: f.raw || {},
      related: f.related || [],
    };
  });
}

export function validateObservations(
  observations: CollectionObservation[],
): { valid: CollectionObservation[]; rejected: Array<{ observation: CollectionObservation; reason: string }> } {
  const valid: CollectionObservation[] = [];
  const rejected: Array<{ observation: CollectionObservation; reason: string }> = [];

  for (const obs of observations) {
    if (!obs.value?.trim()) {
      rejected.push({ observation: obs, reason: 'missing value' });
      continue;
    }
    if (!obs.stix_type || !obs.stix_id) {
      rejected.push({ observation: obs, reason: 'missing STIX identity' });
      continue;
    }
    if (!obs.source || !obs.content_hash) {
      rejected.push({ observation: obs, reason: 'missing source or content_hash' });
      continue;
    }
    if (obs.confidence != null && (obs.confidence < 0 || obs.confidence > 1)) {
      rejected.push({ observation: obs, reason: 'confidence out of range 0-1' });
      continue;
    }
    valid.push(obs);
  }

  return { valid, rejected };
}

export function deduplicateObservations(
  observations: CollectionObservation[],
): { observations: CollectionObservation[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const out: CollectionObservation[] = [];
  let duplicatesRemoved = 0;

  for (const obs of observations) {
    if (seen.has(obs.content_hash)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(obs.content_hash);
    out.push(obs);
  }

  return { observations: out, duplicatesRemoved };
}

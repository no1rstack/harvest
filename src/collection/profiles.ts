/**
 * Collection Profiles — intent presets via capabilities.
 * Profiles describe depth of investigation; workflows decide which providers implement each capability.
 */

import type { CollectionCapability } from './capabilities.js';
import { resolveWorkflowConnectors } from './workflow-catalog.js';

export const COLLECTION_PROFILE_IDS = [
  'minimal',
  'standard',
  'deep',
  'forensic',
  'incident_response',
] as const;

export type CollectionProfileId = (typeof COLLECTION_PROFILE_IDS)[number];

export interface CollectionProfileDefinition {
  id: CollectionProfileId;
  name: string;
  description: string;
  /** Operator intent — NOT connector lists */
  capabilities: CollectionCapability[];
}

export const COLLECTION_PROFILES: Record<CollectionProfileId, CollectionProfileDefinition> = {
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Fast baseline — passive infrastructure only.',
    capabilities: ['passive_infrastructure'],
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    description: 'Balanced internet presence and passive infrastructure.',
    capabilities: ['internet_presence', 'passive_infrastructure', 'certificate_transparency'],
  },
  deep: {
    id: 'deep',
    name: 'Deep',
    description: 'Extended recon — topology, history, and identity context.',
    capabilities: [
      'internet_presence',
      'passive_infrastructure',
      'certificate_transparency',
      'historical_presence',
      'infrastructure_topology',
      'identity_footprint',
    ],
  },
  forensic: {
    id: 'forensic',
    name: 'Forensic',
    description: 'Maximum passive depth — all capabilities the workflow supports.',
    capabilities: [
      'internet_presence',
      'passive_infrastructure',
      'dns_resolution',
      'certificate_transparency',
      'historical_presence',
      'threat_intelligence',
      'identity_footprint',
      'org_structure',
      'infrastructure_topology',
      'malware_intel',
      'feed_ingestion',
    ],
  },
  incident_response: {
    id: 'incident_response',
    name: 'Incident Response',
    description: 'Threat-relevant sweep — certs, malware intel, feeds.',
    capabilities: [
      'passive_infrastructure',
      'certificate_transparency',
      'threat_intelligence',
      'malware_intel',
      'feed_ingestion',
    ],
  },
};

export function listCollectionProfiles(): CollectionProfileDefinition[] {
  return Object.values(COLLECTION_PROFILES);
}

export function getCollectionProfile(id: string): CollectionProfileDefinition | undefined {
  return COLLECTION_PROFILES[id as CollectionProfileId];
}

export function profileCapabilities(profileId?: string | null): CollectionCapability[] {
  const profile = getCollectionProfile(profileId || 'standard') || COLLECTION_PROFILES.standard;
  return [...profile.capabilities];
}

/** Profile intent + workflow catalog → connector ids for Cascades DAG expansion. */
export function resolveProfileCollectors(
  workflowTemplate: string,
  profileId?: string | null,
): string[] {
  const caps = profileCapabilities(profileId);
  return resolveWorkflowConnectors(workflowTemplate, caps);
}

/** @deprecated Use resolveProfileCollectors — kept for API compatibility */
export function resolveProfileCapabilities(profileId?: string | null): CollectionCapability[] {
  return profileCapabilities(profileId);
}

/**
 * Workflow Catalog — data-driven templates. Each workflow expands capabilities → graph.
 * The scheduler resolves templates from this catalog; nothing is hardcoded to one workflow.
 */

import type { CollectionTargetType } from './types.js';
import {
  type CollectionCapability,
  connectorsForCapabilities,
  CAPABILITY_CONNECTORS,
} from './capabilities.js';
import { CONNECTOR_IDS } from '../../scripts/osint-harvest/collection/connectors.js';

const IMPLEMENTED = new Set(CONNECTOR_IDS);

export interface WorkflowCatalogEntry {
  id: string;
  /** Human label shown in ops UI */
  name: string;
  description: string;
  category: 'infrastructure' | 'identity' | 'threat' | 'document' | 'cloud' | 'sync';
  target_types: CollectionTargetType[];
  /** Capabilities this workflow can satisfy */
  capabilities: CollectionCapability[];
  /** Capability → connector mapping for this workflow (workflow decides implementation) */
  capability_connectors: Partial<Record<CollectionCapability, readonly string[]>>;
  default_profile: string;
  default_policy: string;
  default_strategy: string;
  /** Cascades bundled workflow id (may differ from catalog id during migration) */
  cascades_workflow_id: string;
  maturity_level: number;
}

/** Legacy id → catalog id */
export const WORKFLOW_ALIASES: Record<string, string> = {
  'passive-domain-collection': 'passive-domain',
  'threat-feed-sync': 'threat-feed',
  'organization-enrichment': 'organization',
  'social-identity-watch': 'identity',
  'certificate-monitor': 'certificate',
  'github-repo-watch': 'identity',
  'rss-stream': 'threat-feed',
  'misp-sync': 'threat-feed',
  'opencti-sync': 'threat-feed',
  'osint-investigation': 'osint-investigation',
};

export const WORKFLOW_CATALOG: Record<string, WorkflowCatalogEntry> = {
  'osint-investigation': {
    id: 'osint-investigation',
    name: 'OSINT Investigation',
    description:
      'ENNA 7-step methodology via Cascades: scope, identity (Holehe/Sherlock/Maigret), passive domain recon, correlate, report. Each finding can fan out as a child Collection.',
    category: 'infrastructure',
    target_types: ['domain', 'subdomain', 'hostname', 'metadata', 'email', 'username', 'person'],
    capabilities: [
      'internet_presence',
      'passive_infrastructure',
      'certificate_transparency',
      'historical_presence',
      'threat_intelligence',
      'dns_resolution',
      'identity_footprint',
    ],
    capability_connectors: {
      internet_presence: ['dns', 'rdap', 'crtsh'],
      passive_infrastructure: ['dns', 'rdap', 'crtsh', 'wayback', 'hackertarget'],
      certificate_transparency: ['crtsh'],
      historical_presence: ['wayback'],
      threat_intelligence: ['urlhaus', 'hackertarget'],
      dns_resolution: ['dns'],
      identity_footprint: ['holehe', 'sherlock', 'maigret'],
    },
    default_profile: 'deep',
    default_policy: 'passive-domain-daily',
    default_strategy: 'osint-investigation-standard',
    cascades_workflow_id: 'osint-investigation',
    maturity_level: 3,
  },
  'passive-domain': {
    id: 'passive-domain',
    name: 'Passive Domain',
    description: 'Internet presence and passive infrastructure for domains and subdomains.',
    category: 'infrastructure',
    target_types: ['domain', 'subdomain', 'hostname'],
    capabilities: [
      'internet_presence',
      'passive_infrastructure',
      'dns_resolution',
      'certificate_transparency',
      'historical_presence',
      'threat_intelligence',
      'infrastructure_topology',
    ],
    capability_connectors: {
      internet_presence: ['dns', 'rdap', 'crtsh'],
      passive_infrastructure: ['dns', 'rdap', 'crtsh', 'wayback', 'hackertarget'],
      dns_resolution: ['dns'],
      certificate_transparency: ['crtsh'],
      historical_presence: ['wayback'],
      threat_intelligence: ['urlhaus', 'rss', 'hackertarget'],
      infrastructure_topology: ['dns'],
    },
    default_profile: 'standard',
    default_policy: 'passive-domain-daily',
    default_strategy: 'passive-domain-standard',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
  'passive-ip': {
    id: 'passive-ip',
    name: 'Passive IP',
    description: 'Infrastructure topology and threat context for IP addresses and CIDR blocks.',
    category: 'infrastructure',
    target_types: ['ip', 'cidr', 'asn'],
    capabilities: ['passive_infrastructure', 'infrastructure_topology', 'threat_intelligence'],
    capability_connectors: {
      passive_infrastructure: ['hackertarget', 'urlhaus'],
      infrastructure_topology: ['dns'],
      threat_intelligence: ['urlhaus', 'rss'],
    },
    default_profile: 'standard',
    default_policy: 'passive-domain-daily',
    default_strategy: 'passive-ip-standard',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
  identity: {
    id: 'identity',
    name: 'Identity',
    description: 'Username, email, and social footprint — ENNA Holehe/Sherlock/Maigret via Cascades.',
    category: 'identity',
    target_types: ['username', 'email', 'phone', 'person', 'repository', 'github_org', 'metadata'],
    capabilities: ['identity_footprint', 'internet_presence'],
    capability_connectors: {
      identity_footprint: ['holehe', 'sherlock', 'maigret'],
      internet_presence: ['rdap'],
    },
    default_profile: 'standard',
    default_policy: 'social-identity-monthly',
    default_strategy: 'identity-deep',
    cascades_workflow_id: 'osint-investigation',
    maturity_level: 3,
  },
  organization: {
    id: 'organization',
    name: 'Organization',
    description: 'Org structure, affiliations, and discovered asset fan-out.',
    category: 'identity',
    target_types: ['organization', 'person'],
    capabilities: ['org_structure', 'internet_presence', 'identity_footprint'],
    capability_connectors: {
      org_structure: ['whois', 'rdap', 'rss'],
      internet_presence: ['rdap', 'dns'],
      identity_footprint: ['rss'],
    },
    default_profile: 'deep',
    default_policy: 'organization-weekly',
    default_strategy: 'organization-deep',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
  'threat-feed': {
    id: 'threat-feed',
    name: 'Threat Feed',
    description: 'High-frequency threat indicator and feed ingestion.',
    category: 'threat',
    target_types: ['metadata', 'domain', 'ip'],
    capabilities: ['feed_ingestion', 'threat_intelligence', 'malware_intel'],
    capability_connectors: {
      feed_ingestion: ['rss'],
      threat_intelligence: ['urlhaus', 'hackertarget', 'rss'],
      malware_intel: ['urlhaus'],
    },
    default_profile: 'standard',
    default_policy: 'threat-feed-15m',
    default_strategy: 'threat-feed-standard',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
  certificate: {
    id: 'certificate',
    name: 'Certificate',
    description: 'Certificate transparency monitoring and expiry tracking.',
    category: 'infrastructure',
    target_types: ['domain', 'subdomain', 'certificate'],
    capabilities: ['certificate_transparency', 'passive_infrastructure'],
    capability_connectors: {
      certificate_transparency: ['crtsh'],
      passive_infrastructure: ['dns', 'crtsh'],
    },
    default_profile: 'minimal',
    default_policy: 'certificate-6h',
    default_strategy: 'certificate-minimal',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
  document: {
    id: 'document',
    name: 'Document',
    description: 'Historical document and web archive intelligence.',
    category: 'document',
    target_types: ['domain', 'metadata', 'api_endpoint'],
    capabilities: ['document_intel', 'historical_presence'],
    capability_connectors: {
      document_intel: ['wayback', 'rss'],
      historical_presence: ['wayback'],
    },
    default_profile: 'standard',
    default_policy: 'passive-domain-daily',
    default_strategy: 'document-standard',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
  'cloud-asset': {
    id: 'cloud-asset',
    name: 'Cloud Asset',
    description: 'Cloud exposure and infrastructure discovery for cloud-native assets.',
    category: 'cloud',
    target_types: ['domain', 'subdomain', 'docker_image', 'kubernetes_cluster', 'api_endpoint'],
    capabilities: ['cloud_exposure', 'passive_infrastructure', 'certificate_transparency'],
    capability_connectors: {
      cloud_exposure: ['dns', 'crtsh'],
      passive_infrastructure: ['dns', 'crtsh', 'wayback'],
      certificate_transparency: ['crtsh'],
    },
    default_profile: 'deep',
    default_policy: 'passive-domain-daily',
    default_strategy: 'cloud-asset-deep',
    cascades_workflow_id: 'passive-domain-collection',
    maturity_level: 2,
  },
};

export function normalizeWorkflowId(id: string): string {
  return WORKFLOW_ALIASES[id] || id;
}

export function getCatalogWorkflow(id: string): WorkflowCatalogEntry | undefined {
  const normalized = normalizeWorkflowId(id);
  return WORKFLOW_CATALOG[normalized];
}

export function listCatalogWorkflows(): WorkflowCatalogEntry[] {
  return Object.values(WORKFLOW_CATALOG);
}

export function cascadesWorkflowId(catalogOrLegacyId: string): string {
  const entry = getCatalogWorkflow(catalogOrLegacyId);
  return entry?.cascades_workflow_id || catalogOrLegacyId;
}

/** Expand profile capabilities + workflow catalog → implemented connector ids. */
export function resolveWorkflowConnectors(
  workflowId: string,
  profileCapabilities: readonly CollectionCapability[],
): string[] {
  const entry = getCatalogWorkflow(workflowId);
  if (!entry) {
    return filterImplemented(connectorsForCapabilities(profileCapabilities));
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const cap of profileCapabilities) {
    if (!entry.capabilities.includes(cap)) continue;
    const connectors =
      entry.capability_connectors[cap] ||
      CAPABILITY_CONNECTORS[cap] ||
      [];
    for (const c of connectors) {
      if (IMPLEMENTED.has(c) && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }

  return out.length ? out : filterImplemented(entry.capability_connectors.passive_infrastructure || ['dns', 'crtsh']);
}

function filterImplemented(collectors: readonly string[]): string[] {
  return collectors.filter((c) => IMPLEMENTED.has(c));
}

export function defaultWorkflowForAssetType(targetType: CollectionTargetType): string {
  if (['domain', 'subdomain', 'hostname'].includes(targetType)) return 'passive-domain';
  if (['ip', 'cidr', 'asn'].includes(targetType)) return 'passive-ip';
  if (['organization', 'person'].includes(targetType)) return 'organization';
  if (['username', 'email', 'phone', 'repository', 'github_org'].includes(targetType)) return 'identity';
  if (targetType === 'certificate') return 'certificate';
  if (['docker_image', 'kubernetes_cluster', 'api_endpoint'].includes(targetType)) return 'cloud-asset';
  if (targetType === 'metadata') return 'threat-feed';
  return 'passive-domain';
}

/**
 * Ontology v1.0.0 — seeded from canonical kinds + STIX mappings + collection connectors.
 */

import type {
  OntologyEntityType,
  OntologyKnowledgeType,
  OntologyObservableType,
  OntologyRelationshipType,
  OntologySnapshot,
} from './types.js';
import { ACTIVE_ONTOLOGY_VERSION } from './types.js';

export const ONTOLOGY_V1_ENTITY_TYPES: OntologyEntityType[] = [
  { id: 'Person', label: 'Person', stix_type: 'identity', stix_identity_class: 'individual', identifiers: ['name', 'email'] },
  { id: 'Organization', label: 'Organization', stix_type: 'identity', stix_identity_class: 'organization', identifiers: ['name', 'lei', 'domain'] },
  { id: 'Domain', label: 'Domain', stix_type: 'domain-name', stix_identity_class: null, identifiers: ['domain'] },
  { id: 'Hostname', label: 'Hostname', stix_type: 'domain-name', stix_identity_class: null, identifiers: ['hostname'] },
  { id: 'IpAddress', label: 'IP Address', stix_type: 'ipv4-addr', stix_identity_class: null, identifiers: ['ip'] },
  { id: 'Email', label: 'Email', stix_type: 'email-addr', stix_identity_class: null, identifiers: ['email'] },
  { id: 'Phone', label: 'Phone', stix_type: 'x-h3xa-phone', stix_identity_class: null, identifiers: ['phone'] },
  { id: 'Url', label: 'URL', stix_type: 'url', stix_identity_class: null, identifiers: ['url'] },
  { id: 'Document', label: 'Document', stix_type: 'report', stix_identity_class: null, identifiers: ['hash', 'url'] },
  { id: 'Certificate', label: 'Certificate', stix_type: 'x509-certificate', stix_identity_class: null, identifiers: ['serial', 'fingerprint'] },
  { id: 'Indicator', label: 'Indicator', stix_type: 'indicator', stix_identity_class: null, identifiers: ['pattern'] },
  { id: 'Event', label: 'Event', stix_type: 'observed-data', stix_identity_class: null, identifiers: ['event_id'] },
  { id: 'Asset', label: 'Asset', stix_type: 'x-collection-observable', stix_identity_class: null, identifiers: ['asset_id'] },
  { id: 'Vehicle', label: 'Vehicle', stix_type: 'x-collection-observable', stix_identity_class: null, identifiers: ['vin', 'plate'] },
  { id: 'Aircraft', label: 'Aircraft', stix_type: 'x-collection-observable', stix_identity_class: null, identifiers: ['icao', 'tail'] },
  { id: 'Vessel', label: 'Vessel', stix_type: 'x-collection-observable', stix_identity_class: null, identifiers: ['imo', 'mmsi'] },
  { id: 'Wallet', label: 'Cryptocurrency Wallet', stix_type: 'x-collection-observable', stix_identity_class: null, identifiers: ['address'] },
  { id: 'Address', label: 'Address', stix_type: 'location', stix_identity_class: null, identifiers: ['address'] },
  { id: 'Case', label: 'Case', stix_type: 'grouping', stix_identity_class: null, identifiers: ['case_id'] },
];

/** Connector / extractor aliases → canonical entity type id */
export const ONTOLOGY_V1_ENTITY_ALIASES: Record<string, string> = {
  domain: 'Domain',
  subdomain: 'Hostname',
  hostname: 'Hostname',
  dns_record: 'Domain',
  ip: 'IpAddress',
  ipv4: 'IpAddress',
  ipv6: 'IpAddress',
  email: 'Email',
  url: 'Url',
  feed_item: 'Document',
  organization: 'Organization',
  org: 'Organization',
  person: 'Person',
  certificate: 'Certificate',
  cert: 'Certificate',
  ioc: 'Indicator',
  whois: 'Organization',
  company: 'Organization',
  phone: 'Phone',
  document: 'Document',
  event: 'Event',
  asset: 'Asset',
  vehicle: 'Vehicle',
  aircraft: 'Aircraft',
  vessel: 'Vessel',
  wallet: 'Wallet',
  cryptowallet: 'Wallet',
  address: 'Address',
};

export const ONTOLOGY_V1_OBSERVABLE_TYPES: OntologyObservableType[] = [
  { id: 'dns.record', entity_type_id: 'Domain', connector_ids: ['dns'] },
  { id: 'crt.certificate', entity_type_id: 'Certificate', connector_ids: ['crtsh', 'crt'] },
  { id: 'rdap.domain', entity_type_id: 'Domain', connector_ids: ['rdap'] },
  { id: 'rdap.entity', entity_type_id: 'Organization', connector_ids: ['rdap'] },
  { id: 'whois.registrant', entity_type_id: 'Organization', connector_ids: ['whois'] },
  { id: 'feed.article', entity_type_id: 'Document', connector_ids: ['rss'] },
  { id: 'urlhaus.indicator', entity_type_id: 'Indicator', connector_ids: ['urlhaus'] },
  { id: 'wayback.snapshot', entity_type_id: 'Url', connector_ids: ['wayback'] },
  { id: 'hackertarget.scan', entity_type_id: 'Asset', connector_ids: ['hackertarget'] },
  { id: 'collection.observable', entity_type_id: 'Asset', connector_ids: [] },
];

export const ONTOLOGY_V1_RELATIONSHIP_TYPES: OntologyRelationshipType[] = [
  { id: 'resolves-to', label: 'Resolves To', source_entity_types: ['Domain', 'Hostname'], target_entity_types: ['IpAddress'], stix_mapping: 'resolves-to', origins_allowed: ['observed', 'stix'] },
  { id: 'registered-by', label: 'Registered By', source_entity_types: ['Domain'], target_entity_types: ['Organization', 'Person'], stix_mapping: 'related-to', origins_allowed: ['observed', 'inferred', 'analyst'] },
  { id: 'issued-for', label: 'Issued For', source_entity_types: ['Certificate'], target_entity_types: ['Domain', 'Hostname'], stix_mapping: 'related-to', origins_allowed: ['observed'] },
  { id: 'discovers', label: 'Discovers', source_entity_types: ['Domain'], target_entity_types: ['Hostname', 'Domain'], stix_mapping: 'related-to', origins_allowed: ['observed', 'inferred'] },
  { id: 'belongs-to', label: 'Belongs To', source_entity_types: ['IpAddress', 'Hostname'], target_entity_types: ['Organization'], stix_mapping: 'belongs-to', origins_allowed: ['observed', 'inferred'] },
  { id: 'owned-by', label: 'Owned By', source_entity_types: ['Domain', 'Asset'], target_entity_types: ['Organization', 'Person'], stix_mapping: 'related-to', origins_allowed: ['observed', 'inferred', 'analyst'] },
  { id: 'related-to', label: 'Related To', source_entity_types: ['*'], target_entity_types: ['*'], stix_mapping: 'related-to', origins_allowed: ['observed', 'inferred', 'analyst', 'stix'] },
  { id: 'indicates', label: 'Indicates', source_entity_types: ['Indicator'], target_entity_types: ['Asset', 'Domain', 'IpAddress'], stix_mapping: 'indicates', origins_allowed: ['observed', 'stix'] },
];

export const ONTOLOGY_V1_KNOWLEDGE_TYPES: OntologyKnowledgeType[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'profile', label: 'Profile' },
  { id: 'dossier', label: 'Dossier' },
  { id: 'network', label: 'Network' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'report', label: 'Report' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'collection_summary', label: 'Collection Summary' },
];

export function buildOntologyV1Snapshot(): OntologySnapshot {
  const entity_types = new Map<string, OntologyEntityType>();
  for (const et of ONTOLOGY_V1_ENTITY_TYPES) entity_types.set(et.id, et);

  const entity_aliases = new Map<string, string>();
  for (const [alias, id] of Object.entries(ONTOLOGY_V1_ENTITY_ALIASES)) {
    entity_aliases.set(alias.toLowerCase(), id);
  }

  const observable_types = new Map<string, OntologyObservableType>();
  for (const ot of ONTOLOGY_V1_OBSERVABLE_TYPES) observable_types.set(ot.id, ot);

  const relationship_types = new Map<string, OntologyRelationshipType>();
  for (const rt of ONTOLOGY_V1_RELATIONSHIP_TYPES) relationship_types.set(rt.id, rt);

  const knowledge_types = new Map<string, OntologyKnowledgeType>();
  for (const kt of ONTOLOGY_V1_KNOWLEDGE_TYPES) knowledge_types.set(kt.id, kt);

  return {
    version: ACTIVE_ONTOLOGY_VERSION,
    entity_types,
    entity_aliases,
    observable_types,
    relationship_types,
    knowledge_types,
  };
}

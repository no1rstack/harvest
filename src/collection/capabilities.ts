/**
 * Collection Capabilities — operator-facing intent layer.
 * Profiles select capabilities; workflows map capabilities → provider connectors.
 * Operators think "Internet Presence", not "DNS / RDAP / crt.sh".
 */

export const COLLECTION_CAPABILITIES = [
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
  'cloud_exposure',
  'document_intel',
  'statistical_context',
  'financial_crime_context',
  'crypto_ledger',
  'aviation_adsb',
  'threat_reports',
] as const;

export type CollectionCapability = (typeof COLLECTION_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<CollectionCapability, string> = {
  internet_presence: 'Internet Presence',
  passive_infrastructure: 'Passive Infrastructure Collection',
  dns_resolution: 'DNS Resolution',
  certificate_transparency: 'Certificate Transparency',
  historical_presence: 'Historical Web Presence',
  threat_intelligence: 'Threat Intelligence',
  identity_footprint: 'Identity Footprint',
  org_structure: 'Organization Structure',
  infrastructure_topology: 'Infrastructure Topology',
  malware_intel: 'Malware Intelligence',
  feed_ingestion: 'Feed Ingestion',
  cloud_exposure: 'Cloud Asset Exposure',
  document_intel: 'Document Intelligence',
  statistical_context: 'UN / Development Statistics',
  financial_crime_context: 'AML / FinCEN / lobbying context',
  crypto_ledger: 'Public ledger / IBAN validation',
  aviation_adsb: 'Live ADS-B (OpenSky)',
  threat_reports: 'APT campaign report index',
};

/** Which provider connectors satisfy each capability (workflow may subset further). */
export const CAPABILITY_CONNECTORS: Record<CollectionCapability, readonly string[]> = {
  internet_presence: ['dns', 'rdap', 'whois', 'crtsh'],
  passive_infrastructure: ['dns', 'rdap', 'crtsh', 'wayback', 'hackertarget'],
  dns_resolution: ['dns', 'historical_dns'],
  certificate_transparency: ['crtsh', 'certificate'],
  historical_presence: ['wayback'],
  threat_intelligence: ['urlhaus', 'rss', 'hackertarget'],
  identity_footprint: ['holehe', 'sherlock', 'maigret', 'github', 'rss'],
  org_structure: ['whois', 'rdap', 'rss'],
  infrastructure_topology: ['asn', 'dns', 'whois'],
  malware_intel: ['urlhaus', 'hackertarget'],
  feed_ingestion: ['rss'],
  cloud_exposure: ['dns', 'crtsh'],
  document_intel: ['wayback', 'rss'],
  statistical_context: ['undata', 'worldbank', 'datagov'],
  financial_crime_context: ['fincen', 'aleph', 'datagov'],
  crypto_ledger: ['blockchain', 'iban'],
  aviation_adsb: ['opensky'],
  threat_reports: ['aptnotes'],
};

export function connectorsForCapabilities(capabilities: readonly CollectionCapability[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cap of capabilities) {
    for (const c of CAPABILITY_CONNECTORS[cap] || []) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

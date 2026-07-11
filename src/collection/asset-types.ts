/**
 * Platform asset taxonomy — every registrable collection target type.
 */

export const COLLECTION_ASSET_TYPES = [
  'domain',
  'subdomain',
  'ip',
  'cidr',
  'asn',
  'certificate',
  'email',
  'username',
  'phone',
  'person',
  'organization',
  'wallet',
  'package',
  'repository',
  'github_org',
  'docker_image',
  'kubernetes_cluster',
  'device',
  'api_endpoint',
  'metadata',
  /** @deprecated alias — use domain */
  'hostname',
] as const;

export type CollectionAssetType = (typeof COLLECTION_ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<CollectionAssetType, string> = {
  domain: 'Domain',
  subdomain: 'Subdomain',
  ip: 'IP Address',
  cidr: 'CIDR Block',
  asn: 'ASN',
  certificate: 'Certificate',
  email: 'Email',
  username: 'Username',
  phone: 'Phone',
  person: 'Person',
  organization: 'Organization',
  wallet: 'Wallet',
  package: 'Package',
  repository: 'Repository',
  github_org: 'GitHub Organization',
  docker_image: 'Docker Image',
  kubernetes_cluster: 'Kubernetes Cluster',
  device: 'Device',
  api_endpoint: 'API Endpoint',
  metadata: 'Metadata Record',
  hostname: 'Hostname',
};

/** Infer asset type from a raw value string. */
export function inferAssetType(value: string): CollectionAssetType {
  const v = value.trim();
  if (!v) return 'metadata';

  if (/^https?:\/\//i.test(v)) return 'api_endpoint';
  if (/^AS\d+$/i.test(v) || /^asn:\d+/i.test(v)) return 'asn';
  if (v.includes('/') && /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v)) return 'cidr';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'ip';
  if (/^[\da-f:]+$/i.test(v) && v.includes(':') && !v.includes('.')) return 'ip';
  if (v.includes('@') && !v.startsWith('@')) return 'email';
  if (v.startsWith('@') && v.length > 1) return 'username';
  if (/^\+?[\d\s().-]{10,}$/.test(v)) return 'phone';
  if (/^0x[a-fA-F0-9]{40}$/.test(v) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v)) return 'wallet';
  if (/ghcr\.io|docker\.io|\/[a-z0-9][\w.-]*:([\w.-]+)?$/i.test(v)) return 'docker_image';
  if (/github\.com\/[\w.-]+\/[\w.-]+/i.test(v)) return 'repository';
  if (/github\.com\/[\w.-]+$/i.test(v)) return 'github_org';
  if (/-----BEGIN CERTIFICATE-----/.test(v) || /^[a-f0-9]{64}$/i.test(v)) return 'certificate';
  if (/^cluster[\w-]*$/i.test(v) || /kubernetes/i.test(v)) return 'kubernetes_cluster';
  if (/^[\w.-]+@[\w.-]+\.[\w.-]+$/.test(v)) return 'email';
  if ((v.match(/\./g) || []).length >= 2 && !v.includes('/')) return 'subdomain';
  if (v.includes('.')) return 'domain';
  return 'metadata';
}

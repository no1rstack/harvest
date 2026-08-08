/**
 * AI Flow Studio — Parse natural-language collection prompts into structured
 * Collection Target parameters for Cascades orchestration.
 *
 * Supports descriptions like:
 *   "Check the DNS records and certificates for example.com"
 *   "Investigate twitter account @username"
 *   "Deep scan 192.168.1.0/24 for exposed services"
 *   "Look up organization Acme Corp"
 *   "Monitor certificate expiry for my-site.io"
 */

import type { CollectionTargetType } from './types.js';

export interface FlowStudioParsed {
  target: string;
  targetType: CollectionTargetType;
  product: string;
  workflowTemplate: string;
  profile: string;
  policy: string;
  strategy: string;
  intent: string;
  reasoning: string;
  capabilities: string[];
  collectors: string[];
}

interface IntentPattern {
  keywords: string[];
  targetType: CollectionTargetType;
  workflowTemplate: string;
  profile: string;
  strategy: string;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    keywords: ['dns', 'record', 'resolve', 'lookup domain', 'whois', 'rdap', 'crt.sh', 'certificate', 'cert', 'tls', 'ssl', 'subdomain', 'passive domain', 'passive recon', 'infrastructure', 'ip address', 'reverse dns'],
    targetType: 'domain',
    workflowTemplate: 'passive-domain',
    profile: 'standard',
    strategy: 'passive-domain-standard',
  },
  {
    keywords: ['deep scan', 'forensic', 'full investigation', 'exhaustive', 'everything', 'deep dive', 'comprehensive'],
    targetType: 'domain',
    workflowTemplate: 'passive-domain',
    profile: 'deep',
    strategy: 'passive-domain-deep',
  },
  {
    keywords: ['investigate', 'osint investigation', 'social media', 'social profile', 'username', 'twitter', 'github', 'instagram', 'telegram', 'identity', 'person', 'holehe', 'sherlock', 'maigret', 'social footprint'],
    targetType: 'username',
    workflowTemplate: 'identity',
    profile: 'deep',
    strategy: 'identity-deep',
  },
  {
    keywords: ['organization', 'company', 'corp', 'inc', 'ltd', 'business', 'enterprise', 'org structure', 'affiliation'],
    targetType: 'organization',
    workflowTemplate: 'organization',
    profile: 'deep',
    strategy: 'organization-deep',
  },
  {
    keywords: ['threat', 'malware', 'phishing', 'indicator', 'ioc', 'urlhaus', 'threat intel', 'threat feed'],
    targetType: 'domain',
    workflowTemplate: 'threat-feed',
    profile: 'standard',
    strategy: 'threat-feed-standard',
  },
  {
    keywords: ['ip', 'cidr', 'subnet', 'ip range', 'asn', 'network', 'prefix'],
    targetType: 'ip',
    workflowTemplate: 'passive-ip',
    profile: 'standard',
    strategy: 'passive-ip-standard',
  },
  {
    keywords: ['cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'container', 'cloud asset'],
    targetType: 'domain',
    workflowTemplate: 'cloud-asset',
    profile: 'deep',
    strategy: 'cloud-asset-deep',
  },
  {
    keywords: ['document', 'pdf', 'report', 'archive', 'wayback', 'historical', 'web archive'],
    targetType: 'domain',
    workflowTemplate: 'document',
    profile: 'standard',
    strategy: 'document-standard',
  },
];

// Common TLD pattern
const DOMAIN_RE = /\b([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/i;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?\b/;
const CIDR_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}\b/;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const USERNAME_RE = /@(\w{1,30})\b/;
const GITHUB_RE = /\bgithub\.com\/([\w.-]+)/i;

function extractTarget(prompt: string): { value: string; type: CollectionTargetType } | null {
  // Email
  const email = prompt.match(EMAIL_RE);
  if (email) return { value: email[0].toLowerCase(), type: 'email' };

  // CIDR
  const cidr = prompt.match(CIDR_RE);
  if (cidr) return { value: cidr[0], type: 'cidr' };

  // IP
  const ip = prompt.match(IP_RE);
  if (ip && !CIDR_RE.test(ip[0])) return { value: ip[0], type: 'ip' };

  // GitHub repo/org
  const gh = prompt.match(GITHUB_RE);
  if (gh) return { value: gh[1], type: 'repository' };

  // @username
  const atUser = prompt.match(USERNAME_RE);
  if (atUser && !DOMAIN_RE.test(atUser[1])) return { value: atUser[1], type: 'username' };

  // Domain
  const domain = prompt.match(DOMAIN_RE);
  if (domain) return { value: domain[0].toLowerCase(), type: 'domain' };

  // Organization name — quoted or after keywords "organization", "company", "org"
  const quoted = prompt.match(/"([^"]+)"/);
  if (quoted) return { value: quoted[1], type: 'organization' };

  // Organization keyword patterns: "organization XYZ Corp", "company Foo Inc", "org Bar Ltd"
  const orgRe = /(?:organization|company|org|corp|business)\s+(?:called\s+|named\s+)?([A-Z][\w\s.&]+?(?:Inc|Corp|Ltd|LLC|GmbH|SA|SAS|PLC|Group|Co)(?:\b))/i;
  const orgMatch = prompt.match(orgRe);
  if (orgMatch) return { value: orgMatch[1].trim(), type: 'organization' };

  // Simpler: anything after "organization" as fallback
  const orgSimple = prompt.match(/(?:organization|company|org)\s+([A-Z][\w\s.&]+)/i);
  if (orgSimple) return { value: orgSimple[1].trim(), type: 'organization' };

  return null;
}

function matchIntent(prompt: string): IntentPattern {
  const lower = prompt.toLowerCase();
  let best: IntentPattern | null = null;
  let bestScore = 0;

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;
    for (const kw of pattern.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = pattern;
    }
  }

  return best || INTENT_PATTERNS[0]; // Default to passive-domain
}

export function parseFlowStudioPrompt(prompt: string): FlowStudioParsed {
  const extracted = extractTarget(prompt);
  const intent = matchIntent(prompt);

  const targetType = extracted?.type || intent.targetType;
  const target = extracted?.value || prompt.slice(0, 100);

  // Map profile to standard capability set
  const PROFILE_CAPABILITIES: Record<string, string[]> = {
    minimal: ['dns_resolution', 'internet_presence'],
    standard: ['internet_presence', 'passive_infrastructure', 'certificate_transparency', 'dns_resolution', 'threat_intelligence'],
    deep: ['internet_presence', 'passive_infrastructure', 'certificate_transparency', 'historical_presence', 'dns_resolution', 'threat_intelligence', 'identity_footprint', 'infrastructure_topology'],
    forensic: ['internet_presence', 'passive_infrastructure', 'certificate_transparency', 'historical_presence', 'dns_resolution', 'threat_intelligence', 'identity_footprint', 'infrastructure_topology', 'cloud_exposure', 'document_intel'],
  };
  const capabilities = PROFILE_CAPABILITIES[intent.profile] || PROFILE_CAPABILITIES.standard;

  const reasoning = [
    `Parsed ${targetType} target "${target}"`,
    `Matched intent: ${intent.keywords.filter(k => prompt.toLowerCase().includes(k)).slice(0, 3).join(', ')}`,
    `Selected workflow: ${intent.workflowTemplate}, profile: ${intent.profile}`,
    `Capabilities: ${capabilities.join(', ')}`,
  ].join('. ');

  return {
    target,
    targetType,
    product: 'harvest',
    workflowTemplate: intent.workflowTemplate,
    profile: intent.profile,
    policy: 'passive-domain-daily',
    strategy: intent.strategy,
    intent: intent.keywords[0],
    reasoning,
    capabilities,
    collectors: capabilities,
  };
}

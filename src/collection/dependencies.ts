/**
 * Target Registry dependencies — automatic discovery chains.
 * Organization → discovers → Domains → discovers → Subdomains → discovers → Certificates
 */

import type { CollectionAssetType } from './asset-types.js';
import type { CollectionTargetType } from './types.js';

export type DependencyRelation =
  | 'discovers'
  | 'resolves_to'
  | 'belongs_to'
  | 'owned_by'
  | 'hosts'
  | 'issues';

export interface TargetDependencyRule {
  id: string;
  source_type: CollectionTargetType;
  relation: DependencyRelation;
  target_type: CollectionTargetType;
  workflow_template: string;
  strategy: string;
  max_depth: number;
  enabled: boolean;
}

export const TARGET_DEPENDENCY_RULES: TargetDependencyRule[] = [
  {
    id: 'org-discovers-domain',
    source_type: 'organization',
    relation: 'discovers',
    target_type: 'domain',
    workflow_template: 'passive-domain',
    strategy: 'passive-domain-standard',
    max_depth: 3,
    enabled: true,
  },
  {
    id: 'domain-discovers-subdomain',
    source_type: 'domain',
    relation: 'discovers',
    target_type: 'subdomain',
    workflow_template: 'passive-domain',
    strategy: 'passive-domain-standard',
    max_depth: 3,
    enabled: true,
  },
  {
    id: 'subdomain-discovers-certificate',
    source_type: 'subdomain',
    relation: 'discovers',
    target_type: 'certificate',
    workflow_template: 'certificate',
    strategy: 'certificate-minimal',
    max_depth: 2,
    enabled: true,
  },
  {
    id: 'domain-resolves-ip',
    source_type: 'domain',
    relation: 'resolves_to',
    target_type: 'ip',
    workflow_template: 'passive-ip',
    strategy: 'passive-ip-standard',
    max_depth: 2,
    enabled: true,
  },
  {
    id: 'ip-belongs-asn',
    source_type: 'ip',
    relation: 'belongs_to',
    target_type: 'asn',
    workflow_template: 'passive-ip',
    strategy: 'passive-ip-standard',
    max_depth: 1,
    enabled: true,
  },
];

export const TARGET_DEPENDENCIES_SQL = `
CREATE TABLE IF NOT EXISTS collection_target_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_target_id UUID NOT NULL REFERENCES collection_targets(id) ON DELETE CASCADE,
  child_target_id UUID REFERENCES collection_targets(id) ON DELETE SET NULL,
  relation TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  discovered_value TEXT,
  depth INTEGER NOT NULL DEFAULT 1,
  rule_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_deps_parent ON collection_target_dependencies(parent_target_id);
CREATE INDEX IF NOT EXISTS idx_target_deps_child ON collection_target_dependencies(child_target_id);

ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS parent_target_id UUID;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS discovery_depth INTEGER DEFAULT 0;
ALTER TABLE collection_targets ADD COLUMN IF NOT EXISTS collection_strategy TEXT;
`;

export function rulesForSourceType(sourceType: CollectionAssetType): TargetDependencyRule[] {
  return TARGET_DEPENDENCY_RULES.filter((r) => r.enabled && r.source_type === sourceType);
}

export function ruleForRelation(
  sourceType: CollectionTargetType,
  relation: DependencyRelation,
  entityType: string,
): TargetDependencyRule | undefined {
  const normalized = entityType.toLowerCase() as CollectionTargetType;
  return TARGET_DEPENDENCY_RULES.find(
    (r) =>
      r.enabled &&
      r.source_type === sourceType &&
      r.relation === relation &&
      r.target_type === normalized,
  );
}

export function entityTypeToAssetType(entityType: string): CollectionTargetType | null {
  const t = entityType.toLowerCase();
  const map: Record<string, CollectionTargetType> = {
    domain: 'domain',
    subdomain: 'subdomain',
    hostname: 'subdomain',
    ip: 'ip',
    ipv4: 'ip',
    ipv6: 'ip',
    certificate: 'certificate',
    cert: 'certificate',
    organization: 'organization',
    org: 'organization',
    asn: 'asn',
    email: 'email',
    username: 'username',
  };
  return map[t] || null;
}

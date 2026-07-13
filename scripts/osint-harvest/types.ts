/**
 * Shared types for Judicium OSINT harvest → Postgres.
 * Passive recon only (ENNA-indexed public sources). No social-engineering attack modules.
 */

export type HarvestEntityType =
  | 'domain'
  | 'subdomain'
  | 'ip'
  | 'email'
  | 'username'
  | 'url'
  | 'person'
  | 'organization'
  | 'certificate'
  | 'dns_record'
  | 'whois'
  | 'ioc'
  | 'feed_item'
  | 'custom';

export type HarvestSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface HarvestFinding {
  source: string;
  sourceId: string;
  entityType: HarvestEntityType;
  value: string;
  label: string;
  title: string;
  description?: string;
  severity?: HarvestSeverity;
  confidence?: number;
  tags?: string[];
  raw?: Record<string, unknown>;
  related?: Array<{ type: HarvestEntityType; value: string; relation: string }>;
  observedAt?: string;
}

export interface HarvesterContext {
  target: string;
  caseId?: number;
  userId: string;
  maxResults: number;
  timeoutMs: number;
  userAgent: string;
}

export interface HarvesterResult {
  harvester: string;
  findings: HarvestFinding[];
  errors: string[];
  durationMs: number;
}

export interface Harvester {
  id: string;
  name: string;
  description: string;
  /** ENNA / upstream reference */
  reference?: string;
  run(ctx: HarvesterContext): Promise<HarvesterResult>;
}

export interface HarvestRunSummary {
  runId: string;
  target: string;
  caseId?: number;
  startedAt: string;
  finishedAt: string;
  harvesters: string[];
  totalFindings: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

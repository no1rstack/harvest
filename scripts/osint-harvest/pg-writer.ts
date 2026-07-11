/**
 * Postgres writer for OSINT harvest findings → Judicium tables.
 */

import crypto from 'crypto';
import type { Pool } from 'pg';
import type { HarvestFinding, HarvestRunSummary } from './types.js';

export const HARVEST_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS osint_harvest_runs (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  case_id INTEGER,
  product TEXT NOT NULL DEFAULT 'shared',
  user_id TEXT NOT NULL DEFAULT 'harvest',
  harvesters TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  total_findings INTEGER DEFAULT 0,
  inserted INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS osint_harvest_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES osint_harvest_runs(id) ON DELETE CASCADE,
  case_id INTEGER,
  product TEXT NOT NULL DEFAULT 'shared',
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  severity TEXT DEFAULT 'info',
  confidence REAL DEFAULT 0.7,
  tags TEXT[] DEFAULT '{}',
  content_hash TEXT NOT NULL,
  raw JSONB DEFAULT '{}'::jsonb,
  related JSONB DEFAULT '[]'::jsonb,
  observed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ohf_run ON osint_harvest_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_ohf_case ON osint_harvest_findings(case_id);
CREATE INDEX IF NOT EXISTS idx_ohf_type ON osint_harvest_findings(entity_type);
CREATE INDEX IF NOT EXISTS idx_ohf_value ON osint_harvest_findings(value);
CREATE INDEX IF NOT EXISTS idx_ohf_source ON osint_harvest_findings(source);
CREATE INDEX IF NOT EXISTS idx_ohf_product ON osint_harvest_findings(product);
CREATE INDEX IF NOT EXISTS idx_ohr_target ON osint_harvest_runs(target);
CREATE INDEX IF NOT EXISTS idx_ohr_product ON osint_harvest_runs(product);
`;

function contentHash(f: HarvestFinding): string {
  const key = `${f.source}|${f.entityType}|${f.value.toLowerCase().trim()}|${f.sourceId}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

function findingId(hash: string): string {
  return `ohf_${hash.slice(0, 32)}`;
}

export async function ensureHarvestSchema(pool: Pool): Promise<void> {
  await pool.query(HARVEST_SCHEMA_SQL);
  // Soft-upgrade older product DBs that already had harvest tables without product.
  await pool.query(`ALTER TABLE osint_harvest_runs ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'shared'`);
  await pool.query(`ALTER TABLE osint_harvest_findings ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'shared'`);
}

export async function startHarvestRun(
  pool: Pool,
  opts: {
    runId: string;
    target: string;
    caseId?: number;
    userId: string;
    harvesters: string[];
    product?: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO osint_harvest_runs (id, target, case_id, user_id, harvesters, status, started_at, product)
     VALUES ($1, $2, $3, $4, $5, 'running', NOW(), $6)
     ON CONFLICT (id) DO NOTHING`,
    [opts.runId, opts.target, opts.caseId ?? null, opts.userId, opts.harvesters, opts.product || 'shared'],
  );
}

export async function finishHarvestRun(
  pool: Pool,
  summary: HarvestRunSummary,
): Promise<void> {
  await pool.query(
    `UPDATE osint_harvest_runs
     SET status = 'completed',
         total_findings = $2,
         inserted = $3,
         skipped = $4,
         errors = $5::jsonb,
         finished_at = $6::timestamptz
     WHERE id = $1`,
    [
      summary.runId,
      summary.totalFindings,
      summary.inserted,
      summary.skipped,
      JSON.stringify(summary.errors),
      summary.finishedAt,
    ],
  );
}

export async function persistFindings(
  pool: Pool,
  opts: {
    runId: string;
    caseId?: number;
    findings: HarvestFinding[];
    alsoFeedItems?: boolean;
    alsoEvidence?: boolean;
    product?: string;
  },
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const product = opts.product || 'shared';

  // Shared harvest DB has no cases/feed_items/evidence tables — skip dual-writes there.
  const hasCases = await pool
    .query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cases'`)
    .then((r) => (r.rowCount || 0) > 0)
    .catch(() => false);
  const alsoFeed = Boolean(opts.alsoFeedItems && hasCases);
  const alsoEvidence = Boolean(opts.alsoEvidence && opts.caseId && hasCases);

  for (const f of opts.findings) {
    const hash = contentHash(f);
    const id = findingId(hash);
    const observedAt = f.observedAt || new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO osint_harvest_findings
        (id, run_id, case_id, source, source_id, entity_type, value, label, title,
         description, severity, confidence, tags, content_hash, raw, related, observed_at, product)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::timestamptz,$18)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING id`,
      [
        id,
        opts.runId,
        opts.caseId ?? null,
        f.source,
        f.sourceId,
        f.entityType,
        f.value,
        f.label || f.value,
        f.title,
        f.description || '',
        f.severity || 'info',
        f.confidence ?? 0.7,
        f.tags || [],
        hash,
        JSON.stringify(f.raw || {}),
        JSON.stringify(f.related || []),
        observedAt,
        product,
      ],
    );

    if (result.rowCount === 0) {
      skipped++;
      continue;
    }
    inserted++;

    if (alsoFeed) {
      await upsertFeedItem(pool, f, id);
    }

    if (alsoEvidence && opts.caseId) {
      await upsertEvidence(pool, f, opts.caseId, hash);
      await upsertCaseEntity(pool, f, opts.caseId);
    }
  }

  return { inserted, skipped };
}

async function upsertFeedItem(pool: Pool, f: HarvestFinding, findingId: string): Promise<void> {
  const feedId = `osint:${f.source}:${findingId}`;
  await pool.query(
    `INSERT INTO feed_items
      (id, feed_url, title, normalized_text, raw_content, summary, source_name, source_url,
       feed_category, published_at, fetched_at, category, entities, enrichment, original_link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'osint',NOW(),NOW(),'intelligence',$9::jsonb,$10::jsonb,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      feedId,
      `osint://${f.source}`,
      f.title.slice(0, 500),
      `${f.entityType}: ${f.value}`.slice(0, 2000),
      JSON.stringify(f.raw || {}),
      (f.description || f.title).slice(0, 1000),
      f.source,
      typeof f.raw?.url === 'string' ? f.raw.url : '',
      JSON.stringify([f.value, ...(f.tags || [])].slice(0, 20)),
      JSON.stringify({
        harvest: true,
        entityType: f.entityType,
        confidence: f.confidence ?? 0.7,
        severity: f.severity || 'info',
        sourceId: f.sourceId,
      }),
      typeof f.raw?.url === 'string' ? f.raw.url : f.value,
    ],
  );
}

async function upsertEvidence(
  pool: Pool,
  f: HarvestFinding,
  caseId: number,
  _hash: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO evidence (case_id, entity_id, source, claim, payload, provenance)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      caseId,
      f.value,
      f.source,
      f.title || `${f.entityType}: ${f.value}`,
      JSON.stringify({ finding: f, raw: f.raw || {} }),
      JSON.stringify({
        tool: f.source,
        harvestedAt: new Date().toISOString(),
        confidence: f.confidence ?? 0.7,
        contentHash: _hash,
      }),
    ],
  );
}

async function upsertCaseEntity(pool: Pool, f: HarvestFinding, caseId: number): Promise<void> {
  const schemaMap: Record<string, string> = {
    domain: 'Domain',
    subdomain: 'Domain',
    ip: 'IP',
    email: 'Email',
    url: 'Url',
    person: 'Person',
    organization: 'Organization',
    certificate: 'Certificate',
    dns_record: 'DnsRecord',
    whois: 'Whois',
    ioc: 'Indicator',
    feed_item: 'Document',
    custom: 'Entity',
  };

  await pool.query(
    `INSERT INTO case_entities
      (case_id, entity_id, entity_name, entity_schema, payload, provenance, evidence)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
     ON CONFLICT (case_id, entity_id) DO UPDATE SET
       payload = case_entities.payload || EXCLUDED.payload,
       provenance = EXCLUDED.provenance,
       evidence = COALESCE(case_entities.evidence, '[]'::jsonb) || EXCLUDED.evidence`,
    [
      caseId,
      `${f.entityType}:${f.value.toLowerCase()}`,
      f.label || f.value,
      schemaMap[f.entityType] || 'Entity',
      JSON.stringify({
        value: f.value,
        type: f.entityType,
        confidence: f.confidence ?? 0.7,
        raw: f.raw || {},
      }),
      JSON.stringify({ source: f.source, sourceId: f.sourceId }),
      JSON.stringify([{ source: f.source, claim: f.title, confidence: f.confidence ?? 0.7 }]),
    ],
  );
}

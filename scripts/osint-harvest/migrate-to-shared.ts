/**
 * One-shot: ensure shared harvest schema, copy unique findings from
 * judicium + h3xa product DBs into harvest DB.
 *
 *   npx tsx scripts/osint-harvest/migrate-to-shared.ts
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { ensureHarvestSchema } from './pg-writer.js';
import { hostifyDatabaseUrl } from './infisical-db.js';

function loadEnv(file: string): Record<string, string> {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return {};
  return dotenv.parse(fs.readFileSync(full));
}

function urlFrom(env: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (env[k]) return hostifyDatabaseUrl(env[k]);
  }
  return undefined;
}

async function migrateProduct(label: string, sourceUrl: string, dest: Pool): Promise<void> {
  const src = new Pool({ connectionString: sourceUrl, max: 2 });
  try {
    const has = await src.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='osint_harvest_findings'`,
    );
    if (!has.rowCount) {
      console.log(`[migrate] ${label}: no harvest tables — skip`);
      return;
    }

    const runs = await src.query(`SELECT * FROM osint_harvest_runs ORDER BY started_at`);
    console.log(`[migrate] ${label}: ${runs.rowCount} runs`);
    for (const r of runs.rows) {
      await dest.query(
        `INSERT INTO osint_harvest_runs
          (id, target, case_id, product, user_id, harvesters, status, total_findings,
           inserted, skipped, errors, started_at, finished_at, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           finished_at = COALESCE(EXCLUDED.finished_at, osint_harvest_runs.finished_at),
           total_findings = EXCLUDED.total_findings,
           inserted = EXCLUDED.inserted,
           skipped = EXCLUDED.skipped,
           product = EXCLUDED.product`,
        [
          r.id,
          r.target,
          r.case_id ?? null,
          label,
          r.user_id || 'harvest',
          r.harvesters || [],
          r.status === 'running' ? 'failed' : r.status, // close stuck runs
          r.total_findings || 0,
          r.inserted || 0,
          r.skipped || 0,
          JSON.stringify(r.errors || []),
          r.started_at,
          r.finished_at || (r.status === 'running' ? new Date() : null),
          JSON.stringify({ ...(r.metadata || {}), migratedFrom: label }),
        ],
      );
    }

    const findings = await src.query(`SELECT * FROM osint_harvest_findings ORDER BY created_at`);
    let inserted = 0;
    let skipped = 0;
    for (const f of findings.rows) {
      const result = await dest.query(
        `INSERT INTO osint_harvest_findings
          (id, run_id, case_id, product, source, source_id, entity_type, value, label, title,
           description, severity, confidence, tags, content_hash, raw, related, observed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [
          f.id,
          f.run_id,
          f.case_id ?? null,
          label,
          f.source,
          f.source_id,
          f.entity_type,
          f.value,
          f.label || '',
          f.title || '',
          f.description || '',
          f.severity || 'info',
          f.confidence ?? 0.7,
          f.tags || [],
          f.content_hash,
          JSON.stringify(f.raw || {}),
          JSON.stringify(f.related || []),
          f.observed_at,
          f.created_at,
        ],
      );
      if (result.rowCount) inserted++;
      else skipped++;
    }
    console.log(`[migrate] ${label}: findings inserted=${inserted} skipped(dup)=${skipped}`);
  } finally {
    await src.end();
  }
}

async function main() {
  const harvestEnv = { ...loadEnv('.env.harvest.local'), ...process.env };
  const harvestUrl = urlFrom(harvestEnv as Record<string, string>, [
    'HARVEST_DATABASE_URL',
    'DATABASE_URL',
  ]);
  if (!harvestUrl) {
    throw new Error('HARVEST_DATABASE_URL missing — set in .env.harvest.local');
  }

  const judiciumUrl = urlFrom(loadEnv('.env.local'), ['DATABASE_URL']);
  const h3xaUrl = urlFrom(loadEnv('.env.h3xa.local'), ['DATABASE_URL']);

  console.log(`[migrate] dest=${new URL(harvestUrl).pathname}`);
  const dest = new Pool({ connectionString: harvestUrl, max: 5 });
  try {
    await ensureHarvestSchema(dest);
    if (judiciumUrl) await migrateProduct('judicium', judiciumUrl, dest);
    if (h3xaUrl) await migrateProduct('h3xa', h3xaUrl, dest);

    const stats = await dest.query(`
      SELECT
        (SELECT COUNT(*)::int FROM osint_harvest_runs) AS runs,
        (SELECT COUNT(*)::int FROM osint_harvest_findings) AS findings,
        (SELECT COUNT(DISTINCT product)::int FROM osint_harvest_findings) AS products
    `);
    console.log('[migrate] shared harvest store:', stats.rows[0]);
  } finally {
    await dest.end();
  }
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});

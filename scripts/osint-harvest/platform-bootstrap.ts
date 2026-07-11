#!/usr/bin/env tsx
/**
 * Bootstrap Collection Platform levels 4–6:
 *   - Schema migration (provenance, graph, observation events)
 *   - Registry strategy upgrade
 *   - Backfill collection graph from existing findings
 *   - Sync observations → H3XA STIX
 *   - Optionally enqueue due target collections
 *
 *   npm run osint:platform:bootstrap
 *   npm run osint:platform:bootstrap -- --run-due
 *   npm run osint:platform:bootstrap -- --run-due --wait
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

function loadEnv() {
  const root = process.cwd();
  for (const file of ['.env.harvest.local', '.env.h3xa.local', '.env.local']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
  }
}

function harvestDbUrl(): string {
  const raw = process.env.HARVEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('HARVEST_DATABASE_URL required');
  return raw.replace(/@postgres-main:5432\b/, '@127.0.0.1:5499');
}

function parseArgs(argv: string[]) {
  return {
    runDue: argv.includes('--run-due'),
    dryRun: argv.includes('--dry-run'),
    skipH3xa: argv.includes('--skip-h3xa'),
    wait: argv.includes('--wait'),
    force: argv.includes('--force') || argv.includes('--run-due'),
  };
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: harvestDbUrl() });

  const { bootstrapCollectionPlatform } = await import('../../src/collection/intelligence-bridge.js');
  const result = await bootstrapCollectionPlatform(pool, {
    sync_h3xa: !args.skipH3xa,
    run_due: args.runDue,
    dry_run: args.dryRun,
    force: args.force,
  });

  console.log('COLLECTION_BOOTSTRAP=', JSON.stringify(result, null, 2));

  if (args.runDue && args.wait && !args.dryRun) {
    const { waitForCascadesRun } = await import('../../src/collection/cascadesClient.js');
    const submissions = (result.due_submissions as { submissions?: Array<{ cascades_run_id: string }> })?.submissions || [];
    for (const sub of submissions) {
      if (!sub.cascades_run_id) continue;
      try {
        const detail = await waitForCascadesRun(sub.cascades_run_id, { timeoutMs: 300_000 });
        console.log('RUN_COMPLETE=', sub.cascades_run_id, detail.status);
      } catch (err) {
        console.warn('RUN_WAIT_FAILED=', sub.cascades_run_id, (err as Error).message);
      }
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

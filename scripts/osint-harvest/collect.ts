#!/usr/bin/env tsx
/**
 * Collection Platform CLI — thin client that enqueues Cascades workflow runs.
 *
 *   npm run osint:collect -- --target-id <uuid>
 *   npm run osint:collect -- --target noirstack.com
 *   npm run osint:collect:due
 *   npm run osint:registry:seed
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

function loadEnv() {
  const root = process.cwd();
  for (const file of ['.env.harvest.local', '.env.local']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
  }
  if (process.env.HARVEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.HARVEST_DATABASE_URL;
  }
}

function dbUrl(): string {
  const raw = process.env.HARVEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('HARVEST_DATABASE_URL required');
  return raw.replace(/@postgres-main:5432\b/, '@127.0.0.1:5499');
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--wait') args.wait = true;
    else if (a === '--force') args.force = true;
    else if (a === '--due') args.due = true;
    else if (a === '--seed') args.seed = true;
    else if (a.startsWith('--') && i + 1 < argv.length) {
      args[a.slice(2)] = argv[++i];
    }
  }
  return args;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: dbUrl() });

  if (args.seed) {
    const { ensureCollectionSchema, seedTargetsFromFile } = await import(
      '../../src/collection/targetRegistry.js'
    );
    await ensureCollectionSchema(pool);
    const file = path.join(process.cwd(), 'scripts/osint-harvest/targets.txt');
    const content = fs.readFileSync(file, 'utf8');
    const r = await seedTargetsFromFile(pool, content);
    console.log('COLLECTION_SEED=', JSON.stringify(r));
    await pool.end();
    return;
  }

  const {
    submitDueTargetsToCascades,
    submitTargetIdToCascades,
  } = await import('../../src/collection/submitDue.js');
  const {
    getTargetByValue,
    upsertTarget,
    inferTargetType,
    ensureCollectionSchema,
  } = await import('../../src/collection/targetRegistry.js');

  await ensureCollectionSchema(pool);
  const dryRun = Boolean(args.dryRun);
  const wait = Boolean(args.wait);
  const force = Boolean(args.force);
  const targetsFile = path.join(process.cwd(), 'scripts/osint-harvest/targets.txt');

  if (args.due) {
    const { submissions, failed } = await submitDueTargetsToCascades(pool, {
      dryRun,
      wait,
      force,
      seedFromTargetsFile: targetsFile,
      actor: force ? 'cli:collect-due-force' : 'cli:collect-due',
    });
    console.log(
      'COLLECTION_DUE=',
      JSON.stringify({
        engine: 'cascades',
        submissions: submissions.length,
        failed,
        results: submissions,
      }),
    );
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }

  const targetId = String(args['target-id'] || args.targetId || '');
  const targetValue = String(args.target || '');

  if (targetId) {
    const result = await submitTargetIdToCascades(pool, targetId, { dryRun, wait, force });
    console.log('COLLECTION_RESULT=', JSON.stringify({ engine: 'cascades', ...result }));
    await pool.end();
    process.exit(result?.error ? 1 : 0);
  }

  if (targetValue) {
    let target = await getTargetByValue(
      pool,
      inferTargetType(targetValue),
      targetValue,
      String(args.product || 'shared'),
    );
    if (!target) {
      target = await upsertTarget(pool, {
        target_type: inferTargetType(targetValue),
        value: targetValue,
        product: String(args.product || 'shared'),
        origin: 'api',
      });
    }
    const result = await submitTargetIdToCascades(pool, target.id, { dryRun, wait, force });
    console.log('COLLECTION_RESULT=', JSON.stringify({ engine: 'cascades', ...result }));
    await pool.end();
    process.exit(result?.error ? 1 : 0);
  }

  console.error('Usage: --target-id <uuid> | --target <value> | --due | --seed');
  await pool.end();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

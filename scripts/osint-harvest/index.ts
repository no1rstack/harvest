/**
 * Judicium OSINT harvest CLI — passive internet collection → PostgreSQL.
 *
 * Usage:
 *   npm run osint:harvest -- --target example.com
 *   npm run osint:harvest -- --target example.com --case 12 --harvesters crtsh,dns,rdap
 *   npm run osint:harvest -- --list
 *
 * Tools inspired by ENNA OSINT index (https://www.en-na.com/#tools).
 * Does NOT include Social-Engineer Toolkit attack modules — SET is for authorized
 * phishing assessments only; Judicium harvest is passive investigative collection.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { crtshHarvester } from './harvesters/crtsh.js';
import { dnsHarvester } from './harvesters/dns.js';
import { rdapHarvester } from './harvesters/rdap.js';
import { waybackHarvester } from './harvesters/wayback.js';
import { hackertargetHarvester } from './harvesters/hackertarget.js';
import { urlhausHarvester } from './harvesters/urlhaus.js';
import { rssHarvester } from './harvesters/rss.js';
import { theHarvesterCli, amassCli } from './harvesters/external-cli.js';
import {
  ensureHarvestSchema,
  startHarvestRun,
  finishHarvestRun,
  persistFindings,
} from './pg-writer.js';
import type { Harvester, HarvestFinding, HarvestRunSummary } from './types.js';
import {
  type HarvestProduct,
  PRODUCT_PROJECTS,
  INFISICAL_DOMAIN,
  describeDatabaseUrl,
  fetchDatabaseUrlFromInfisical,
  persistDatabaseUrl,
  hostifyDatabaseUrl,
} from './infisical-db.js';

/** Load env files without overriding already-set vars. */
function loadEnvFiles(product?: HarvestProduct) {
  const root = process.cwd();
  const files = ['.env', '.env.local', '.env.h3xa.local', '.env.hexsocial.local', '.env.harvest.local'];
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    dotenv.config({ path: full, override: false });
  }
  // Product overlay wins for DATABASE_URL / HARVEST_DATABASE_URL
  if (product) {
    const overlay = path.join(root, PRODUCT_PROJECTS[product].envFile);
    if (fs.existsSync(overlay)) {
      dotenv.config({ path: overlay, override: true });
    }
  }
  // Shared harvest store: prefer HARVEST_DATABASE_URL
  if (product === 'harvest' || process.env.HARVEST_DATABASE_URL) {
    if (process.env.HARVEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.HARVEST_DATABASE_URL;
    }
  }
}

const ALL_HARVESTERS: Harvester[] = [
  crtshHarvester,
  dnsHarvester,
  rdapHarvester,
  waybackHarvester,
  hackertargetHarvester,
  urlhausHarvester,
  rssHarvester,
  theHarvesterCli,
  amassCli,
];

const DEFAULT_SET = ['crtsh', 'dns', 'rdap', 'wayback', 'hackertarget', 'urlhaus'];

function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.HARVEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (process.env.H3XA_PG_HOST_REWRITE === '0') return raw;
  return hostifyDatabaseUrl(raw);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list' || a === '-l') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-feed') args.noFeed = true;
    else if (a === '--no-evidence') args.noEvidence = true;
    else if (a === '--sync-infisical') args.syncInfisical = true;
    else if (a.startsWith('--') && i + 1 < argv.length) {
      args[a.slice(2)] = argv[++i];
    }
  }
  return args;
}

function usage() {
  console.log(`
OSINT Harvest → shared harvest PostgreSQL (via Infisical)

  npm run osint:harvest -- --target <domain> [options]
  npm run osint:db:sync -- harvest

Options:
  --product          harvest (default) | judicium | h3xa
                     harvest → HARVEST_DATABASE_URL (shared store @ ${INFISICAL_DOMAIN})
  --tag              product label stored on rows (h3xa|judicium|shared)
  --target, -t       Domain, IP, or keyword to harvest (required unless --list)
  --harvesters       Comma list (default: ${DEFAULT_SET.join(',')})
  --case             Case ID (soft ref; evidence dual-write only on product DBs)
  --max              Max findings per harvester (default: 100)
  --timeout          Per-request timeout ms (default: 30000)
  --user             user_id for harvest run (default: harvest)
  --sync-infisical   Force refresh URL from Infisical before run
  --dry-run          Collect but do not write Postgres
  --no-feed          Skip feed_items upsert
  --no-evidence      Skip evidence/case_entities even with --case
  --list             List available harvesters
  --help             Show this help

Collection Platform (required):
  osint:harvest --target <domain> now enqueues passive-domain-collection on Cascades.
  Use npm run osint:collect -- --target <domain> [--wait] for the same path.
  Direct connector execution in this CLI is retired.

DB convention:
  harvest  → harvest_user @ harvest   (default shared store)
  judicium → judicium_user @ judicium (legacy product DB)
  h3xa     → h3xa_user @ h3xa

Env:
  INFISICAL_TOKEN or /home/hira/scripts/.infisical-token
  HARVEST_DATABASE_URL  preferred for shared store
`);
}

function resolveProduct(raw: string | boolean | undefined): HarvestProduct | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const p = raw.toLowerCase();
  if (p === 'judicium' || p === 'h3xa' || p === 'harvest') return p;
  throw new Error(`--product must be harvest, judicium, or h3xa (got ${raw})`);
}

function applyProductDatabase(product: HarvestProduct, sync: boolean): void {
  const cfg = PRODUCT_PROJECTS[product];
  console.log(`[osint:harvest] product=${product} infisical=${INFISICAL_DOMAIN} project=${cfg.projectId}`);
  const hasUrl =
    product === 'harvest'
      ? Boolean(process.env.HARVEST_DATABASE_URL || process.env.DATABASE_URL)
      : Boolean(process.env.DATABASE_URL);
  if (sync || !hasUrl) {
    const url = fetchDatabaseUrlFromInfisical(product);
    const file = persistDatabaseUrl(product, url);
    if (product === 'harvest') {
      process.env.HARVEST_DATABASE_URL = url;
      process.env.DATABASE_URL = url;
    } else {
      process.env.DATABASE_URL = url;
    }
    process.env.H3XA_PG_HOST_REWRITE = '0';
    console.log(`[osint:harvest] infisical ${cfg.secretKey} → ${file}`);
  } else if (product === 'harvest') {
    const url = hostifyDatabaseUrl(process.env.HARVEST_DATABASE_URL || process.env.DATABASE_URL!);
    process.env.HARVEST_DATABASE_URL = url;
    process.env.DATABASE_URL = url;
  } else {
    process.env.DATABASE_URL = hostifyDatabaseUrl(process.env.DATABASE_URL!);
  }
  console.log(`[osint:harvest] ${describeDatabaseUrl(process.env.DATABASE_URL!)}`);
}

function createPool(): Pool | null {
  const url = resolveDatabaseUrl();
  if (url) {
    try {
      const parsed = new URL(url);
      console.log(
        `[osint:harvest] postgres=${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`,
      );
    } catch {
      console.log('[osint:harvest] postgres=DATABASE_URL');
    }
    return new Pool({ connectionString: url, max: 5 });
  }
  if (process.env.PGHOST) {
    console.log(
      `[osint:harvest] postgres=${process.env.PGHOST}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'judicium'}`,
    );
    return new Pool({
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'judicium',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      max: 5,
    });
  }
  return null;
}

async function assertCaseExists(pool: Pool, caseId: number): Promise<boolean> {
  const hasCases = await pool
    .query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cases'`)
    .then((r) => (r.rowCount || 0) > 0)
    .catch(() => false);
  if (!hasCases) {
    console.warn(`[osint:harvest] case ${caseId} ignored — shared harvest store has no cases table`);
    return false;
  }
  const found = await pool.query(`SELECT id, name, status FROM cases WHERE id = $1`, [caseId]);
  if (found.rowCount && found.rows[0]) {
    console.log(`[osint:harvest] case=${caseId} "${found.rows[0].name}" (${found.rows[0].status})`);
    return true;
  }
  const recent = await pool.query(
    `SELECT id, name, status FROM cases ORDER BY id DESC LIMIT 10`,
  );
  const list = recent.rows
    .map((r: { id: number; name: string; status: string }) => `  ${r.id}\t${r.name}\t${r.status}`)
    .join('\n');
  console.warn(
    `[osint:harvest] case ${caseId} not found — continuing without evidence linkage.\n` +
      `Existing cases:\n${list || '  (none)'}`,
  );
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (args.list) {
    console.log('Available harvesters:\n');
    for (const h of ALL_HARVESTERS) {
      console.log(`  ${h.id.padEnd(14)} ${h.name}`);
      console.log(`  ${''.padEnd(14)} ${h.description}`);
      if (h.reference) console.log(`  ${''.padEnd(14)} ${h.reference}`);
      console.log();
    }
    process.exit(0);
  }

  // Default store is the shared harvest DB
  const product = resolveProduct(args.product) || 'harvest';
  loadEnvFiles(product);
  const productTag = String(args.tag || (product === 'harvest' ? 'shared' : product)).toLowerCase();

  const target = String(args.target || args.t || '').trim();
  if (!target) {
    usage();
    process.exit(1);
  }

  const needsSync =
    Boolean(args.syncInfisical) ||
    (product === 'harvest'
      ? !process.env.HARVEST_DATABASE_URL && !process.env.DATABASE_URL
      : !process.env.DATABASE_URL);
  if (!args.dryRun) {
    applyProductDatabase(product, needsSync);
  }

  const caseIdRaw = args.case ? parseInt(String(args.case), 10) : undefined;
  const caseId = Number.isFinite(caseIdRaw) ? caseIdRaw : undefined;

  if (args.harvesters && args.harvesters !== DEFAULT_SET.join(',')) {
    console.warn('[osint:harvest] --harvesters is ignored; Cascades runs the full workflow template.');
  }

  console.log('[osint:harvest] Enqueueing passive-domain-collection on Cascades (direct connectors retired).');

  const dryRun = Boolean(args.dryRun);
  const pool = dryRun ? null : createPool();
  if (!dryRun && !pool) {
    console.error(
      '[osint:harvest] HARVEST_DATABASE_URL not set.\n' +
        '  npm run osint:db:sync -- harvest\n' +
        '  npm run osint:collect -- --target example.com --wait',
    );
    process.exit(1);
  }

  try {
    if (!pool) {
      console.log('[osint:harvest] dry-run — would enqueue Cascades workflow');
      process.exit(0);
    }

    const { ensureCollectionSchema, getTargetByValue, upsertTarget, inferTargetType } = await import(
      '../../src/collection/targetRegistry.js'
    );
    const { submitTargetIdToCascades } = await import('../../src/collection/submitDue.js');
    await ensureCollectionSchema(pool);

    let regTarget = await getTargetByValue(pool, inferTargetType(target), target, productTag);
    if (!regTarget) {
      regTarget = await upsertTarget(pool, {
        target_type: inferTargetType(target),
        value: target,
        product: productTag,
        case_id: caseId,
        origin: 'api',
      });
    }

    const result = await submitTargetIdToCascades(pool, regTarget.id, {
      dryRun,
      wait: true,
    });
    console.log('COLLECTION_RESULT=', JSON.stringify({ engine: 'cascades', ...result }));
    process.exit(result?.error ? 1 : 0);
  } finally {
    if (pool) await pool.end();
  }
}

main().catch((err) => {
  console.error('[osint:harvest] fatal:', err);
  process.exit(1);
});

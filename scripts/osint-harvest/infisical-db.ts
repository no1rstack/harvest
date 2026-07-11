/**
 * Resolve DATABASE_URL / HARVEST_DATABASE_URL from Infisical (crypt.noirstack.com).
 * Products: judicium | h3xa | harvest (shared store).
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export type HarvestProduct = 'judicium' | 'h3xa' | 'harvest';

export const INFISICAL_DOMAIN = process.env.INFISICAL_DOMAIN || 'https://crypt.noirstack.com';
export const INFISICAL_ENV = process.env.INFISICAL_ENV || 'prod';

export const PRODUCT_PROJECTS: Record<
  HarvestProduct,
  {
    projectId: string;
    expectUser: string;
    expectDb: string;
    envFile: string;
    /** Infisical secret name */
    secretKey: string;
    /** Local env key written */
    envKey: string;
  }
> = {
  judicium: {
    projectId: process.env.JUDICIUM_PROJECT_ID || '5b45a8a0-eb6d-4791-8dd3-705978da44d0',
    expectUser: 'judicium_user',
    expectDb: 'judicium',
    envFile: '.env.local',
    secretKey: 'DATABASE_URL',
    envKey: 'DATABASE_URL',
  },
  h3xa: {
    projectId: process.env.H3XA_PROJECT_ID || 'd88b5ad3-da33-4c65-9598-500abdcba50f',
    expectUser: 'h3xa_user',
    expectDb: 'h3xa',
    envFile: '.env.h3xa.local',
    secretKey: 'DATABASE_URL',
    envKey: 'DATABASE_URL',
  },
  harvest: {
    projectId: process.env.HARVEST_PROJECT_ID || process.env.INFISICAL_PROJECT_ID || 'f7f058b6-d267-45c1-9311-e0962a74e923',
    expectUser: 'harvest_user',
    expectDb: 'harvest',
    envFile: '.env.harvest.local',
    secretKey: 'HARVEST_DATABASE_URL',
    envKey: 'HARVEST_DATABASE_URL',
  },
};

function loadInfisicalToken(): string {
  if (process.env.INFISICAL_TOKEN) return process.env.INFISICAL_TOKEN;
  const tokenFile = '/home/hira/scripts/.infisical-token';
  if (fs.existsSync(tokenFile)) {
    const text = fs.readFileSync(tokenFile, 'utf8');
    const m = text.match(/^\s*export\s+INFISICAL_TOKEN=(['"]?)(.+?)\1\s*$/m)
      || text.match(/^\s*INFISICAL_TOKEN=(['"]?)(.+?)\1\s*$/m);
    if (m?.[2]) return m[2];
  }
  throw new Error(
    'INFISICAL_TOKEN required — export it or use /home/hira/scripts/.infisical-token',
  );
}

export function hostifyDatabaseUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === 'postgres-main') {
    u.hostname = '127.0.0.1';
    u.port = '5499';
  }
  return u.toString();
}

export function describeDatabaseUrl(url: string): string {
  const u = new URL(url);
  return `user=${u.username} host=${u.hostname}:${u.port || '5432'} db=${u.pathname.replace(/^\//, '')}`;
}

export function fetchDatabaseUrlFromInfisical(product: HarvestProduct): string {
  const cfg = PRODUCT_PROJECTS[product];
  const token = loadInfisicalToken();
  const raw = execFileSync(
    'infisical',
    [
      'secrets',
      'get',
      cfg.secretKey,
      `--projectId=${cfg.projectId}`,
      `--env=${INFISICAL_ENV}`,
      `--domain=${INFISICAL_DOMAIN}`,
      `--token=${token}`,
      '--plain',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

  if (!raw) {
    throw new Error(`${cfg.secretKey} empty in Infisical project ${cfg.projectId} (${product})`);
  }

  const u = new URL(raw);
  if (u.username !== cfg.expectUser || u.pathname.replace(/^\//, '') !== cfg.expectDb) {
    throw new Error(
      `Infisical ${product} ${cfg.secretKey} must be user=${cfg.expectUser} db=${cfg.expectDb} ` +
        `(got user=${u.username} db=${u.pathname.replace(/^\//, '')})`,
    );
  }

  return hostifyDatabaseUrl(raw);
}

/** Write/update URL in the product env overlay (no other keys touched). */
export function persistDatabaseUrl(product: HarvestProduct, url: string): string {
  const cfg = PRODUCT_PROJECTS[product];
  const file = path.join(process.cwd(), cfg.envFile);
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [
    `# Generated from Infisical (${INFISICAL_DOMAIN}) — ${product}`,
    `# user ${cfg.expectUser} / db ${cfg.expectDb}`,
  ];
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${cfg.envKey}=`)) {
      found = true;
      return `${cfg.envKey}=${url}`;
    }
    // Also keep DATABASE_URL in sync for harvest overlay (CLI resolveDatabaseUrl)
    if (product === 'harvest' && line.startsWith('DATABASE_URL=')) {
      return `DATABASE_URL=${url}`;
    }
    return line;
  });
  if (!found) next.push(`${cfg.envKey}=${url}`);
  if (product === 'harvest' && !next.some((l) => l.startsWith('DATABASE_URL='))) {
    next.push(`DATABASE_URL=${url}`);
  }
  if (!next.some((l) => l.startsWith('H3XA_PG_HOST_REWRITE='))) {
    next.push('H3XA_PG_HOST_REWRITE=0');
  }
  fs.writeFileSync(file, next.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n', {
    mode: 0o600,
  });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  return file;
}

/**
 * Dedicated pool for the shared harvest store (harvest_user @ harvest).
 * Prefer HARVEST_DATABASE_URL; fall back to product DATABASE_URL only if unset.
 */

import { Pool, type PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function hostify(url: string): string {
  if (process.env.HARVEST_PG_HOST_REWRITE === '0') return url;
  return url.replace(/@postgres-main:5432\b/g, '@127.0.0.1:5499');
}

function loadHarvestUrl(): string | undefined {
  if (process.env.HARVEST_DATABASE_URL) {
    return hostify(process.env.HARVEST_DATABASE_URL);
  }
  // Host-side overlay used by CLI / Traefik harvest process
  for (const file of ['.env.harvest.local', '.env.local']) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(fs.readFileSync(full));
    if (parsed.HARVEST_DATABASE_URL) return hostify(parsed.HARVEST_DATABASE_URL);
    if (file === '.env.harvest.local' && parsed.DATABASE_URL) return hostify(parsed.DATABASE_URL);
  }
  return undefined;
}

const HARVEST_URL = loadHarvestUrl();
let harvestPool: Pool | null = null;

export function isHarvestPgEnabled(): boolean {
  return Boolean(HARVEST_URL);
}

export function getHarvestPool(): Pool | null {
  if (!HARVEST_URL) return null;
  if (!harvestPool) {
    const config: PoolConfig = { connectionString: HARVEST_URL, max: 5 };
    harvestPool = new Pool(config);
    harvestPool.on('error', (err) => {
      console.error('[harvest] PG pool error:', err.message);
    });
  }
  return harvestPool;
}

export async function harvestQuery(text: string, params?: unknown[]): Promise<any[]> {
  const p = getHarvestPool();
  if (!p) return [];
  const result = await p.query(text, params);
  return result.rows;
}

export async function ensureHarvestConnected(): Promise<boolean> {
  const p = getHarvestPool();
  if (!p) return false;
  await p.query('SELECT 1');
  return true;
}

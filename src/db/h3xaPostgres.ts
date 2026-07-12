/**
 * Dedicated pool for H3XA STIX store (h3xa_user @ h3xa).
 */

import { Pool, type PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function hostify(url: string): string {
  if (process.env.H3XA_PG_HOST_REWRITE === '0') return url;
  return url.replace(/@postgres-main:5432\b/g, '@127.0.0.1:5499');
}

function loadH3xaUrl(): string | undefined {
  if (process.env.H3XA_DATABASE_URL) return hostify(process.env.H3XA_DATABASE_URL);
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }
  for (const file of ['.env.h3xa.local', '.env.local']) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(fs.readFileSync(full));
    if (parsed.H3XA_DATABASE_URL) return hostify(parsed.H3XA_DATABASE_URL);
    if (file === '.env.h3xa.local' && parsed.DATABASE_URL) return hostify(parsed.DATABASE_URL);
  }
  return undefined;
}

const H3XA_URL = loadH3xaUrl();
let h3xaPool: Pool | null = null;

export function isH3xaPgEnabled(): boolean {
  return Boolean(H3XA_URL);
}

export function getH3xaPool(): Pool | null {
  if (!H3XA_URL) return null;
  if (!h3xaPool) {
    const config: PoolConfig = { connectionString: H3XA_URL, max: 5 };
    h3xaPool = new Pool(config);
    h3xaPool.on('error', (err) => {
      console.error('[h3xa] PG pool error:', err.message);
    });
  }
  return h3xaPool;
}

export async function h3xaQuery(text: string, params?: unknown[]): Promise<any[]> {
  const p = getH3xaPool();
  if (!p) return [];
  const result = await p.query(text, params);
  return result.rows;
}

export async function h3xaRun(text: string, params?: unknown[]): Promise<void> {
  const p = getH3xaPool();
  if (!p) return;
  await p.query(text, params);
}

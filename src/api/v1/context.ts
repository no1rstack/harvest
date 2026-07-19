import type { Pool } from 'pg';
import { getHarvestPool } from '../../db/harvestPostgres.js';

export interface HarvestV1Context {
  pool: Pool | null;
}

export function getV1Context(): HarvestV1Context {
  return { pool: getHarvestPool() };
}

export function requirePool(res: import('express').Response): Pool | null {
  const pool = getHarvestPool();
  if (!pool) {
    res.status(503).json({ error: 'HARVEST_DATABASE_URL not configured' });
    return null;
  }
  return pool;
}

export function parseIntQuery(value: unknown, fallback: number, max?: number): number {
  const n = parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  if (max != null) return Math.min(Math.max(n, 1), max);
  return n;
}

export function parseStringQuery(value: unknown): string | undefined {
  const s = String(value || '').trim();
  return s || undefined;
}

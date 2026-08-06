import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import type { CatalogHeat, CatalogSnapshot, TableLiveStats } from './types.js';

export interface DatabaseConfig {
  id: string;
  label: string;
  owner: string;
  url: string;
}

const STATS_SQL = `
SELECT s.relname, s.n_live_tup, s.n_dead_tup, s.seq_scan, s.idx_scan,
       s.n_tup_ins, s.n_tup_upd, s.n_tup_del, pg_total_relation_size(s.relid) AS size_bytes
FROM pg_stat_user_tables s ORDER BY s.n_live_tup DESC`;

function rewriteDbUrl(baseUrl: string, user: string, db: string): string {
  return baseUrl.replace(/\/[^/?]+(\?|$)/, `/${db}$1`).replace(/:\/\/[^:]+:/, `://${user}:`);
}

function hostify(url: string): string {
  // Match harvestPostgres.ts hostify — rewrite postgres-main when running outside podman
  if (process.env.HARVEST_PG_HOST_REWRITE === '0') return url;
  return url.replace(/@postgres-main:5432\b/g, '@127.0.0.1:5499');
}

export function getDatabaseConfigs(): DatabaseConfig[] {
  const harvestUrl = process.env.HARVEST_DATABASE_URL;
  const configs: DatabaseConfig[] = [];
  if (harvestUrl) configs.push({ id: 'harvest', label: 'Harvest', owner: 'harvest', url: hostify(harvestUrl) });
  // Use explicit URLs when set (different passwords), otherwise derive from harvestUrl
  const judExplicit = process.env.DATA_CATALOG_JUDICIUM_DATABASE_URL;
  const h3xaExplicit = process.env.DATA_CATALOG_H3XA_DATABASE_URL || process.env.H3XA_DATABASE_URL;
  const jud = judExplicit || (harvestUrl ? rewriteDbUrl(harvestUrl, 'judicium_user', 'judicium') : '');
  if (jud) configs.push({ id: 'judicium', label: 'Judicium PG', owner: 'judicium', url: judExplicit ? jud : hostify(jud) });
  const h3xa = h3xaExplicit || (harvestUrl ? rewriteDbUrl(harvestUrl, 'h3xa_user', 'h3xa') : '');
  if (h3xa && h3xa !== jud) configs.push({ id: 'h3xa', label: 'H3XA', owner: 'h3xa', url: h3xaExplicit ? h3xa : hostify(h3xa) });
  return configs;
}

function classifyHeat(row: { n_live_tup: number; seq_scan: number; idx_scan: number; n_tup_ins: number; n_tup_upd: number }): CatalogHeat {
  const rows = Number(row.n_live_tup) || 0;
  const seq = Number(row.seq_scan) || 0;
  const idx = Number(row.idx_scan) || 0;
  const ins = Number(row.n_tup_ins) || 0;
  const upd = Number(row.n_tup_upd) || 0;
  if (rows === 0) return 'unused';
  if (seq > idx * 2 && seq > 50 && rows > 10) return 'needs-attention';
  if (upd > ins * 0.5 && upd > 100) return 'update-heavy';
  if (upd <= ins * 0.1 && ins > 0) return 'append-only';
  return 'healthy';
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function collectDatabaseStats(config: DatabaseConfig, prior?: Record<string, number>) {
  const pool = new Pool({ connectionString: config.url, max: 2, connectionTimeoutMillis: 5000 });
  try {
    const result = await pool.query(STATS_SQL);
    const tables = result.rows.map((row) => {
      const rows = Number(row.n_live_tup) || 0;
      const seq = Number(row.seq_scan) || 0;
      const idx = Number(row.idx_scan) || 0;
      const priorRows = prior?.[row.relname];
      const live: TableLiveStats = {
        rows,
        deadRows: Number(row.n_dead_tup) || 0,
        sizeBytes: Number(row.size_bytes) || 0,
        sizePretty: prettyBytes(Number(row.size_bytes) || 0),
        seqScan: seq,
        idxScan: idx,
        idxPct: seq + idx > 0 ? Math.round((idx / (seq + idx)) * 1000) / 10 : 0,
        inserts: Number(row.n_tup_ins) || 0,
        updates: Number(row.n_tup_upd) || 0,
        deletes: Number(row.n_tup_del) || 0,
        heat: classifyHeat(row),
        growthToday: priorRows != null ? rows - priorRows : null,
        growthPct: priorRows != null && priorRows > 0 ? Math.round(((rows - priorRows) / priorRows) * 1000) / 10 : null,
      };
      return { table: row.relname as string, live };
    });
    return { connected: true, tables };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    const clean = /password authentication failed/i.test(msg)
      ? 'unreachable — database requires authentication (not configured locally)'
      : msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
    return { connected: false, error: clean, tables: [] as Array<{ table: string; live: TableLiveStats }> };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function sampleTableRows(config: DatabaseConfig, table: string, limit = 8) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) return { error: 'Invalid table' };
  const pool = new Pool({ connectionString: config.url, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const result = await pool.query(`SELECT * FROM "${table}" ORDER BY 1 DESC LIMIT $1`, [limit]);
    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) {
        const v = row[col];
        out[col] = typeof v === 'string' && v.length > 240 ? `${v.slice(0, 240)}…` : v;
      }
      return out;
    });
    return { columns, rows };
  } catch (err: unknown) {
    return { error: (err as Error).message };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function fetchDomainEvents(harvestUrl: string, limit = 40) {
  const pool = new Pool({ connectionString: harvestUrl, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const r = await pool.query(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload, created_at FROM domain_events ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows;
  } catch {
    return [];
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function fetchCascadesHealth() {
  const base = (process.env.CASCADES_API_URL || 'http://cascades:3000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { connected: false, url: base, error: `HTTP ${res.status}` };
    return { connected: true, url: base, health: await res.json() };
  } catch (err: unknown) {
    return { connected: false, url: base, error: (err as Error).message };
  }
}

export function snapshotPath(): string {
  return path.join(process.env.HARVEST_PLATFORM_CONFIG_DIR || path.join(process.cwd(), 'data'), 'catalog-snapshots.json');
}

export function loadSnapshots(): CatalogSnapshot[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSnapshot(snapshots: CatalogSnapshot[], databases: Record<string, Record<string, number>>): void {
  const file = snapshotPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const last = snapshots[snapshots.length - 1];
  if (last?.capturedAt?.startsWith(today)) snapshots[snapshots.length - 1] = { capturedAt: new Date().toISOString(), databases };
  else snapshots.push({ capturedAt: new Date().toISOString(), databases });
  fs.writeFileSync(file, JSON.stringify(snapshots.slice(-90), null, 2));
}

export function priorRowCounts(snapshots: CatalogSnapshot[], databaseId: string): Record<string, number> | undefined {
  if (snapshots.length < 2) return snapshots[0]?.databases[databaseId];
  return snapshots[snapshots.length - 2]?.databases[databaseId];
}

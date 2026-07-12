/**
 * Persistent registry of RSS/Atom sources for community feeds aggregation.
 */

import type { Pool } from 'pg';
import { ensureCommunitySchema } from './communityStorePg.js';

export interface CommunityFeedSource {
  id: string;
  name: string;
  siteUrl: string;
  feedUrl: string;
  category: string;
  enabled: boolean;
  autoPull: boolean;
  discoveredVia: string;
  lastCheckedAt?: string;
  lastOkAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export const FEED_SOURCES_DDL = `
  CREATE TABLE IF NOT EXISTS community_feed_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    site_url TEXT NOT NULL,
    feed_url TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'osint',
    enabled BOOLEAN DEFAULT true,
    auto_pull BOOLEAN DEFAULT true,
    discovered_via TEXT DEFAULT 'manual',
    last_checked_at TIMESTAMPTZ,
    last_ok_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_community_feed_sources_enabled ON community_feed_sources(enabled);
`;

let feedSourcesSchemaReady = false;

export async function ensureFeedSourcesSchema(pool: Pool): Promise<void> {
  await ensureCommunitySchema(pool);
  if (feedSourcesSchemaReady) return;
  await pool.query(FEED_SOURCES_DDL);
  feedSourcesSchemaReady = true;
}

function rowToSource(row: Record<string, unknown>): CommunityFeedSource {
  return {
    id: String(row.id),
    name: String(row.name),
    siteUrl: String(row.site_url),
    feedUrl: String(row.feed_url),
    category: String(row.category || 'osint'),
    enabled: Boolean(row.enabled),
    autoPull: row.auto_pull !== false,
    discoveredVia: String(row.discovered_via || 'manual'),
    lastCheckedAt: row.last_checked_at ? new Date(String(row.last_checked_at)).toISOString() : undefined,
    lastOkAt: row.last_ok_at ? new Date(String(row.last_ok_at)).toISOString() : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function stableFeedSourceId(feedUrl: string): string {
  let h = 0;
  for (let i = 0; i < feedUrl.length; i++) h = (Math.imul(31, h) + feedUrl.charCodeAt(i)) | 0;
  return `rss-src:${(h >>> 0).toString(36)}`;
}

export async function listFeedSources(
  pool: Pool,
  options?: { enabledOnly?: boolean },
): Promise<CommunityFeedSource[]> {
  await ensureFeedSourcesSchema(pool);
  const where = options?.enabledOnly ? 'WHERE enabled = true AND auto_pull = true' : '';
  const result = await pool.query(
    `SELECT * FROM community_feed_sources ${where} ORDER BY name ASC, created_at DESC`,
  );
  return result.rows.map((row) => rowToSource(row as Record<string, unknown>));
}

export async function upsertFeedSource(
  pool: Pool,
  input: {
    id?: string;
    name: string;
    siteUrl: string;
    feedUrl: string;
    category?: string;
    enabled?: boolean;
    autoPull?: boolean;
    discoveredVia?: string;
  },
): Promise<CommunityFeedSource> {
  await ensureFeedSourcesSchema(pool);
  const now = new Date().toISOString();
  const id = input.id || stableFeedSourceId(input.feedUrl);
  const result = await pool.query(
    `INSERT INTO community_feed_sources
      (id, name, site_url, feed_url, category, enabled, auto_pull, discovered_via, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     ON CONFLICT (feed_url) DO UPDATE SET
       name = EXCLUDED.name,
       site_url = EXCLUDED.site_url,
       category = EXCLUDED.category,
       enabled = EXCLUDED.enabled,
       auto_pull = EXCLUDED.auto_pull,
       discovered_via = EXCLUDED.discovered_via,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      id,
      input.name,
      input.siteUrl,
      input.feedUrl,
      input.category || 'osint',
      input.enabled !== false,
      input.autoPull !== false,
      input.discoveredVia || 'manual',
      now,
    ],
  );
  return rowToSource(result.rows[0] as Record<string, unknown>);
}

export async function patchFeedSource(
  pool: Pool,
  id: string,
  patch: Partial<Pick<CommunityFeedSource, 'name' | 'category' | 'enabled' | 'autoPull'>>,
): Promise<CommunityFeedSource | null> {
  await ensureFeedSourcesSchema(pool);
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (patch.name != null) {
    fields.push(`name = $${idx++}`);
    values.push(patch.name);
  }
  if (patch.category != null) {
    fields.push(`category = $${idx++}`);
    values.push(patch.category);
  }
  if (patch.enabled != null) {
    fields.push(`enabled = $${idx++}`);
    values.push(patch.enabled);
  }
  if (patch.autoPull != null) {
    fields.push(`auto_pull = $${idx++}`);
    values.push(patch.autoPull);
  }
  if (!fields.length) {
    const existing = await pool.query('SELECT * FROM community_feed_sources WHERE id = $1', [id]);
    return existing.rows[0] ? rowToSource(existing.rows[0] as Record<string, unknown>) : null;
  }
  fields.push(`updated_at = $${idx++}`);
  values.push(new Date().toISOString());
  values.push(id);
  const result = await pool.query(
    `UPDATE community_feed_sources SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ? rowToSource(result.rows[0] as Record<string, unknown>) : null;
}

export async function deleteFeedSource(pool: Pool, id: string): Promise<boolean> {
  await ensureFeedSourcesSchema(pool);
  const result = await pool.query('DELETE FROM community_feed_sources WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function touchFeedSourceHealth(
  pool: Pool,
  id: string,
  health: { ok: boolean; error?: string },
): Promise<void> {
  await ensureFeedSourcesSchema(pool);
  const now = new Date().toISOString();
  if (health.ok) {
    await pool.query(
      `UPDATE community_feed_sources
       SET last_checked_at = $1, last_ok_at = $1, last_error = NULL, updated_at = $1
       WHERE id = $2`,
      [now, id],
    );
    return;
  }
  await pool.query(
    `UPDATE community_feed_sources
     SET last_checked_at = $1, last_error = $2, updated_at = $1
     WHERE id = $3`,
    [now, health.error || 'pull failed', id],
  );
}

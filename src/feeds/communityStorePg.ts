/**
 * Community Intelligence persistence in Harvest Postgres.
 */

import type { Pool } from 'pg';
import type {
  CommunityGeoQuality,
  CommunityItem,
  CommunitySeverity,
  CommunitySourceClass,
  CommunityStreamStatus,
} from './communityTypes.js';
import { inferSourceClass } from './communityTypes.js';
import { enrichCommunityPayloadAsync } from './feedEnrichment.js';

export const COMMUNITY_STORE_DDL = `
  CREATE TABLE IF NOT EXISTS community_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    source_class TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT,
    stream TEXT NOT NULL,
    category TEXT DEFAULT 'News',
    severity TEXT DEFAULT 'low',
    published_at TIMESTAMPTZ NOT NULL,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    geo_quality TEXT DEFAULT 'none',
    location TEXT,
    original_link TEXT,
    cluster_id TEXT,
    severity_score DOUBLE PRECISION,
    payload_json JSONB DEFAULT '{}',
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_community_items_published ON community_items(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_community_items_class ON community_items(source_class);
  CREATE INDEX IF NOT EXISTS idx_community_items_stream ON community_items(stream);

  CREATE TABLE IF NOT EXISTS community_stream_status (
    stream TEXT PRIMARY KEY,
    last_ok_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error TEXT,
    last_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

let schemaReady = false;

export async function ensureCommunitySchema(pool: Pool): Promise<void> {
  if (schemaReady) return;
  await pool.query(COMMUNITY_STORE_DDL);
  schemaReady = true;
}

function rowToItem(row: Record<string, unknown>): CommunityItem {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary || ''),
    sourceClass: row.source_class as CommunitySourceClass,
    sourceName: String(row.source_name),
    sourceUrl: row.source_url ? String(row.source_url) : undefined,
    stream: String(row.stream),
    category: String(row.category || 'News'),
    severity: (row.severity || 'low') as CommunitySeverity,
    publishedAt: new Date(String(row.published_at)).toISOString(),
    lat: row.lat != null ? Number(row.lat) : null,
    lon: row.lon != null ? Number(row.lon) : null,
    geoQuality: (row.geo_quality || 'none') as CommunityGeoQuality,
    location: row.location ? String(row.location) : undefined,
    originalLink: row.original_link ? String(row.original_link) : undefined,
    clusterId: row.cluster_id ? String(row.cluster_id) : undefined,
    severityScore: row.severity_score != null ? Number(row.severity_score) : undefined,
    payload: (row.payload_json && typeof row.payload_json === 'object'
      ? row.payload_json
      : {}) as Record<string, unknown>,
  };
}

export function normalizeCommunityItem(raw: Partial<CommunityItem> | Record<string, unknown>): CommunityItem | null {
  const title = String(raw.title || '').trim();
  if (!title) return null;
  const stream = String(raw.stream || raw.source || 'unknown').slice(0, 64);
  const sourceName = String(raw.sourceName || raw.source || stream).slice(0, 160);
  const category = String(raw.category || 'News').slice(0, 64);
  const sourceClass =
    (raw.sourceClass as CommunitySourceClass) ||
    inferSourceClass(stream, sourceName, category);
  const publishedAt = raw.publishedAt
    ? new Date(String(raw.publishedAt)).toISOString()
    : new Date().toISOString();
  const id =
    String(raw.id || '').trim() ||
    `ci-${stream}-${Buffer.from(`${title}|${publishedAt}`).toString('base64url').slice(0, 24)}`;

  let lat = raw.lat != null && Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : null;
  let lon = raw.lon != null && Number.isFinite(Number(raw.lon)) ? Number(raw.lon) : null;
  let geoQuality: CommunityGeoQuality = (raw.geoQuality as CommunityGeoQuality) || 'none';
  if ((lat == null || lon == null) && geoQuality !== 'none') geoQuality = 'none';
  if (lat != null && lon != null && geoQuality === 'none') geoQuality = 'approx';

  return {
    id,
    title: title.slice(0, 240),
    summary: String(raw.summary || '').slice(0, 800),
    sourceClass,
    sourceName,
    sourceUrl: raw.sourceUrl || raw.originalLink ? String(raw.sourceUrl || raw.originalLink) : undefined,
    stream,
    category,
    severity: (['critical', 'high', 'medium', 'low'].includes(String(raw.severity))
      ? raw.severity
      : 'low') as CommunitySeverity,
    publishedAt,
    lat,
    lon,
    geoQuality,
    location: raw.location ? String(raw.location).slice(0, 160) : undefined,
    originalLink: raw.originalLink || raw.sourceUrl ? String(raw.originalLink || raw.sourceUrl) : undefined,
    clusterId: raw.clusterId ? String(raw.clusterId) : undefined,
    severityScore: raw.severityScore != null ? Number(raw.severityScore) : undefined,
    payload: (raw.payload && typeof raw.payload === 'object' ? raw.payload : {}) as Record<string, unknown>,
  };
}

export async function upsertCommunityItems(
  pool: Pool,
  items: Array<Partial<CommunityItem> | CommunityItem>,
  streamHint?: string,
): Promise<{ upserted: number; stream: string }> {
  await ensureCommunitySchema(pool);
  const now = new Date().toISOString();
  let upserted = 0;
  let stream = streamHint || 'mixed';

  for (const raw of items) {
    const item = normalizeCommunityItem(raw);
    if (!item) continue;
    const enrichment = item.payload?.enrichment as { keywords?: string[] } | undefined;
    if (!enrichment?.keywords?.length) {
      item.payload = await enrichCommunityPayloadAsync(item);
    }
    stream = item.stream;
    await pool.query(
      `INSERT INTO community_items (
        id, title, summary, source_class, source_name, source_url, stream, category, severity,
        published_at, lat, lon, geo_quality, location, original_link, cluster_id, severity_score,
        payload_json, first_seen_at, last_seen_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT(id) DO UPDATE SET
        title = EXCLUDED.title, summary = EXCLUDED.summary, source_class = EXCLUDED.source_class,
        source_name = EXCLUDED.source_name, source_url = EXCLUDED.source_url, category = EXCLUDED.category,
        severity = EXCLUDED.severity, published_at = EXCLUDED.published_at, lat = EXCLUDED.lat,
        lon = EXCLUDED.lon, geo_quality = EXCLUDED.geo_quality, location = EXCLUDED.location,
        original_link = EXCLUDED.original_link, cluster_id = EXCLUDED.cluster_id,
        severity_score = EXCLUDED.severity_score, payload_json = EXCLUDED.payload_json,
        last_seen_at = EXCLUDED.last_seen_at`,
      [
        item.id, item.title, item.summary, item.sourceClass, item.sourceName, item.sourceUrl || null,
        item.stream, item.category, item.severity, item.publishedAt, item.lat, item.lon,
        item.geoQuality, item.location || null, item.originalLink || null, item.clusterId || null,
        item.severityScore ?? null, JSON.stringify(item.payload || {}), now, now,
      ],
    );
    upserted++;
  }

  if (streamHint || upserted > 0) {
    await markStreamOk(pool, streamHint || stream, upserted);
  }
  return { upserted, stream: streamHint || stream };
}

export async function markStreamOk(pool: Pool, stream: string, count: number): Promise<void> {
  await ensureCommunitySchema(pool);
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO community_stream_status (stream, last_ok_at, last_error_at, last_error, last_count, updated_at)
     VALUES ($1, $2, NULL, NULL, $3, $2)
     ON CONFLICT(stream) DO UPDATE SET
       last_ok_at = EXCLUDED.last_ok_at, last_error_at = NULL, last_error = NULL,
       last_count = EXCLUDED.last_count, updated_at = EXCLUDED.updated_at`,
    [stream, now, count],
  );
}

export async function markStreamError(pool: Pool, stream: string, error: string): Promise<void> {
  await ensureCommunitySchema(pool);
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO community_stream_status (stream, last_ok_at, last_error_at, last_error, last_count, updated_at)
     VALUES ($1, NULL, $2, $3, 0, $2)
     ON CONFLICT(stream) DO UPDATE SET
       last_error_at = EXCLUDED.last_error_at, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at`,
    [stream, now, error.slice(0, 500)],
  );
}

export interface CommunityQueryOptions {
  hours?: number;
  sourceClass?: string;
  stream?: string;
  category?: string;
  severity?: string;
  q?: string;
  keyword?: string;
  entity?: string;
  needsEnrichment?: boolean;
  limit?: number;
  offset?: number;
}

function buildCommunityWhere(options: CommunityQueryOptions): { clauses: string[]; params: unknown[] } {
  const hours = options.hours ?? 48;
  const clauses = [`published_at >= NOW() - ($1::text || ' hours')::interval`];
  const params: unknown[] = [hours];

  if (options.sourceClass) {
    params.push(options.sourceClass);
    clauses.push(`source_class = $${params.length}`);
  }
  if (options.stream) {
    params.push(options.stream);
    clauses.push(`stream = $${params.length}`);
  }
  if (options.category) {
    params.push(options.category);
    clauses.push(`category = $${params.length}`);
  }
  if (options.severity) {
    params.push(options.severity);
    clauses.push(`severity = $${params.length}`);
  }
  if (options.q) {
    params.push(`%${options.q.trim()}%`);
    clauses.push(`(title ILIKE $${params.length} OR summary ILIKE $${params.length})`);
  }
  if (options.keyword) {
    params.push(options.keyword.trim().toLowerCase());
    clauses.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(payload_json->'enrichment'->'keywords', '[]'::jsonb)) kw
      WHERE kw ILIKE $${params.length}
    )`);
  }
  if (options.entity) {
    params.push(options.entity.trim().toLowerCase());
    clauses.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(payload_json->'enrichment'->'entities', '[]'::jsonb)) ent
      WHERE ent ILIKE $${params.length}
    )`);
  }
  if (options.needsEnrichment) {
    clauses.push(`(
      payload_json->'enrichment' IS NULL
      OR payload_json->'enrichment' = 'null'::jsonb
      OR jsonb_array_length(COALESCE(payload_json->'enrichment'->'keywords', '[]'::jsonb)) = 0
    )`);
  }

  return { clauses, params };
}

export async function getCommunityItemById(pool: Pool, id: string): Promise<CommunityItem | null> {
  await ensureCommunitySchema(pool);
  const result = await pool.query('SELECT * FROM community_items WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? rowToItem(result.rows[0]) : null;
}

export async function listCommunityItems(
  pool: Pool,
  options?: CommunityQueryOptions,
): Promise<CommunityItem[]> {
  return searchCommunityItems(pool, options);
}

export async function searchCommunityItems(
  pool: Pool,
  options?: CommunityQueryOptions,
): Promise<CommunityItem[]> {
  await ensureCommunitySchema(pool);
  const limit = Math.min(options?.limit ?? 300, 1000);
  const offset = Math.max(options?.offset ?? 0, 0);
  const { clauses, params } = buildCommunityWhere(options || {});
  params.push(limit);
  params.push(offset);
  const result = await pool.query(
    `SELECT * FROM community_items WHERE ${clauses.join(' AND ')}
     ORDER BY published_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return result.rows.map(rowToItem);
}

export async function getCommunityFacets(
  pool: Pool,
  options?: { hours?: number; stream?: string; limit?: number },
): Promise<{
  keywords: Array<{ term: string; count: number }>;
  entities: Array<{ term: string; count: number }>;
  categories: Array<{ term: string; count: number }>;
  streams: Array<{ term: string; count: number }>;
}> {
  await ensureCommunitySchema(pool);
  const hours = options?.hours ?? 48;
  const limit = options?.limit ?? 30;
  const streamClause = options?.stream ? 'AND stream = $2' : '';
  const streamParams = options?.stream ? [hours, options.stream] : [hours];

  const keywords = await pool.query(
    `SELECT kw AS term, COUNT(*)::int AS count
     FROM community_items, jsonb_array_elements_text(COALESCE(payload_json->'enrichment'->'keywords', '[]'::jsonb)) kw
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval ${streamClause}
     GROUP BY kw ORDER BY count DESC LIMIT $${streamParams.length + 1}`,
    [...streamParams, limit],
  );
  const entities = await pool.query(
    `SELECT ent AS term, COUNT(*)::int AS count
     FROM community_items, jsonb_array_elements_text(COALESCE(payload_json->'enrichment'->'entities', '[]'::jsonb)) ent
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval ${streamClause}
     GROUP BY ent ORDER BY count DESC LIMIT $${streamParams.length + 1}`,
    [...streamParams, limit],
  );
  const categories = await pool.query(
    `SELECT category AS term, COUNT(*)::int AS count FROM community_items
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval ${streamClause}
     GROUP BY category ORDER BY count DESC LIMIT $${streamParams.length + 1}`,
    [...streamParams, limit],
  );
  const streams = await pool.query(
    `SELECT stream AS term, COUNT(*)::int AS count FROM community_items
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval
     GROUP BY stream ORDER BY count DESC LIMIT $2`,
    [hours, limit],
  );

  return {
    keywords: keywords.rows.map((r) => ({ term: String(r.term), count: Number(r.count) })),
    entities: entities.rows.map((r) => ({ term: String(r.term), count: Number(r.count) })),
    categories: categories.rows.map((r) => ({ term: String(r.term), count: Number(r.count) })),
    streams: streams.rows.map((r) => ({ term: String(r.term), count: Number(r.count) })),
  };
}

export async function listStreamStatus(pool: Pool): Promise<CommunityStreamStatus[]> {
  await ensureCommunitySchema(pool);
  const result = await pool.query('SELECT * FROM community_stream_status ORDER BY stream ASC');
  return result.rows.map((row) => ({
    stream: String(row.stream),
    lastOkAt: row.last_ok_at ? new Date(row.last_ok_at).toISOString() : null,
    lastErrorAt: row.last_error_at ? new Date(row.last_error_at).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    lastCount: Number(row.last_count || 0),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function getCommunityStats(pool: Pool, hours = 48): Promise<{
  total: number;
  byClass: Record<string, number>;
  byStream: Record<string, number>;
}> {
  await ensureCommunitySchema(pool);
  const total = await pool.query(
    `SELECT COUNT(*)::int AS c FROM community_items WHERE published_at >= NOW() - ($1::text || ' hours')::interval`,
    [hours],
  );
  const byClass = await pool.query(
    `SELECT source_class AS k, COUNT(*)::int AS c FROM community_items
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval GROUP BY source_class`,
    [hours],
  );
  const byStream = await pool.query(
    `SELECT stream AS k, COUNT(*)::int AS c FROM community_items
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval GROUP BY stream`,
    [hours],
  );
  const byClassMap: Record<string, number> = {};
  const byStreamMap: Record<string, number> = {};
  for (const r of byClass.rows) byClassMap[String(r.k)] = Number(r.c);
  for (const r of byStream.rows) byStreamMap[String(r.k)] = Number(r.c);
  return {
    total: Number(total.rows[0]?.c || 0),
    byClass: byClassMap,
    byStream: byStreamMap,
  };
}

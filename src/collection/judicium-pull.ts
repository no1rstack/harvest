/**
 * Judicium → Harvest pull bridge.
 * Reads Judicium PG tables and ingests relevant data into Harvest tables.
 * Uses direct DB connection (same PG host) via DATA_CATALOG_JUDICIUM_DATABASE_URL.
 */
import type { Pool } from 'pg';
import type { CommunityItem, CommunitySeverity } from '../feeds/communityTypes.js';
import { Pool as PgPool } from 'pg';

export interface JudiciumPullResult {
  source: string;
  pulled: number;
  ingested: number;
  error?: string;
}

function deriveJudiciumUrl(): string {
  // Auto-derive from HARVEST_DATABASE_URL — same PG host, swap user + db name
  const harvest = process.env.HARVEST_DATABASE_URL;
  if (!harvest) return '';
  return harvest.replace(/\/[^/?]+(\?|$)/, '/judicium$1').replace(/:\/\/[^:]+:/, '://judicium_user:');
}

function getJudiciumPool(): PgPool | null {
  const url = process.env.DATA_CATALOG_JUDICIUM_DATABASE_URL || deriveJudiciumUrl();
  if (!url) return null;
  try {
    return new PgPool({ connectionString: url, max: 2, idleTimeoutMillis: 30000 });
  } catch {
    return null;
  }
}

function severityFromType(type: string): CommunitySeverity {
  const t = type.toLowerCase();
  if (/critical|alert|emergency/.test(t)) return 'critical';
  if (/warning|error|high/.test(t)) return 'high';
  if (/info|normal/.test(t)) return 'low';
  return 'medium';
}

// ─── Pull intelligence_events → domain_events ───

export async function pullJudiciumIntelligenceEvents(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<JudiciumPullResult> {
  const jpool = getJudiciumPool();
  if (!jpool) return { source: 'intelligence_events', pulled: 0, ingested: 0, error: 'DATA_CATALOG_JUDICIUM_DATABASE_URL not set' };

  try {
    // Get last pulled timestamp
    const lastPulled = await harvestPool.query(
      `SELECT MAX(payload->>'judicium_ts') as last_ts
       FROM domain_events
       WHERE payload->>'judicium_source' = 'intelligence_events'`,
    );
    const since = lastPulled.rows[0]?.last_ts;

    let query = `SELECT * FROM intelligence_events`;
    const params: any[] = [];
    if (since) {
      query += ` WHERE created_at > $1`;
      params.push(since);
    }
    query += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
    params.push(opts?.limit ?? 500);

    const { rows } = await jpool.query(query, params);
    let ingested = 0;

    for (const row of rows) {
      try {
        await harvestPool.query(
          `INSERT INTO domain_events
            (id, event_type, aggregate_type, aggregate_id, collection_id, ontology_version, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            `judicium:${row.id}`,
            `judicium.${row.type || 'event'}`,
            row.subject_type || 'intelligence',
            row.subject_id || `j:${row.id}`,
            row.investigation_id || null,
            '1.0',
            JSON.stringify({
              judicium_source: 'intelligence_events',
              judicium_ts: row.created_at,
              judicium_id: row.id,
              title: row.title,
              summary: row.summary,
              source: row.source,
              trace_id: row.trace_id,
              pipeline_id: row.pipeline_id,
              document_id: row.document_id,
              connector_id: row.connector_id,
              investigation_id: row.investigation_id,
              tenant_id: row.tenant_id,
              payload: row.payload,
            }),
            row.created_at,
          ],
        );
        ingested++;
      } catch { /* ON CONFLICT DO NOTHING handles dupes */ }
    }

    await jpool.end().catch(() => {});
    return { source: 'intelligence_events', pulled: rows.length, ingested };
  } catch (err: unknown) {
    await jpool.end().catch(() => {});
    return { source: 'intelligence_events', pulled: 0, ingested: 0, error: (err as Error).message };
  }
}

// ─── Pull feed_items → community_items ───

export async function pullJudiciumFeedItems(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<JudiciumPullResult> {
  const jpool = getJudiciumPool();
  if (!jpool) return { source: 'feed_items', pulled: 0, ingested: 0, error: 'DATA_CATALOG_JUDICIUM_DATABASE_URL not set' };

  try {
    const { rows } = await jpool.query(
      `SELECT * FROM feed_items ORDER BY fetched_at DESC LIMIT $1`,
      [opts?.limit ?? 500],
    );

    if (rows.length === 0) {
      await jpool.end().catch(() => {});
      return { source: 'feed_items', pulled: 0, ingested: 0 };
    }

    let ingested = 0;
    for (const row of rows) {
      const itemId = `judicium-feed:${row.content_hash || row.id}`;
      try {
        await harvestPool.query(
          `INSERT INTO community_items
            (id, title, summary, source_class, source_name, source_url, stream, category,
             severity, published_at, lat, lon, geo_quality, location, original_link,
             payload_json, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             summary = EXCLUDED.summary,
             source_url = EXCLUDED.source_url,
             published_at = EXCLUDED.published_at,
             payload_json = EXCLUDED.payload_json,
             last_seen_at = EXCLUDED.last_seen_at`,
          [
            itemId,
            (row.title || 'Judicium feed item').slice(0, 200),
            (row.summary || row.normalized_text || '').slice(0, 800),
            'narrative',
            row.source_name || 'Judicium Feed',
            row.source_url || row.original_link || '',
            'judicium-feeds',
            row.category || row.feed_category || 'News',
            severityFromType(row.lifecycle || 'info'),
            row.published_at || row.fetched_at || new Date().toISOString(),
            Number.isFinite(Number(row.lat)) ? Number(row.lat) : null,
            Number.isFinite(Number(row.lon)) ? Number(row.lon) : null,
            (Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)) ? 'exact' : 'none'),
            row.category || 'Unknown',
            row.original_link || row.source_url,
            JSON.stringify({
              judicium_source: 'feed_items',
              feed_url: row.feed_url,
              entities: row.entities,
              enrichment: row.enrichment,
              lifecycle: row.lifecycle,
              media_url: row.media_url,
              content_hash: row.content_hash,
            }),
            row.fetched_at || new Date().toISOString(),
            row.fetched_at || new Date().toISOString(),
          ],
        );
        ingested++;
      } catch { /* ON CONFLICT */ }
    }

    await jpool.end().catch(() => {});
    return { source: 'feed_items', pulled: rows.length, ingested };
  } catch (err: unknown) {
    await jpool.end().catch(() => {});
    return { source: 'feed_items', pulled: 0, ingested: 0, error: (err as Error).message };
  }
}

// ─── Pull social_posts → community_items ───

export async function pullJudiciumSocialPosts(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<JudiciumPullResult> {
  const jpool = getJudiciumPool();
  if (!jpool) return { source: 'social_posts', pulled: 0, ingested: 0, error: 'DATA_CATALOG_JUDICIUM_DATABASE_URL not set' };

  try {
    const { rows } = await jpool.query(
      `SELECT * FROM social_posts ORDER BY published_at DESC NULLS LAST LIMIT $1`,
      [opts?.limit ?? 500],
    );

    if (rows.length === 0) {
      await jpool.end().catch(() => {});
      return { source: 'social_posts', pulled: 0, ingested: 0 };
    }

    let ingested = 0;
    for (const row of rows) {
      const itemId = `judicium-social:${row.id}`;
      try {
        const content = (row.content || row.content_clean || '').slice(0, 400);
        await harvestPool.query(
          `INSERT INTO community_items
            (id, title, summary, source_class, source_name, source_url, stream, category,
             severity, published_at, lat, lon, geo_quality, location, original_link,
             payload_json, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             summary = EXCLUDED.summary,
             payload_json = EXCLUDED.payload_json,
             last_seen_at = EXCLUDED.last_seen_at`,
          [
            itemId,
            `Social: ${row.platform || 'post'} · ${content.slice(0, 80)}`,
            content,
            'social',
            row.platform || row.account || 'Judicium Social',
            row.post_url || '',
            'judicium-social',
            'Social',
            'low',
            row.published_at || row.fetched_at || new Date().toISOString(),
            null, null, 'none',
            'Online',
            row.post_url || '',
            JSON.stringify({
              judicium_source: 'social_posts',
              platform: row.platform,
              account: row.account,
              engagement: row.engagement,
              media_urls: row.media_urls,
            }),
            row.fetched_at || row.published_at || new Date().toISOString(),
            row.fetched_at || row.published_at || new Date().toISOString(),
          ],
        );
        ingested++;
      } catch { /* ON CONFLICT */ }
    }

    await jpool.end().catch(() => {});
    return { source: 'social_posts', pulled: rows.length, ingested };
  } catch (err: unknown) {
    await jpool.end().catch(() => {});
    return { source: 'social_posts', pulled: 0, ingested: 0, error: (err as Error).message };
  }
}

// ─── Pull evidence → community_items ───

export async function pullJudiciumEvidence(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<JudiciumPullResult> {
  const jpool = getJudiciumPool();
  if (!jpool) return { source: 'evidence', pulled: 0, ingested: 0, error: 'DATA_CATALOG_JUDICIUM_DATABASE_URL not set' };

  try {
    const { rows } = await jpool.query(
      `SELECT * FROM evidence ORDER BY created_at DESC LIMIT $1`,
      [opts?.limit ?? 500],
    );

    if (rows.length === 0) {
      await jpool.end().catch(() => {});
      return { source: 'evidence', pulled: 0, ingested: 0 };
    }

    let ingested = 0;
    for (const row of rows) {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
      const prov = typeof row.provenance === 'string' ? JSON.parse(row.provenance) : (row.provenance || {});
      const itemId = `judicium-evidence:${row.id}`;

      try {
        await harvestPool.query(
          `INSERT INTO community_items
            (id, title, summary, source_class, source_name, source_url, stream, category,
             severity, published_at, lat, lon, geo_quality, location, original_link,
             payload_json, first_seen_at, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             summary = EXCLUDED.summary,
             payload_json = EXCLUDED.payload_json,
             last_seen_at = EXCLUDED.last_seen_at`,
          [
            itemId,
            `Judicium Evidence: ${row.claim || `Case ${row.case_id}`}`.slice(0, 200),
            (row.claim || `Evidence for case ${row.case_id}`).slice(0, 400),
            'authority',
            row.source || 'Judicium',
            '',
            'judicium-evidence',
            'Evidence',
            'medium',
            row.created_at || new Date().toISOString(),
            null, null, 'none',
            prov?.location || 'Unknown',
            '',
            JSON.stringify({
              judicium_source: 'evidence',
              case_id: row.case_id,
              entity_id: row.entity_id,
              claim: row.claim,
              provenance: prov,
              payload,
            }),
            row.created_at || new Date().toISOString(),
            row.created_at || new Date().toISOString(),
          ],
        );
        ingested++;
      } catch { /* ON CONFLICT */ }
    }

    await jpool.end().catch(() => {});
    return { source: 'evidence', pulled: rows.length, ingested };
  } catch (err: unknown) {
    await jpool.end().catch(() => {});
    return { source: 'evidence', pulled: 0, ingested: 0, error: (err as Error).message };
  }
}

// ─── Pull canonical_entities → domain_events ───

export async function pullJudiciumEntities(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<JudiciumPullResult> {
  const jpool = getJudiciumPool();
  if (!jpool) return { source: 'canonical_entities', pulled: 0, ingested: 0, error: 'DATA_CATALOG_JUDICIUM_DATABASE_URL not set' };

  try {
    const { rows } = await jpool.query(
      `SELECT * FROM canonical_entities ORDER BY last_seen DESC NULLS LAST LIMIT $1`,
      [opts?.limit ?? 1000],
    );

    if (rows.length === 0) {
      await jpool.end().catch(() => {});
      return { source: 'canonical_entities', pulled: 0, ingested: 0 };
    }

    let ingested = 0;
    for (const row of rows) {
      const entId = `judicium-entity:${row.id || row.normalized_name || Math.random().toString(36)}`;
      try {
        await harvestPool.query(
          `INSERT INTO domain_events
            (id, event_type, aggregate_type, aggregate_id, ontology_version, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
           ON CONFLICT (id) DO NOTHING`,
          [
            entId,
            'judicium.entity_resolved',
            row.kind || 'entity',
            row.name || row.normalized_name || 'Unknown',
            '1.0',
            JSON.stringify({
              judicium_source: 'canonical_entities',
              kind: row.kind,
              name: row.name,
              normalized_name: row.normalized_name,
              identifiers: row.identifiers,
              merged_from: row.merged_from,
              source_count: row.source_count,
              first_seen: row.first_seen,
              last_seen: row.last_seen,
            }),
            row.last_seen || row.created_at || new Date().toISOString(),
          ],
        );
        ingested++;
      } catch { /* ON CONFLICT DO NOTHING */ }
    }

    await jpool.end().catch(() => {});
    return { source: 'canonical_entities', pulled: rows.length, ingested };
  } catch (err: unknown) {
    await jpool.end().catch(() => {});
    return { source: 'canonical_entities', pulled: 0, ingested: 0, error: (err as Error).message };
  }
}

// ─── Pull relationships → domain_events ───

export async function pullJudiciumRelationships(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<JudiciumPullResult> {
  const jpool = getJudiciumPool();
  if (!jpool) return { source: 'relationships', pulled: 0, ingested: 0, error: 'DATA_CATALOG_JUDICIUM_DATABASE_URL not set' };

  try {
    const { rows } = await jpool.query(
      `SELECT * FROM relationships ORDER BY created_at DESC LIMIT $1`,
      [opts?.limit ?? 500],
    );

    if (rows.length === 0) {
      await jpool.end().catch(() => {});
      return { source: 'relationships', pulled: 0, ingested: 0 };
    }

    let ingested = 0;
    for (const row of rows) {
      const relId = `judicium-rel:${row.id}`;
      try {
        await harvestPool.query(
          `INSERT INTO domain_events
            (id, event_type, aggregate_type, aggregate_id, ontology_version, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
           ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
          [
            relId,
            'judicium.relationship',
            row.relationship_type || 'related-to',
            `${row.source_type || ''}:${row.source_id || ''}`,
            '1.0',
            JSON.stringify({
              judicium_source: 'relationships',
              source_type: row.source_type,
              source_id: row.source_id,
              target_type: row.target_type,
              target_id: row.target_id,
              relationship_type: row.relationship_type,
              confidence: row.confidence,
              is_verified: row.is_verified,
              is_disputed: row.is_disputed,
              evidence_ids: row.evidence_ids,
              case_id: row.case_id,
              provenance: row.provenance,
              analyst_notes: row.analyst_notes,
            }),
            row.created_at || new Date().toISOString(),
          ],
        );
        ingested++;
      } catch { /* ON CONFLICT */ }
    }

    await jpool.end().catch(() => {});
    return { source: 'relationships', pulled: rows.length, ingested };
  } catch (err: unknown) {
    await jpool.end().catch(() => {});
    return { source: 'relationships', pulled: 0, ingested: 0, error: (err as Error).message };
  }
}

// ─── Pull all Judicium data ───

export interface PullAllJudiciumResult {
  results: JudiciumPullResult[];
  total_pulled: number;
  total_ingested: number;
}

export async function pullAllJudicium(
  harvestPool: Pool,
  opts?: { limit?: number },
): Promise<PullAllJudiciumResult> {
  if (!(process.env.DATA_CATALOG_JUDICIUM_DATABASE_URL || deriveJudiciumUrl())) {
    return {
      results: [{ source: 'all', pulled: 0, ingested: 0, error: 'No Judicium DB URL available (set DATA_CATALOG_JUDICIUM_DATABASE_URL or ensure HARVEST_DATABASE_URL is configured)' }],
      total_pulled: 0,
      total_ingested: 0,
    };
  }

  const results: JudiciumPullResult[] = [];

  // Pull in parallel with separate pool connections
  const pulls = await Promise.allSettled([
    pullJudiciumIntelligenceEvents(harvestPool, opts),
    pullJudiciumFeedItems(harvestPool, opts),
    pullJudiciumSocialPosts(harvestPool, opts),
    pullJudiciumEvidence(harvestPool, opts),
    pullJudiciumEntities(harvestPool, opts),
    pullJudiciumRelationships(harvestPool, opts),
  ]);

  for (const p of pulls) {
    if (p.status === 'fulfilled') {
      results.push(p.value);
    } else {
      results.push({ source: 'unknown', pulled: 0, ingested: 0, error: p.reason?.message || 'rejected' });
    }
  }

  const total_pulled = results.reduce((n, r) => n + r.pulled, 0);
  const total_ingested = results.reduce((n, r) => n + r.ingested, 0);

  return { results, total_pulled, total_ingested };
}

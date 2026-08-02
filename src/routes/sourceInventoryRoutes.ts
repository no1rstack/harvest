import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { getHarvestPool } from '../db/harvestPostgres.js';

function readJson<T>(...segments: string[]): T | null {
  const p = path.join(process.cwd(), ...segments);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T; } catch { return null; }
}

export function registerSourceInventoryRoutes(app: Express): void {
  app.get('/api/source-inventory', async (_req, res) => {
    try {
      const inventory = readJson<any>('data', 'source-inventory.json');
      const noRss = readJson<any>('data', 'no-rss-acquisition-plan.json');
      const duplicates = readJson<any>('data', 'source-duplicates.json');

      const catalogSources = inventory?.sources || [];
      const catalogSummary = inventory?.summary || {};
      const catalogTotal = catalogSummary.total_sources || catalogSources.length;

      // --- Real database state ---
      const pool = getHarvestPool();
      let dbState: any = {
        feedsTotal: 0, feedsPulled: 0, feedsNeverPulled: 0, feedsErrored: 0,
        feedsWithItems: 0, feedsEmpty: 0,
        streamCounts: {}, sourceItems: [], erroredSources: [],
        totalCommunityItems: 0, totalFindings: 0, totalRuns: 0,
        connected: false,
      };

      if (pool) {
        dbState.connected = true;
        // Feed source counts
        const feedsCounts = await pool.query(`
          SELECT
            COUNT(*)::int as "feedsTotal",
            COUNT(*) FILTER (WHERE last_ok_at IS NOT NULL)::int as "feedsPulled",
            COUNT(*) FILTER (WHERE last_ok_at IS NULL AND last_error IS NULL)::int as "feedsNeverPulled",
            COUNT(*) FILTER (WHERE last_ok_at IS NULL AND last_error IS NOT NULL)::int as "feedsErrored"
          FROM community_feed_sources
        `);
        Object.assign(dbState, feedsCounts.rows[0] || {});

        // Stream item counts
        const streamRows = await pool.query(`
          SELECT stream, COUNT(*)::int as items, MAX(last_seen_at) as latest
          FROM community_items GROUP BY stream ORDER BY COUNT(*) DESC
        `);
        for (const r of streamRows.rows) {
          dbState.streamCounts[r.stream] = { items: r.items, latest: r.latest };
        }

        // Total community items
        const totalItems = await pool.query('SELECT COUNT(*)::int as cnt FROM community_items');
        dbState.totalCommunityItems = totalItems.rows[0]?.cnt || 0;

        // Sources with items
        const itemsBySource = await pool.query(`
          SELECT
            s.name, s.feed_url, s.last_ok_at, s.last_error,
            COUNT(ci.id)::int as items
          FROM community_feed_sources s
          LEFT JOIN community_items ci ON ci.source_name = s.name
          GROUP BY s.name, s.feed_url, s.last_ok_at, s.last_error
          ORDER BY COUNT(ci.id) DESC
        `);
        dbState.sourceItems = itemsBySource.rows;
        for (const r of itemsBySource.rows) {
          if (r.items > 0) dbState.feedsWithItems++;
          else if (r.last_ok_at) dbState.feedsEmpty++;
        }

        // Errored sources detail
        const errored = await pool.query(`
          SELECT name, feed_url, LEFT(COALESCE(last_error,''), 120) as error
          FROM community_feed_sources
          WHERE last_ok_at IS NULL AND last_error IS NOT NULL
          ORDER BY name
        `);
        dbState.erroredSources = errored.rows;

        // osint_harvest_findings
        const findings = await pool.query('SELECT COUNT(*)::int as cnt FROM osint_harvest_findings');
        dbState.totalFindings = findings.rows[0]?.cnt || 0;

        // osint_harvest_runs
        const runs = await pool.query('SELECT COUNT(*)::int as cnt FROM osint_harvest_runs');
        dbState.totalRuns = runs.rows[0]?.cnt || 0;
      }

      // --- Merge catalog + reality ---

      // Top duplicated domains
      const topDuplicates = duplicates?.topDomains?.slice(0, 10) || [];

      // No-RSS breakdown from static catalog
      const noRssBreakdown = noRss?.acquisition_plans
        ? Object.entries(noRss.acquisition_plans).map(([key, plan]: [string, any]) => ({
            method: plan.method || key,
            count: plan.count || 0,
            sources: plan.sources?.slice(0, 20) || [],
          }))
        : [];

      // Category counts from catalog
      const categoryCounts: Record<string, number> = {};
      for (const s of catalogSources) {
        const cat = s.category || 'Uncategorized';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }

      // Category acquisition
      const topCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([cat]) => cat);

      const categoryAcquisition: Record<string, { rss: number; scraping: number; api: number; pageDiff: number; total: number }> = {};
      for (const s of catalogSources) {
        const cat = s.category || 'Uncategorized';
        if (!topCategories.includes(cat)) continue;
        if (!categoryAcquisition[cat]) categoryAcquisition[cat] = { rss: 0, scraping: 0, api: 0, pageDiff: 0, total: 0 };
        categoryAcquisition[cat].total++;
        const status = s.status;
        if (status === 'working' || status === 'registered_unverified') categoryAcquisition[cat].rss++;
        else if (status === 'html_scraping_required') categoryAcquisition[cat].scraping++;
        else if (status === 'public_api_required') categoryAcquisition[cat].api++;
        else if (status === 'page_diff_required') categoryAcquisition[cat].pageDiff++;
      }

      res.json({
        generatedAt: catalogSummary.generated_at || 'unknown',
        // Catalog
        catalogTotal,
        // Reality
        dbConnected: dbState.connected,
        feedsRegistered: dbState.feedsTotal,
        feedsPulled: dbState.feedsPulled,
        feedsNeverPulled: dbState.feedsNeverPulled,
        feedsErrored: dbState.feedsErrored,
        feedsWithItems: dbState.feedsWithItems,
        feedsEmpty: dbState.feedsEmpty,
        // Streams that actually produce data
        streams: dbState.streamCounts,
        totalCommunityItems: dbState.totalCommunityItems,
        totalFindings: dbState.totalFindings,
        totalRuns: dbState.totalRuns,
        // Detail
        sourceItems: dbState.sourceItems,
        erroredSources: dbState.erroredSources,
        // Catalog reference
        noRssBreakdown,
        topDuplicates,
        duplicateDomainCount: duplicates?.totalDomains || 0,
        duplicateEntryCount: duplicates?.totalEntries || 0,
        categoryAcquisition: Object.entries(categoryAcquisition)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([cat, counts]) => ({ category: cat, ...counts })),
        // Pipeline reality vs catalog
        pipelineReality: {
          catalog: { total: catalogTotal, working: dbState.feedsWithItems + (dbState.streamCounts ? Object.keys(dbState.streamCounts).length : 0), rssRegistered: dbState.feedsTotal },
          reality: {
            acquisition: { working: dbState.feedsPulled, errored: dbState.feedsErrored, neverPulled: dbState.feedsNeverPulled },
            parse: { working: dbState.feedsWithItems, empty: dbState.feedsEmpty },
            persist: { communityItems: dbState.totalCommunityItems },
            findings: { total: dbState.totalFindings, runs: dbState.totalRuns },
          },
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Direct bridge: community_items → osint_harvest_findings (bypasses Cascades)
  app.post('/api/source-inventory/bridge', async (req, res) => {
    try {
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'Database not connected' });

      const stream = String(req.body?.stream || '');
      const limit = Math.min(Number(req.body?.limit) || 500, 5000);

      // Fetch community_items
      const itemQuery = stream
        ? `SELECT id, title, summary, stream, category, source_name, source_url, published_at, payload_json
           FROM community_items WHERE stream = $1 ORDER BY published_at DESC LIMIT $2`
        : `SELECT id, title, summary, stream, category, source_name, source_url, published_at, payload_json
           FROM community_items ORDER BY published_at DESC LIMIT $1`;
      const items = await pool.query(itemQuery, stream ? [stream, limit] : [limit]);

      const rows = items.rows as any[];
      if (!rows.length) return res.json({ bridged: 0, inserted: 0, skipped: 0, message: 'No items found' });

      // Create a run
      const runId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO osint_harvest_runs (id, target, status, harvesters, started_at, product)
         VALUES ($1, $2, 'running', $3, NOW(), 'shared')
         ON CONFLICT (id) DO NOTHING`,
        [runId, `community:${stream || 'all'}`, ['community-bridge']],
      );

      // Batch insert all findings in a single multi-row INSERT
      const crypto = await import('crypto');
      const values: string[] = [];
      const params: any[] = [];
      let paramIdx = 0;

      for (const item of rows) {
        const source = item.source_name || item.stream || 'community';
        const sourceId = item.source_url || item.id;
        const value = item.title || item.id;
        const hashKey = `${source}|${item.stream || 'item'}|${value.toLowerCase().trim()}|${sourceId}`;
        const hash = crypto.createHash('sha256').update(hashKey).digest('hex');
        const findingId = `ohf_${hash.slice(0, 32)}`;

        const tags: string[] = [];
        const payload = item.payload_json || {};
        if (payload.enrichment) {
          if (Array.isArray(payload.enrichment.keywords)) tags.push(...payload.enrichment.keywords.slice(0, 5));
          if (Array.isArray(payload.enrichment.entities)) tags.push(...payload.enrichment.entities.slice(0, 5));
        }
        if (item.category) tags.push(item.category);

        params.push(
          findingId, runId, source, sourceId,
          item.stream || 'community-item',
          value, value.slice(0, 200), item.title || '',
          (item.summary || '').slice(0, 1000),
          item.severity || 'info', 0.7, tags.slice(0, 10),
          hash,
          JSON.stringify({ community_item_id: item.id, stream: item.stream, source_url: item.source_url, enrichment: payload.enrichment }),
          item.published_at || new Date().toISOString(),
          'shared',
        );
        values.push(`($${paramIdx + 1},$${paramIdx + 2},$${paramIdx + 3},$${paramIdx + 4},$${paramIdx + 5},$${paramIdx + 6},$${paramIdx + 7},$${paramIdx + 8},$${paramIdx + 9},$${paramIdx + 10},$${paramIdx + 11},$${paramIdx + 12},$${paramIdx + 13},$${paramIdx + 14}::jsonb,$${paramIdx + 15},$${paramIdx + 16})`);
        paramIdx += 16;
      }

      const result = await pool.query(
        `INSERT INTO osint_harvest_findings
          (id, run_id, source, source_id, entity_type, value, label, title,
           description, severity, confidence, tags, content_hash, raw, observed_at, product)
         VALUES ${values.join(',')}
         ON CONFLICT (content_hash) DO NOTHING`,
        params,
      );

      const inserted = result.rowCount || 0;
      const skipped = rows.length - inserted;

      // Finish the run
      await pool.query(
        `UPDATE osint_harvest_runs
         SET status = 'completed', total_findings = $2, inserted = $3, skipped = $4, finished_at = NOW()
         WHERE id = $1`,
        [runId, rows.length, inserted, skipped],
      );

      res.json({
        bridged: rows.length,
        inserted,
        skipped,
        runId,
        stream: stream || 'all',
        message: `Bridged ${inserted} new findings (${skipped} duplicates) from ${rows.length} community items. Run: ${runId}`,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

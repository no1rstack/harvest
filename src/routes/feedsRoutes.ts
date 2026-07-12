/**
 * Community feeds API — shared feeds service for Judicium and platform products.
 * Mirrors Judicium /api/community/* paths under /api/feeds/community/*.
 */

import type { Express } from 'express';
import { getHarvestPool } from '../db/harvestPostgres.js';
import {
  getCommunityStats,
  getCommunityFacets,
  listCommunityItems,
  listStreamStatus,
  markStreamError,
  upsertCommunityItems,
} from '../feeds/communityStorePg.js';
import {
  backfillCommunityEnrichment,
  expandCommunityKeywordsToTargets,
  enrichCommunityItemById,
} from '../feeds/communityIntelligence.js';
import {
  getCommunityPullStatusAsync,
  pullFeedSource,
  pullFreeLayers,
  pullRssDigest,
  runCommunityDailyPull,
} from '../feeds/communityPullWorker.js';
import { aggregateRssDigest, getCuratedFeedDefinitions, getRssCategories } from '../feeds/rssDigest.js';
import { discoverFeedsFromUrl } from '../feeds/rssFeedDiscovery.js';
import { CRUCIX_FEED_SEEDS } from '../feeds/crucixFeedSeeds.js';
import {
  fetchWorldMonitorFeedCatalog,
  filterWorldMonitorCatalog,
  worldMonitorFeedToSeed,
} from '../feeds/worldMonitorFeedCatalog.js';
import { loadPlatformConfig } from '../platform/config.js';
import { resolveCommunityFeedsConfig } from '../modules/community-feeds/config.js';
import { getCommunityFeedsContract } from '../modules/registry.js';

function moduleConfig() {
  return resolveCommunityFeedsConfig(loadPlatformConfig());
}

function poolOr503(res: import('express').Response) {
  const pool = getHarvestPool();
  if (!pool) {
    res.status(503).json({ error: 'HARVEST_DATABASE_URL not configured' });
    return null;
  }
  return pool;
}

export function registerFeedsRoutes(app: Express): void {
  const base = '/api/feeds/community';

  app.get(`${base}/contract`, (_req, res) => {
    const cfg = moduleConfig();
    res.json({
      contract: getCommunityFeedsContract(),
      config: cfg,
      store: 'harvest-postgres',
    });
  });

  app.get(`${base}/items`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const hours = parseInt(String(req.query.hours || '48'), 10) || 48;
      const limit = Math.min(parseInt(String(req.query.limit || '300'), 10) || 300, 1000);
      const items = await listCommunityItems(pool, {
        hours,
        limit,
        sourceClass: String(req.query.class || '').trim() || undefined,
        stream: String(req.query.stream || '').trim() || undefined,
        category: String(req.query.category || '').trim() || undefined,
        severity: String(req.query.severity || '').trim() || undefined,
        q: String(req.query.q || '').trim() || undefined,
        keyword: String(req.query.keyword || '').trim() || undefined,
        entity: String(req.query.entity || '').trim() || undefined,
      });
      const stats = await getCommunityStats(pool, hours);
      res.json({ items, stats, hours, store: 'harvest-postgres' });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message, items: [] });
    }
  });

  app.get(`${base}/facets`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const hours = parseInt(String(req.query.hours || '48'), 10) || 48;
      const stream = String(req.query.stream || '').trim() || undefined;
      const facets = await getCommunityFacets(pool, { hours, stream });
      res.json({ hours, stream: stream || null, facets });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post(`${base}/enrich`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const itemId = String(req.body?.item_id || req.body?.id || '').trim();
      if (itemId) {
        const item = await enrichCommunityItemById(pool, itemId);
        if (!item) return res.status(404).json({ error: 'item not found' });
        return res.json({ enriched: 1, item });
      }
      const cfg = moduleConfig();
      const result = await backfillCommunityEnrichment(pool, {
        hours: parseInt(String(req.body?.hours || cfg.enrichment.backfillHours), 10) || cfg.enrichment.backfillHours,
        stream: typeof req.body?.stream === 'string' ? req.body.stream : undefined,
        limit: Math.min(
          parseInt(String(req.body?.limit || cfg.enrichment.backfillLimit), 10) || cfg.enrichment.backfillLimit,
          2000,
        ),
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post(`${base}/expand`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const cfg = moduleConfig();
      if (!cfg.expansion.enabled) {
        return res.status(403).json({
          error: 'Community feeds expansion disabled in Harvest module config',
          module: 'community-feeds',
        });
      }
      const keywords = Array.isArray(req.body?.keywords)
        ? req.body.keywords.map((k: unknown) => String(k))
        : req.body?.keyword
          ? [String(req.body.keyword)]
          : undefined;
      const itemIds = Array.isArray(req.body?.item_ids)
        ? req.body.item_ids.map((id: unknown) => String(id))
        : req.body?.item_id
          ? [String(req.body.item_id)]
          : undefined;
      const result = await expandCommunityKeywordsToTargets(pool, {
        keywords,
        itemIds,
        hours: parseInt(String(req.body?.hours || '48'), 10) || 48,
        stream: typeof req.body?.stream === 'string' ? req.body.stream : undefined,
        category: typeof req.body?.category === 'string' ? req.body.category : undefined,
        goal: typeof req.body?.goal === 'string' ? req.body.goal : undefined,
        expand: req.body?.expand !== false,
        enqueue: req.body?.enqueue != null ? Boolean(req.body.enqueue) : cfg.expansion.defaultEnqueue,
        dryRun: Boolean(req.body?.dry_run),
        maxTargets: Math.min(
          parseInt(String(req.body?.max_targets || cfg.expansion.maxTargetsPerRun), 10) || cfg.expansion.maxTargetsPerRun,
          50,
        ),
        product: typeof req.body?.product === 'string' ? req.body.product : 'shared',
      });
      res.status(202).json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get(`${base}/status`, async (_req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      res.json({
        streams: await listStreamStatus(pool),
        stats: await getCommunityStats(pool, 48),
        store: 'harvest-postgres',
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message, streams: [] });
    }
  });

  app.post(`${base}/ingest`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const stream = typeof req.body?.stream === 'string' ? req.body.stream : undefined;
      if (!items.length) {
        if (stream && req.body?.error) await markStreamError(pool, stream, String(req.body.error));
        return res.json({ upserted: 0 });
      }
      const result = await upsertCommunityItems(pool, items, stream);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message, upserted: 0 });
    }
  });

  app.get(`${base}/daily`, async (req, res) => {
    try {
      const hours = parseInt(String(req.query.hours || '24'), 10) || 24;
      const categories = req.query.categories
        ? String(req.query.categories).split(',').map((s) => s.trim()).filter(Boolean)
        : getRssCategories();
      const items = await aggregateRssDigest(categories, 120);
      res.json({ hours, categories, items, total: items.length, source: 'harvest-feeds' });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get(`${base}/pull/status`, async (_req, res) => {
    try {
      res.json(await getCommunityPullStatusAsync());
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post(`${base}/pull`, async (req, res) => {
    try {
      const which = String(req.body?.which || req.query?.which || 'daily');
      if (which === 'layers') return res.json({ which, results: await pullFreeLayers() });
      if (which === 'rss') return res.json({ which, result: await pullRssDigest() });
      res.json({ which: 'daily', ...(await runCommunityDailyPull()) });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get(`${base}/layers`, (_req, res) => {
    res.json({
      layers: [
        { id: 'disasters', label: 'Disasters', sources: ['USGS', 'GDACS'], free: true },
        { id: 'aviation', label: 'Aviation', sources: ['OpenSky'], free: true },
        { id: 'cyber', label: 'Cyber', sources: ['Feodo', 'URLHaus'], free: true },
      ],
    });
  });

  app.get(`${base}/layers/:layer`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const layer = String(req.params.layer || '') as 'disasters' | 'aviation' | 'cyber';
      if (!['disasters', 'aviation', 'cyber'].includes(layer)) {
        return res.status(400).json({ error: 'Unknown layer' });
      }
      const { fetchCommunityLayer } = await import('../feeds/communityLayers.js');
      const result = await fetchCommunityLayer(layer);
      if (result.error && !result.items.length) {
        await markStreamError(pool, layer, result.error);
        return res.status(502).json(result);
      }
      if (result.items.length) await upsertCommunityItems(pool, result.items, layer);
      res.json({
        layer: result.layer,
        total: result.items.length,
        items: result.items,
        error: result.error,
        persisted: result.items.length > 0,
      });
    } catch (err: unknown) {
      res.status(502).json({ error: (err as Error).message, items: [] });
    }
  });

  app.get(`${base}/corroboration`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const hours = parseInt(String(req.query.hours || '48'), 10) || 48;
      const items = await listCommunityItems(pool, { hours, limit: 800 });
      const { findCorroborations } = await import('../feeds/communityLayers.js');
      const narrative = items.filter((i) => i.sourceClass === 'narrative' || i.sourceClass === 'social');
      const sensors = items.filter((i) => i.sourceClass === 'sensor');
      const links = findCorroborations(narrative, sensors);
      res.json({ total: links.length, links });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message, links: [] });
    }
  });

  app.get(`${base}/sources`, async (_req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const sources = await listFeedSources(pool);
      res.json({
        sources,
        curated: getCuratedFeedDefinitions(),
        total: sources.length,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message, sources: [] });
    }
  });

  app.post(`${base}/sources/discover`, async (req, res) => {
    try {
      const url = String(req.body?.url || req.body?.site_url || '').trim();
      if (!url) return res.status(400).json({ error: 'url is required' });
      const discovery = await discoverFeedsFromUrl(url);
      res.json(discovery);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message, feeds: [] });
    }
  });

  app.get(`${base}/sources/catalog/worldmonitor`, async (req, res) => {
    try {
      const catalog = await fetchWorldMonitorFeedCatalog({
        refresh: req.query.refresh === '1',
      });
      const feeds = filterWorldMonitorCatalog(catalog.feeds, {
        variant: String(req.query.variant || '').trim() || undefined,
        wmCategory: String(req.query.wm_category || '').trim() || undefined,
        harvestCategory: String(req.query.category || '').trim() || undefined,
        directOnly: req.query.direct_only === '1',
        q: String(req.query.q || '').trim() || undefined,
        limit: Math.min(parseInt(String(req.query.limit || '200'), 10) || 200, 500),
      });
      res.json({ ...catalog, feeds, filtered: feeds.length });
    } catch (err: unknown) {
      res.status(502).json({ error: (err as Error).message, feeds: [] });
    }
  });

  app.post(`${base}/sources/import`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const pack = String(req.body?.pack || 'crucix');
      const limit = Math.min(parseInt(String(req.body?.limit || '50'), 10) || 50, 200);
      const seeds: Array<{
        name: string;
        siteUrl: string;
        feedUrl: string;
        category: string;
        discoveredVia: string;
      }> = [];

      if (pack === 'crucix') {
        for (const seed of CRUCIX_FEED_SEEDS.slice(0, limit)) {
          seeds.push({
            name: seed.name,
            siteUrl: seed.siteUrl,
            feedUrl: seed.feedUrl,
            category: seed.category,
            discoveredVia: 'crucix-seed',
          });
        }
      } else if (pack === 'worldmonitor') {
        const catalog = await fetchWorldMonitorFeedCatalog();
        const filtered = filterWorldMonitorCatalog(catalog.feeds, {
          variant: typeof req.body?.variant === 'string' ? req.body.variant : 'full',
          harvestCategory: typeof req.body?.category === 'string' ? req.body.category : undefined,
          directOnly: req.body?.direct_only !== false,
          limit,
        });
        for (const feed of filtered) {
          const s = worldMonitorFeedToSeed(feed);
          seeds.push({
            name: s.name,
            siteUrl: s.siteUrl,
            feedUrl: s.feedUrl,
            category: s.category,
            discoveredVia: s.discoveredVia,
          });
        }
      } else {
        return res.status(400).json({ error: 'pack must be crucix or worldmonitor' });
      }

      const registered = [];
      for (const seed of seeds) {
        registered.push(await upsertFeedSource(pool, {
          ...seed,
          enabled: true,
          autoPull: true,
        }));
      }
      res.status(201).json({
        pack,
        imported: registered.length,
        sources: registered,
        worldMonitorNote:
          pack === 'worldmonitor'
            ? 'Imported AGPL RSS catalog from koala73/worldmonitor — no paid API key required for feeds.'
            : undefined,
      });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post(`${base}/sources`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const url = String(req.body?.url || '').trim();
      let feedUrl = String(req.body?.feed_url || '').trim();
      let siteUrl = String(req.body?.site_url || '').trim();
      let name = String(req.body?.name || '').trim();
      let discoveredVia = String(req.body?.discovered_via || 'manual');

      if (url && !feedUrl) {
        const discovery = await discoverFeedsFromUrl(url);
        if (!discovery.feeds.length) {
          return res.status(404).json({ error: 'No feeds discovered for URL', discovery });
        }
        const first = discovery.feeds[0];
        feedUrl = first.feedUrl;
        siteUrl = discovery.siteUrl;
        if (!name) name = first.title || new URL(discovery.siteUrl).hostname;
        discoveredVia = first.discoveredVia;
      }

      if (!feedUrl) return res.status(400).json({ error: 'feed_url or url is required' });
      if (!name) name = new URL(feedUrl).hostname;
      if (!siteUrl) siteUrl = new URL(feedUrl).origin;

      const source = await upsertFeedSource(pool, {
        name,
        siteUrl,
        feedUrl,
        category: String(req.body?.category || 'osint'),
        enabled: req.body?.enabled !== false,
        autoPull: req.body?.auto_pull !== false,
        discoveredVia,
      });
      res.status(201).json({ source });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch(`${base}/sources/:id`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const source = await patchFeedSource(pool, String(req.params.id), {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        category: typeof req.body?.category === 'string' ? req.body.category : undefined,
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
        autoPull: typeof req.body?.auto_pull === 'boolean' ? req.body.auto_pull : undefined,
      });
      if (!source) return res.status(404).json({ error: 'Source not found' });
      res.json({ source });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete(`${base}/sources/:id`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const deleted = await deleteFeedSource(pool, String(req.params.id));
      if (!deleted) return res.status(404).json({ error: 'Source not found' });
      res.json({ deleted: true });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post(`${base}/sources/:id/pull`, async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const sources = await listFeedSources(pool);
      const source = sources.find((s) => s.id === String(req.params.id));
      if (!source) return res.status(404).json({ error: 'Source not found' });
      const result = await pullFeedSource(source);
      res.json({ source, result });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

/**
 * Community feeds API — shared feeds service for Judicium and platform products.
 * Mirrors Judicium /api/community/* paths under /api/feeds/community/*.
 */

import type { Express } from 'express';
import { getHarvestPool } from '../db/harvestPostgres.js';
import {
  getCommunityStats,
  listCommunityItems,
  listStreamStatus,
  markStreamError,
  upsertCommunityItems,
} from '../feeds/communityStorePg.js';
import {
  getCommunityPullStatusAsync,
  pullFreeLayers,
  pullRssDigest,
  runCommunityDailyPull,
} from '../feeds/communityPullWorker.js';
import { aggregateRssDigest, getRssCategories } from '../feeds/rssDigest.js';

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
      });
      const stats = await getCommunityStats(pool, hours);
      res.json({ items, stats, hours, store: 'harvest-postgres' });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message, items: [] });
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
}

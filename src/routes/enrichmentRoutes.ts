/**
 * Encyclopedia enrichment API routes
 */

import type { Express } from 'express';
import { getHarvestPool } from '../db/harvestPostgres';
import { runEnrichment, getEnrichmentStats, getEntityProfile } from '../enrichment/enrichmentPipeline';

export function registerEnrichmentRoutes(app: Express): void {
  // Run an enrichment cycle
  app.post('/api/enrichment/run', async (req, res) => {
    try {
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'Database not connected' });

      const maxCandidates = Math.min(Number(req.body?.maxCandidates) || 200, 2000);
      const batchSize = Math.min(Number(req.body?.batchSize) || 10, 50);

      const result = await runEnrichment(pool, { maxCandidates, batchSize });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get enrichment statistics
  app.get('/api/enrichment/stats', async (req, res) => {
    try {
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'Database not connected' });

      const stats = await getEnrichmentStats(pool);
      res.json(stats);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get entity profile by ID or name
  app.get('/api/enrichment/entity/:idOrName', async (req, res) => {
    try {
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'Database not connected' });

      const profile = await getEntityProfile(pool, req.params.idOrName);
      if (!profile) return res.status(404).json({ error: 'Entity not found' });
      res.json(profile);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get enrichment candidates (what's pending)
  app.get('/api/enrichment/candidates', async (req, res) => {
    try {
      const pool = getHarvestPool();
      if (!pool) return res.status(503).json({ error: 'Database not connected' });

      const result = await pool.query(
        `SELECT * FROM enrichment_candidates
         ORDER BY priority_score DESC
         LIMIT 100`
      );
      res.json(result.rows);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
